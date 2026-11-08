import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { SearchDocument } from "../lib/search/types";
import {
  RetrievalEvaluator,
  resolveEvaluationMode,
  type EvaluationMode,
  type PilotDataset,
  type PilotQuery
} from "../lib/search/evaluation";
import { FROZEN_SEMANTIC_POLICY, isProfileCompatibleWithPolicy } from "../lib/search/semantic-policy";
import { readVectorAtRow, BYTES_PER_FLOAT32 } from "../lib/search/vector-io";
import {
  DeterministicMockEmbeddingGenerator,
  TeiEmbeddingGenerator
} from "../lib/search/vector-builder";
import { DEFAULT_MODEL_PROFILE, type EmbeddingGenerator } from "../lib/search/vector-types";
import { formatQueryForEmbedding } from "../lib/search/query-embedder";
import { prepareQuery } from "../lib/search/ranking";

async function main() {
  const args = process.argv.slice(2);
  const isDevOnly = args.includes("--dev-only");
  const isReservedOnly = args.includes("--reserved");
  // Mock vectors are used only when explicitly requested. Without a real embedding provider
  // and real document vectors, the default run is lexical_only and makes no semantic claim.
  const isMockFixture = args.includes("--mock-fixture");
  const splitFilter = isDevOnly ? "dev" : isReservedOnly ? "reserved" : undefined;

  console.log("=== Atlas Search Retrieval Evaluation (F8) ===");

  const dataDir = resolve(process.cwd(), "data", "search");
  const docsPath = resolve(dataDir, "documents.json");
  const pilotPath = resolve(dataDir, "pilot-queries.json");
  const vectorsPath = resolve(dataDir, "vectors.f32");
  const manifestPath = resolve(dataDir, "manifest.json");
  const outputPath = resolve(dataDir, "evaluation-pilot.json");

  if (!existsSync(docsPath) || !existsSync(pilotPath)) {
    console.error("Missing documents.json or pilot-queries.json in data/search/");
    process.exit(1);
  }

  const documents: SearchDocument[] = JSON.parse(readFileSync(docsPath, "utf8"));
  const pilotDataset: PilotDataset = JSON.parse(readFileSync(pilotPath, "utf8"));

  console.log(`Loaded ${documents.length} eligible documents and ${pilotDataset.intents.length} pilot intents.`);

  const vectorMap = new Map<number, Float32Array>();
  const dimensions = 1024;
  const mockGen = new DeterministicMockEmbeddingGenerator(dimensions);
  const embeddingEndpoint = process.env.EMBEDDING_SERVICE_URL || process.env.TEI_ENDPOINT || "";

  // Inspect on-disk vectors and manifest (if any) before deciding the mode.
  let onDiskVectorProvider: "tei" | "mock" | "remote" | null = null;
  let onDiskProfileCompatible = false;
  let vectorBuffer: Buffer | null = null;
  if (existsSync(vectorsPath) && existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.modelProfile?.provider) {
      onDiskVectorProvider = manifest.modelProfile.provider;
      onDiskProfileCompatible = isProfileCompatibleWithPolicy(manifest.modelProfile);
      vectorBuffer = readFileSync(vectorsPath);
      console.log(`Found vectors.f32 (Profile: ${manifest.modelProfile.modelId ?? "unknown"}, provider: ${onDiskVectorProvider}).`);
    }
  }

  const evaluationMode: EvaluationMode = resolveEvaluationMode({
    mockFixtureRequested: isMockFixture,
    realQueryProviderConfigured: embeddingEndpoint !== "",
    onDiskVectorProvider,
    onDiskProfileCompatible
  });

  if (vectorBuffer && (evaluationMode === "production_semantic" || evaluationMode === "mock_fixture")) {
    const rowBytes = dimensions * BYTES_PER_FLOAT32;
    const count = Math.floor(vectorBuffer.length / rowBytes);
    console.log(`Loading ${count} binary vectors from vectors.f32...`);
    for (let r = 0; r < count; r++) {
      vectorMap.set(r, readVectorAtRow(vectorBuffer, r, dimensions));
    }
  } else if (evaluationMode === "mock_fixture") {
    console.log("Mock fixture mode (explicit): generating deterministic mock vectors for the first 200 documents.");
    const docsToVectorize = documents.slice(0, 200);
    const texts = docsToVectorize.map((d) => d.retrievalText || d.title);
    const generated = await mockGen.generateBatches(texts);
    for (let i = 0; i < docsToVectorize.length; i++) {
      docsToVectorize[i].vectorRow = i;
      vectorMap.set(i, generated[i]);
    }
  } else if (evaluationMode === "lexical_only") {
    console.log(
      "No usable real semantic setup (need on-disk vectors for the policy profile AND EMBEDDING_SERVICE_URL/TEI_ENDPOINT). Running lexical_only; semantic quality is NOT measured."
    );
  }

  // Query embeddings come from the real provider only in production_semantic mode.
  const queryGen: EmbeddingGenerator | null =
    evaluationMode === "production_semantic"
      ? new TeiEmbeddingGenerator(embeddingEndpoint, dimensions)
      : evaluationMode === "mock_fixture"
        ? mockGen
        : null;

  // Generate query embeddings
  console.log(queryGen ? "Generating query embeddings using task instruction..." : "Skipping query embeddings (lexical_only).");
  const queryVectorMap = new Map<string, Float32Array>();
  const allQueries: PilotQuery[] = [];
  for (const intent of pilotDataset.intents) {
    for (const q of intent.queries) {
      allQueries.push(q);
    }
  }

  // Identical to what the website sends: the prepared (NFKC, case-folded) request with the
  // instruction prefix. Documents are embedded without any prefix.
  const queryTexts = allQueries.map((q) => formatQueryForEmbedding(DEFAULT_MODEL_PROFILE, prepareQuery(q.queryText).embeddingText));
  if (queryGen) {
    const queryVectors = await queryGen.generateBatches(queryTexts);
    for (let i = 0; i < allQueries.length; i++) {
      queryVectorMap.set(allQueries[i].queryId, queryVectors[i]);
    }
  }

  // Run evaluator
  const evaluator = new RetrievalEvaluator(
    documents,
    vectorMap,
    FROZEN_SEMANTIC_POLICY,
    evaluationMode
  );
  console.log(`Evaluating ${splitFilter ? splitFilter.toUpperCase() : "ALL"} queries (Mode: ${evaluationMode})...`);
  const result = evaluator.evaluatePilot(pilotDataset, queryVectorMap, splitFilter);

  // Write evaluation report JSON
  writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`Saved evaluation results to ${outputPath}`);

  console.log("\n=== Pilot Retrieval Evaluation Summary ===");
  console.log(`Evaluation Mode: ${result.summary.evaluationMode}`);
  console.log(`Semantic Status: ${result.summary.semanticStatus.toUpperCase()}`);
  for (const caveat of result.summary.caveats) console.log(`  Caveat: ${caveat}`);
  console.log(
    `Total Queries Evaluated: ${result.summary.totalQueries} (Dev: ${result.summary.devQueries}, Reserved: ${result.summary.reservedQueries})`
  );
  console.log(
    `Semantic Cutoff Threshold: ${result.summary.policy.semanticCutoffThreshold} (${result.summary.policy.calibrationStatus})`
  );
  console.log(`RRF Constant (k): ${result.summary.policy.rrfConstantK}`);
  console.log("\nSupported Discovery Queries (MRR / Precision@3):");
  console.log(
    `  Keyword: MRR = ${result.summary.byCategory.supported.mrr.keyword}, P@3 = ${result.summary.byCategory.supported.avgP3.keyword}`
  );
  console.log(
    `  Semantic: MRR = ${result.summary.byCategory.supported.mrr.semantic ?? "N/A"}, P@3 = ${result.summary.byCategory.supported.avgP3.semantic ?? "N/A"}`
  );
  console.log(
    `  Hybrid (RRF): MRR = ${result.summary.byCategory.supported.mrr.hybrid}, P@3 = ${result.summary.byCategory.supported.avgP3.hybrid}`
  );
  console.log("\nUnrelated Queries Suppression Rate (zero results returned; n/a means not measured):");
  console.log(`  Keyword: ${(result.summary.byCategory.unrelated.suppressionRate.keyword * 100).toFixed(1)}%`);
  console.log(
    `  Semantic: ${result.summary.byCategory.unrelated.suppressionRate.semantic !== null ? `${(result.summary.byCategory.unrelated.suppressionRate.semantic * 100).toFixed(1)}%` : "n/a (not measured with a real model)"}`
  );
  console.log(`  Hybrid: ${(result.summary.byCategory.unrelated.suppressionRate.hybrid * 100).toFixed(1)}%`);
  const gap = result.summary.byCategory.unsupported_condition;
  console.log("\nUnsupported/Negation Condition Handling (excerpt content is not assessed):");
  console.log(`  Zero results: ${gap.zeroResult} / ${gap.count}`);
  console.log(`  Returned with non-empty excerpts: ${gap.returnedWithExcerpt} / ${gap.count}`);
  console.log(`  Returned without an excerpt: ${gap.returnedWithoutExcerpt} / ${gap.count}`);
  const lat = result.summary.meanLatencyMs;
  console.log(`\nMean offline retrieval timing, embedding excluded (ms): keyword ${lat.keyword}, semantic ${lat.semantic}, hybrid ${lat.hybrid}`);
  console.log("\nLanguage Breakdown (Avg Hybrid P@3):");
  console.log(`  Thai (th): ${result.summary.byLanguage.th.avgHybridP3}`);
  console.log(`  English (en): ${result.summary.byLanguage.en.avgHybridP3}`);
  console.log("=== Evaluation Complete ===");
}

main().catch((err) => {
  console.error("Evaluation script failed:", err);
  process.exit(1);
});
