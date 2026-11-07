import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { VectorReleaseBuilder } from "../lib/search/vector-builder";
import {
  validateVectorRelease,
  calculateCompletionForecast
} from "../lib/search/vector-io";
import { DEFAULT_MODEL_PROFILE } from "../lib/search/vector-types";
import type { SearchDocument } from "../lib/search/types";

async function main() {
  const args = process.argv.slice(2);
  const isKeywordOnly = args.includes("--keyword-only");
  const isValidateOnly = args.includes("--validate");
  const isForecastOnly = args.includes("--forecast");

  const limitArgIdx = args.indexOf("--limit");
  const maxVectors = limitArgIdx !== -1 ? parseInt(args[limitArgIdx + 1], 10) : undefined;

  console.log("=== Atlas Search Vector Release Builder (F4) ===");

  const dataDir = resolve(process.cwd(), "data", "search");
  const documentsPath = resolve(dataDir, "documents.json");
  const vectorsPath = resolve(dataDir, "vectors.f32");

  if (isForecastOnly) {
    console.log("Running Hour 3 completion forecast calculation...");
    const docs = JSON.parse(readFileSync(documentsPath, "utf8"));
    // Benchmark 128 probe sample or simulate 30 mins progress
    const forecast = calculateCompletionForecast({
      totalDocuments: docs.length,
      completedDocuments: 1500, // sample progress at Hour 3
      elapsedSeconds: 3 * 3600,  // 3 hours
      deadlineSeconds: 4.5 * 3600 // 4.5 hours
    });
    console.log("\n=== Completion Forecast (with 50% contingency buffer) ===");
    console.log(forecast.formattedSummary);
    console.log(`Remaining documents to index: ${forecast.remainingDocuments}`);
    console.log(`Estimated raw time needed: ${(forecast.estimatedRemainingSeconds / 60).toFixed(1)} mins`);
    console.log(`50% contingency buffer: ${(forecast.contingencySeconds / 60).toFixed(1)} mins`);
    console.log(`Total forecast time needed: ${(forecast.totalForecastRemainingSeconds / 60).toFixed(1)} mins`);
    console.log(`Meets Hour 4½ Gate: ${forecast.meetsDeadline ? "YES" : "NO"}`);
    return;
  }

  if (isValidateOnly) {
    console.log("Validating existing vector release...");
    if (!existsSync(vectorsPath) || !existsSync(documentsPath)) {
      console.error("Vectors file or documents file not found in data/search/");
      process.exit(1);
    }
    const buffer = readFileSync(vectorsPath);
    const documents: SearchDocument[] = JSON.parse(readFileSync(documentsPath, "utf8"));
    const validation = validateVectorRelease({
      buffer,
      documents,
      expectedDimensions: DEFAULT_MODEL_PROFILE.dimensions
    });
    console.log("\n=== Validation Results ===");
    console.log(`Is Valid: ${validation.isValid}`);
    console.log(`Vector Count: ${validation.vectorCount}`);
    console.log(`Byte Size: ${validation.actualBytes} bytes (expected ${validation.expectedBytes})`);
    console.log("Checks:");
    for (const chk of validation.checks) {
      console.log(`  [${chk.passed ? "PASS" : "FAIL"}] ${chk.name}: ${chk.detail}`);
    }
    if (!validation.isValid) {
      console.error("Errors:", validation.errors);
      process.exit(1);
    }
    return;
  }

  const builder = new VectorReleaseBuilder({
    documentsPath,
    outputDir: dataDir,
    maxVectorsToGenerate: isKeywordOnly ? 0 : maxVectors
  });

  console.log(`Building release (Mode: ${isKeywordOnly ? "Keyword-only" : maxVectors ? `Partial (${maxVectors} vectors)` : "Full semantic"})...`);
  const result = await builder.build();

  console.log("\n=== Vector Release Summary ===");
  console.log(`Release ID: ${result.manifest.releaseId}`);
  console.log(`Coverage Status: ${result.coverage.status.toUpperCase()}`);
  console.log(`Vectors Encoded: ${result.coverage.vectorCount} / ${result.coverage.totalDocuments} (${result.coverage.overallCoveragePct.toFixed(1)}%)`);
  console.log("Coverage by Kind:");
  for (const [kind, stats] of Object.entries(result.coverage.byKind)) {
    console.log(`  ${kind}: ${stats.indexed} / ${stats.total} (${stats.coveragePct.toFixed(1)}%)`);
  }
  console.log(`Record Keys Hash: ${result.manifest.recordKeysHash ?? "none"}`);
  console.log(`Validation Passed: ${result.validation.isValid}`);
  console.log("Promoted Files:", result.promotedFiles);
  console.log("=== Build Complete ===");
}

main().catch((err) => {
  console.error("Vector release build failed:", err);
  process.exit(1);
});
