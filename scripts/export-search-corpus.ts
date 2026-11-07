import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { exportSearchCorpusFromSeed } from "../lib/search/exporter";

async function main() {
  console.log("=== Atlas Search Corpus Exporter (F3) ===");
  const outputDir = resolve(process.cwd(), "data", "search");
  mkdirSync(outputDir, { recursive: true });

  console.log("Exporting eligible public corpus from authoritative seed...");
  const { documents, manifest, probe128 } = exportSearchCorpusFromSeed();

  const documentsPath = resolve(outputDir, "documents.json");
  const manifestPath = resolve(outputDir, "manifest.json");
  const probePath = resolve(outputDir, "probe-128.json");

  console.log(`Writing documents to ${documentsPath}...`);
  writeFileSync(documentsPath, JSON.stringify(documents, null, 2), "utf8");

  console.log(`Writing manifest to ${manifestPath}...`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`Writing probe sample to ${probePath}...`);
  writeFileSync(probePath, JSON.stringify(probe128, null, 2), "utf8");

  console.log("\n=== Export Summary ===");
  console.log(`Total Eligible Documents: ${manifest.counts.totalEligible}`);
  console.log("By Record Kind:", manifest.counts.byKind);
  console.log("By Language Tag:", manifest.counts.byLanguage);
  console.log(`Excluded Records: ${manifest.counts.excluded}`);
  console.log("Empty Categories:", manifest.counts.emptyKinds);
  console.log(`Probe Sample Count: ${probe128.length}`);
  console.log(`Records SHA-256: ${manifest.recordsSha256}`);
  console.log("=== Export Complete ===");
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
