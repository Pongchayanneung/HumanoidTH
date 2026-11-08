import "../lib/load-env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { assertSeedAllowed } from "../lib/seed-guard";
import { createPostgresSubmissionWorkflowRepository } from "../lib/submission-workflow/postgres-repository";

// M7 (issue #12) runtime checks the unit suite does not make: real Prisma CRUD and restart preservation.
//   crud            create, read, update, delete through the app's own submission repository and Prisma
//   persist-write   write marker rows that must survive a server restart
//   persist-verify  confirm the marker rows hold exactly what persist-write stored
//   persist-clean   remove the marker rows
// Refuses unless ATLAS_ALLOW_SEED=1 and DATABASE_URL is a local database (same guard as seeding).
// Every row it writes carries the M7LANEB marker; nothing else is touched.

const MARK = "M7LANEB";
const MARK_URL = `https://m7laneb.example.invalid/${MARK}`;
const MARK_EMAIL = `${MARK.toLowerCase()}-admin@example.invalid`;

const connectionString = process.env.DATABASE_URL;
assertSeedAllowed(connectionString);
const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString as string) });

function must(condition: boolean, label: string): void {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) process.exitCode = 1;
}

async function crud() {
  const repo = createPostgresSubmissionWorkflowRepository(prisma);

  // Create then read a submission, review it, publish a contribution from it, edit, delete.
  const submitted = await repo.createSubmittedData({
    submissionType: "source_url", title: `${MARK} crud submission`, url: `${MARK_URL}/crud`, notes: null,
    submitterName: null, submitterContact: null, status: "QUEUED", payloadJson: { marker: MARK }
  } as never);
  must((await repo.findSubmittedDataById(submitted.id))?.title === `${MARK} crud submission`, "submission: create then read back");
  const reviewed = await repo.updateSubmittedData(submitted.id, { status: "APPROVED", reviewNotes: `${MARK} ok`, payloadJson: { marker: MARK, step: 2 } } as never);
  must(reviewed.status === "APPROVED" && reviewed.reviewNotes === `${MARK} ok`, "submission: review update persisted");

  const contribution = await repo.createContribution({
    title: `${MARK} crud contribution`, description: "m7 crud", contributorName: null, organization: null,
    contributionType: "other", sourceUrl: `${MARK_URL}/crud-c`, license: "unknown", visibility: "private",
    verificationStatus: "NEEDS_REVIEW", relatedRobotModelId: null
  } as never);
  const edited = await repo.updateContribution(contribution.id, { verificationStatus: "APPROVED", visibility: "public" } as never);
  const fresh = await repo.findContributionBySourceUrl(`${MARK_URL}/crud-c`);
  must(edited.verificationStatus === "APPROVED" && fresh?.visibility === "public", "contribution: create, update, read by unique sourceUrl");

  // Unique constraint is enforced by the database.
  const duplicate = await repo.createContribution({ ...contribution, id: undefined } as never).then(() => false, () => true);
  must(duplicate, "contribution: duplicate sourceUrl rejected by the database");

  // The repository has no delete, so use Prisma directly, plus a user and an inventory unit for the other tables.
  const user = await prisma.user.create({ data: { email: MARK_EMAIL, name: MARK, role: "ADMIN" } });
  const unit = await prisma.ownedInventory.create({ data: { displayName: `${MARK} unit`, ownershipStatus: "owned" } });
  must(user.role === "ADMIN" && unit.visibility === "private", "user and inventory: create (defaults applied: private visibility)");
  await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });
  must((await prisma.user.findUnique({ where: { id: user.id } }))?.role === "USER", "user: role update persisted");

  await prisma.submittedData.delete({ where: { id: submitted.id } });
  await prisma.contribution.delete({ where: { id: contribution.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.ownedInventory.delete({ where: { id: unit.id } });
  const left = await Promise.all([
    prisma.submittedData.count({ where: { id: submitted.id } }),
    prisma.contribution.count({ where: { id: contribution.id } }),
    prisma.user.count({ where: { id: user.id } }),
    prisma.ownedInventory.count({ where: { id: unit.id } })
  ]);
  must(left.every((n) => n === 0), "delete: all four rows gone");
}

async function persistWrite() {
  const repo = createPostgresSubmissionWorkflowRepository(prisma);
  const contribution = await repo.createContribution({
    title: `${MARK} persisted contribution`, description: "reviewed before restart", contributorName: null, organization: null,
    contributionType: "other", sourceUrl: `${MARK_URL}/persist`, license: "unknown", visibility: "public",
    verificationStatus: "NEEDS_REVIEW", relatedRobotModelId: null
  } as never);
  await repo.updateContribution(contribution.id, { verificationStatus: "REJECTED" } as never);
  await prisma.user.create({ data: { email: MARK_EMAIL, name: MARK, role: "ADMIN" } });
  await prisma.ownedInventory.create({ data: { id: `${MARK}-unit`, displayName: `${MARK} unit`, ownershipStatus: "owned", visibility: "private", serialNumber: `${MARK}-SN` } });
  console.log("wrote 3 marker rows");
}

async function persistVerify() {
  const c = await prisma.contribution.findUnique({ where: { sourceUrl: `${MARK_URL}/persist` } });
  must(c?.verificationStatus === "REJECTED" && c.visibility === "public", "contribution keeps reviewed status REJECTED");
  const u = await prisma.user.findUnique({ where: { email: MARK_EMAIL } });
  must(u?.role === "ADMIN", "user keeps ADMIN role");
  const i = await prisma.ownedInventory.findUnique({ where: { id: `${MARK}-unit` } });
  must(i?.visibility === "private" && i.serialNumber === `${MARK}-SN`, "inventory unit keeps private visibility and serial");
}

async function persistClean() {
  await prisma.contribution.deleteMany({ where: { sourceUrl: { startsWith: MARK_URL } } });
  await prisma.user.deleteMany({ where: { email: MARK_EMAIL } });
  await prisma.ownedInventory.deleteMany({ where: { id: `${MARK}-unit` } });
  await prisma.submittedData.deleteMany({ where: { url: { startsWith: MARK_URL } } });
  console.log("cleaned marker rows");
}

const commands: Record<string, () => Promise<void>> = {
  crud, "persist-write": persistWrite, "persist-verify": persistVerify, "persist-clean": persistClean
};
const run = commands[process.argv[2] ?? ""];
if (!run) {
  console.error(`usage: tsx scripts/m7-crud-restart.ts <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}
run()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
