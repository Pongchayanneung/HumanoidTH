import { resolve, join } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { VectorReleaseBuilder } from "../lib/search/vector-builder";
import {
  validateVectorRelease,
  calculateCompletionForecast
} from "../lib/search/vector-io";
import { DEFAULT_MODEL_PROFILE, MOCK_MODEL_PROFILE } from "../lib/search/vector-types";
import type { SearchDocument } from "../lib/search/types";

async function main() {
  const args = process.argv.slice(2);
  const isKeywordOnly = args.includes("--keyword-only");
  const isValidateOnly = args.includes("--validate");
  const isForecastOnly = args.includes("--forecast");
  const isMock = args.includes("--mock");

  const limitArgIdx = args.indexOf("--limit");
  const maxVectors = limitArgIdx !== -1 ? parseInt(args[limitArgIdx + 1], 10) : undefined;

  const completedArgIdx = args.indexOf("--completed");
  const cliCompleted = completedArgIdx !== -1 ? parseInt(args[completedArgIdx + 1], 10) : undefined;

  const elapsedArgIdx = args.indexOf("--elapsed-sec");
  const cliElapsed = elapsedArgIdx !== -1 ? parseFloat(args[elapsedArgIdx + 1]) : undefined;

  console.log("=== Atlas Search Vector Release Builder (F4) ===");

  const dataDir = resolve(process.cwd(), "data", "search");
  const checkpointDir = resolve(process.cwd(), ".cache", "search-vector-checkpoints");
  const documentsPath = resolve(dataDir, "documents.json");
  const vectorsPath = resolve(dataDir, "vectors.f32");
  const manifestPath = resolve(dataDir, "manifest.json");

  if (isForecastOnly) {
    console.log("Running Hour 3 completion forecast calculation...");
    if (!existsSync(documentsPath)) {
      console.error(`Documents file not found at ${documentsPath}`);
      process.exit(1);
    }
    const docs = JSON.parse(readFileSync(documentsPath, "utf8"));
    const totalDocuments = docs.length;

    let completedDocuments = cliCompleted;
    let elapsedSeconds = cliElapsed;

    // If not supplied via CLI flags, inspect actual checkpoint directory
    if (completedDocuments === undefined || elapsedSeconds === undefined) {
      if (existsSync(checkpointDir)) {
        const cpFiles = readdirSync(checkpointDir).filter((f) => f.endsWith(".json"));
        if (cpFiles.length > 0) {
          let count = 0;
          let minMtime = Infinity;
          let maxMtime = -Infinity;
          for (const file of cpFiles) {
            try {
              const p = join(checkpointDir, file);
              const stat = statSync(p);
              if (stat.mtimeMs < minMtime) minMtime = stat.mtimeMs;
              if (stat.mtimeMs > maxMtime) maxMtime = stat.mtimeMs;
              const content = JSON.parse(readFileSync(p, "utf8"));
              if (Array.isArray(content.entries)) {
                count += content.entries.length;
              }
            } catch {
              // ignore unreadable checkpoint
            }
          }
          if (count > 0) {
            completedDocuments = completedDocuments ?? count;
            const diffSec = Math.max(1, (maxMtime - minMtime) / 1000);
            elapsedSeconds = elapsedSeconds ?? diffSec;
            console.log(
              `Derived measured progress from ${cpFiles.length} disk checkpoints: ${completedDocuments} docs across ${elapsedSeconds.toFixed(1)}s`
            );
          }
        }
      }
    }

    // If still undefined, fallback with explicit warning
    if (completedDocuments === undefined || elapsedSeconds === undefined) {
      console.warn(
        "Warning: No active checkpoints or CLI inputs found. Using sample baseline (1,500 docs in 3.0 hrs) for demonstration."
      );
      completedDocuments = 1500;
      elapsedSeconds = 3 * 3600;
    }

    const forecast = calculateCompletionForecast({
      totalDocuments,
      completedDocuments,
      elapsedSeconds,
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
    if (!existsSync(documentsPath) || !existsSync(manifestPath)) {
      console.error("Documents or manifest file not found in data/search/");
      process.exit(1);
    }
    const documents: SearchDocument[] = JSON.parse(readFileSync(documentsPath, "utf8"));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const buffer = existsSync(vectorsPath) ? readFileSync(vectorsPath) : Buffer.alloc(0);

    const validation = validateVectorRelease({
      buffer,
      documents,
      expectedDimensions: manifest.modelProfile?.dimensions || DEFAULT_MODEL_PROFILE.dimensions,
      manifest,
      manifestDir: dataDir
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

  // Choose profile based on mode
  const profile = isMock ? MOCK_MODEL_PROFILE : undefined;

  const builder = new VectorReleaseBuilder({
    documentsPath,
    outputDir: dataDir,
    profile,
    maxVectorsToGenerate: isKeywordOnly ? 0 : maxVectors
  });

  console.log(
    `Building release (Mode: ${
      isKeywordOnly ? "Keyword-only" : isMock ? "Mock semantic (deterministic)" : "Production semantic"
    }, Limit: ${maxVectors ?? "All"})...`
  );

  const result = await builder.build();

  console.log("\n=== Vector Release Summary ===");
  console.log(`Release ID: ${result.manifest.releaseId}`);
  console.log(`Model Profile: ${result.manifest.modelProfile?.modelId ?? "none"}`);
  console.log(`Coverage Status: ${result.coverage.status.toUpperCase()}`);
  console.log(
    `Vectors Encoded: ${result.coverage.vectorCount} / ${result.coverage.totalDocuments} (${result.coverage.overallCoveragePct.toFixed(1)}%)`
  );
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
