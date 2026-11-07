import type { PrismaClient, Prisma } from "../../generated/prisma";
import type { Admission, OperatorAuthStore } from "./store";

type State = { activeFingerprint: string; activeEpoch: string; windowStartedAt: Date; attemptCount: number };
const WINDOW_MS = 15 * 60 * 1000;
const SESSION_MS = 4 * 60 * 60 * 1000;

async function lockState(tx: Prisma.TransactionClient): Promise<State | undefined> {
  const rows = await tx.$queryRaw<State[]>`SELECT "activeFingerprint", "activeEpoch", "windowStartedAt", "attemptCount" FROM "OperatorAuthState" WHERE "id" = 'operator' FOR UPDATE`;
  return rows[0];
}
async function databaseTime(tx: Prisma.TransactionClient): Promise<Date> {
  // Separate statement AFTER acquiring the row lock; transaction NOW() is too early.
  const rows = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "now"`;
  return rows[0].now;
}

export function createPostgresAuthStore(prisma: PrismaClient): OperatorAuthStore {
  const transaction = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(operation, { maxWait: 5000, timeout: 15000 });
  return {
    reserveAttempt(fingerprint) {
      return transaction<Admission>(async tx => {
        const state = await lockState(tx);
        if (!state || state.activeFingerprint !== fingerprint) return { kind: "INACTIVE" };
        const now = await databaseTime(tx);
        const elapsed = now.getTime() - state.windowStartedAt.getTime();
        const reset = elapsed >= WINDOW_MS;
        if (!reset && state.attemptCount >= 5) return { kind: "THROTTLED", retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000)) };
        await tx.operatorAuthState.update({ where: { id: "operator" }, data: { attemptCount: reset ? 1 : state.attemptCount + 1, windowStartedAt: reset ? now : state.windowStartedAt } });
        return { kind: "ADMITTED" };
      });
    },
    issueSession({ fingerprint, tokenHash }) {
      return transaction(async tx => {
        const state = await lockState(tx);
        if (!state || state.activeFingerprint !== fingerprint) return null;
        const now = await databaseTime(tx);
        const expiresAt = new Date(now.getTime() + SESSION_MS);
        await tx.operatorSession.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] } });
        await tx.operatorSession.create({ data: { tokenHash, configFingerprint: fingerprint, createdAt: now, expiresAt } });
        return expiresAt;
      });
    },
    async readSession({ fingerprint, tokenHash }) {
      const rows = await prisma.$queryRaw<Array<{ tokenHash: string }>>`SELECT session."tokenHash" FROM "OperatorSession" AS session JOIN "OperatorAuthState" AS state ON state."id" = 'operator' AND state."activeFingerprint" = ${fingerprint} WHERE session."tokenHash" = ${tokenHash} AND session."configFingerprint" = ${fingerprint} AND session."revokedAt" IS NULL AND session."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
      return rows.length === 1;
    },
    async revokeSession(tokenHash) {
      await prisma.$executeRaw`UPDATE "OperatorSession" SET "revokedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE "tokenHash" = ${tokenHash} AND "revokedAt" IS NULL`;
    },
    async initialize({ fingerprint, epoch }) {
      const changed = await prisma.$executeRaw`INSERT INTO "OperatorAuthState" ("id", "activeFingerprint", "activeEpoch", "windowStartedAt", "attemptCount") VALUES ('operator', ${fingerprint}, ${epoch}, (clock_timestamp() AT TIME ZONE 'UTC'), 0) ON CONFLICT ("id") DO NOTHING`;
      return changed === 1;
    },
    activate({ fingerprint, epoch }, expectedFingerprint) {
      return transaction(async tx => {
        const state = await lockState(tx);
        if (!state || state.activeFingerprint !== expectedFingerprint || state.activeFingerprint === fingerprint || state.activeEpoch === epoch) return false;
        const now = await databaseTime(tx);
        await tx.operatorAuthState.update({ where: { id: "operator" }, data: { activeFingerprint: fingerprint, activeEpoch: epoch } });
        await tx.operatorSession.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } });
        return true;
      });
    },
    async revokeAll() {
      await transaction(async tx => {
        const state = await lockState(tx);
        if (!state) throw new Error("Authentication is not initialized");
        const now = await databaseTime(tx);
        await tx.operatorSession.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } });
      });
    }
  };
}
