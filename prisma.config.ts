import "./lib/load-env";
import { defineConfig } from "prisma/config";

// `prisma generate` (run by postinstall and build) never connects, so it may run
// without DATABASE_URL: any command line containing a `generate` argument gets the
// local placeholder below. Other commands still fail without DATABASE_URL: this config throws
// "DATABASE_URL is required (direct postgresql:// URL)."
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
    // Same form as package.json "network:check". Checked on macOS; Windows and Linux untested.
    seed: "node --import tsx prisma/seed.ts"
  }
});
