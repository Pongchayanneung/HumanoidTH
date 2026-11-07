import "../lib/load-env";
import { createSeedClient, seedAtlasData } from "../lib/seed-importer";

// Explicit seeding only: createSeedClient() refuses unless ATLAS_ALLOW_SEED=1 and
// DATABASE_URL points at a local database (lib/seed-guard.ts).
let prisma: ReturnType<typeof createSeedClient>;
try {
  prisma = createSeedClient();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

seedAtlasData(prisma)
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
