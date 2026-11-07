import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import {
  VectorReleaseBuilder,
  TeiEmbeddingGenerator,
  DeterministicMockEmbeddingGenerator
} from "../lib/search/vector-builder";
import {
  validateVectorRelease,
  calculateCompletionForecast,
  countCompletedCheckpointDocuments
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
    console.log("Running completion forecast (completed count from checkpoints; elapsed from --elapsed-sec)...");
    if (!existsSync(documentsPath)) {
      console.error(`Documents file not found at ${documentsPath}`);
      process.exit(1);
    }
    const docs = JSON.parse(readFileSync(documentsPath, "utf8"));
    const totalDocuments = docs.length;

    let completedDocuments = cliCompleted;
    const elapsedSeconds = cliElapsed;

    // Completed count: derived from checkpoints whose model profile hash matches and whose
    // typedId + contentHash equal the current documents. Elapsed time is NEVER inferred
    // from checkpoint file timestamps (a span between files excludes the first batch and
    // would overstate throughput), so it must be supplied with --elapsed-sec.
    if (completedDocuments === undefined) {
      const targetProfile = isMock ? MOCK_MODEL_PROFILE : DEFAULT_MODEL_PROFILE;
      const found = countCompletedCheckpointDocuments({
        checkpointDir,
        profileHash: targetProfile.profileHash,
        documents: docs
      });
      completedDocuments = found.completed;
      console.log(
        `Derived completed count from ${found.checkpointFiles} matching checkpoint file(s): ${found.completed} of ${totalDocuments} docs.`
      );
    }

    const isPositive = (n: number | undefined): n is number =>
      n !== undefined && Number.isFinite(n) && n > 0;

    if (!isPositive(completedDocuments) || !isPositive(elapsedSeconds)) {
      console.error(
        "Error: Not enough data for a completion forecast.\n" +
        `Completed documents: ${completedDocuments ?? "unknown"}; elapsed seconds: ${elapsedSeconds ?? "not supplied"}.\n` +
        "Pass --elapsed-sec <S> (time spent on the embedding run so far, measured by you), and make sure matching " +
        "checkpoints exist in .cache/search-vector-checkpoints or pass --completed <N>."
      );
      process.exit(1);
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
    if (!forecast.meetsDeadline) {
      console.log(
        "Forecast is LATE. Nothing was changed. To fall back, run the build yourself with --limit <N> to package a partial semantic release."
      );
    }
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

  // Production vs Mock vs Keyword-only configuration
  let profile = isMock ? MOCK_MODEL_PROFILE : DEFAULT_MODEL_PROFILE;
  let embeddingGenerator;

  if (isKeywordOnly) {
    console.log("Building release (Mode: Keyword-only, Limit: 0 vectors)...");
  } else if (isMock) {
    console.log(`Building release (Mode: Mock semantic (deterministic), Limit: ${maxVectors ?? "All"})...`);
    embeddingGenerator = new DeterministicMockEmbeddingGenerator(profile.dimensions);
  } else {
    // Production mode requires configured embedding service
    const endpoint = process.env.EMBEDDING_SERVICE_URL || process.env.TEI_ENDPOINT;
    if (!endpoint) {
      console.error(
        "Error: Production semantic builds require a real embedding service.\n" +
        "Configure EMBEDDING_SERVICE_URL (or TEI_ENDPOINT) in your environment, or pass --mock for deterministic local testing, or --keyword-only for keyword releases."
      );
      process.exit(1);
    }
    console.log(`Building release (Mode: Production semantic (${profile.modelId}), Endpoint: ${endpoint}, Limit: ${maxVectors ?? "All"})...`);
    embeddingGenerator = new TeiEmbeddingGenerator(endpoint, profile.dimensions);
  }

  const builder = new VectorReleaseBuilder({
    documentsPath,
    outputDir: dataDir,
    profile,
    embeddingGenerator,
    maxVectorsToGenerate: isKeywordOnly ? 0 : maxVectors
  });

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
