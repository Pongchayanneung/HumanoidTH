import "../lib/load-env";
import { stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSeedClient, seedAtlasData } from "../lib/seed-importer";

const datasetPath = resolve(process.cwd(), "thailand_humanoid_atlas_seed_records.json");
const debounceMs = 500;
let timer: NodeJS.Timeout | null = null;
let lastSignature = "";
let syncing = false;

function signature(text: string, mtimeMs: number) {
  return `${mtimeMs}:${text.length}:${text.slice(0, 256)}`;
}

async function sync(reason: string) {
  if (syncing) return;
  syncing = true;
  const prisma = createSeedClient();
  try {
    await seedAtlasData(prisma, datasetPath);
    console.log(`[seed-sync] ${reason}: synced ${pathToFileURL(datasetPath).pathname}`);
  } catch (error) {
    console.error("[seed-sync] sync failed:", error);
  } finally {
    await prisma.$disconnect();
    syncing = false;
  }
}

async function refreshSignature() {
  const [file, text] = await Promise.all([stat(datasetPath), readFile(datasetPath, "utf8")]);
  lastSignature = signature(text, file.mtimeMs);
  return lastSignature;
}

async function watch() {
  await refreshSignature();
  await sync("initial");
  console.log(`[seed-sync] watching ${datasetPath}`);

  setInterval(async () => {
    try {
      const [file, text] = await Promise.all([stat(datasetPath), readFile(datasetPath, "utf8")]);
      const nextSignature = signature(text, file.mtimeMs);
      if (nextSignature !== lastSignature) {
        lastSignature = nextSignature;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void sync("file-change");
        }, debounceMs);
      }
    } catch (error) {
      console.error("[seed-sync] watch error:", error);
    }
  }, 1000);
}

watch().catch((error) => {
  console.error("[seed-sync] watcher failed:", error);
  process.exit(1);
});
