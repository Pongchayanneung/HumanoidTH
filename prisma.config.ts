import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` (run by postinstall and build) never connects, so it may run
// without DATABASE_URL. Every other Prisma command still fails loudly without it.
const GENERATE_ONLY_URL = "postgresql://placeholder@localhost:5432/placeholder";

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.argv.includes("generate")) return GENERATE_ONLY_URL;
  throw new Error("DATABASE_URL is required (direct postgresql:// URL).");
}

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: databaseUrl()
  },
  migrations: {
    path: "prisma/migrations",
    // Same form as package.json "network:check"; works on macOS, Linux and Windows.
    seed: "node --import tsx prisma/seed.ts"
  }
});
