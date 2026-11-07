import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { SearchDocument } from "../lib/search/types";
import {
  RetrievalEvaluator,
  type PilotDataset,
  type PilotQuery
} from "../lib/search/evaluation";
import { FROZEN_SEMANTIC_POLICY } from "../lib/search/semantic-policy";
import { readVectorAtRow, BYTES_PER_FLOAT32 } from "../lib/search/vector-io";
import { DeterministicMockEmbeddingGenerator } from "../lib/search/vector-builder";
import { MOCK_MODEL_PROFILE } from "../lib/search/vector-types";

async function main() {
  const args = process.argv.slice(2);
  const isDevOnly = args.includes("--dev-only");
  const isReservedOnly = args.includes("--reserved");
  const isMockFixture = args.includes("--mock-fixture") || true; // Default to mock fixture for local evaluation
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

  let evaluationMode: "mock_fixture" | "production_semantic" | "lexical_only" = "lexical_only";

  // Check on-disk vectors and manifest
  if (existsSync(vectorsPath) && existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const vectorBuffer = readFileSync(vectorsPath);
    const rowBytes = dimensions * BYTES_PER_FLOAT32;
    const count = Math.floor(vectorBuffer.length / rowBytes);
    console.log(`Loading ${count} binary vectors from vectors.f32 (Profile: ${manifest.modelProfile?.modelId ?? "unknown"})...`);
    for (let r = 0; r < count; r++) {
      vectorMap.set(r, readVectorAtRow(vectorBuffer, r, dimensions));
    }
    evaluationMode = manifest.modelProfile?.provider === "mock" ? "mock_fixture" : "production_semantic";
  } else if (isMockFixture) {
    console.log("Mock fixture mode: generating deterministic mock vectors for documents to evaluate semantic similarity...");
    // Vectorize non-source documents and a representative sample of sources
    const docsToVectorize = documents.slice(0, 200);
    const texts = docsToVectorize.map((d) => d.retrievalText || d.title);
    const generated = await mockGen.generateBatches(texts);
    for (let i = 0; i < docsToVectorize.length; i++) {
      docsToVectorize[i].vectorRow = i;
      vectorMap.set(i, generated[i]);
    }
    evaluationMode = "mock_fixture";
  }

  // Generate query embeddings
  console.log("Generating query embeddings using task instruction...");
  const queryVectorMap = new Map<string, Float32Array>();
  const allQueries: PilotQuery[] = [];
  for (const intent of pilotDataset.intents) {
    for (const q of intent.queries) {
      allQueries.push(q);
    }
  }

  const instruction = FROZEN_SEMANTIC_POLICY.queryInstructionTask;
  const queryTexts = allQueries.map((q) => `${instruction} ${q.queryText}`);
  const queryVectors = await mockGen.generateBatches(queryTexts);
  for (let i = 0; i < allQueries.length; i++) {
    queryVectorMap.set(allQueries[i].queryId, queryVectors[i]);
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
  console.log(
    `Total Queries Evaluated: ${result.summary.totalQueries} (Dev: ${result.summary.devQueries}, Reserved: ${result.summary.reservedQueries})`
  );
  console.log(`Semantic Cutoff Threshold: ${result.summary.policy.semanticCutoffThreshold}`);
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
  console.log("\nUnrelated Queries Suppression Rate (Zero false matches):");
  console.log(`  Keyword: ${(result.summary.byCategory.unrelated.suppressionRate.keyword * 100).toFixed(1)}%`);
  console.log(
    `  Semantic: ${result.summary.byCategory.unrelated.suppressionRate.semantic !== null ? `${(result.summary.byCategory.unrelated.suppressionRate.semantic * 100).toFixed(1)}%` : "N/A"}`
  );
  console.log(`  Hybrid: ${(result.summary.byCategory.unrelated.suppressionRate.hybrid * 100).toFixed(1)}%`);
  console.log("\nUnsupported/Negation Condition Handling:");
  console.log(
    `  Inspectable evidence gap preserved: ${result.summary.byCategory.unsupported_condition.inspectableGapPreserved} / ${result.summary.byCategory.unsupported_condition.count}`
  );
  console.log("\nLanguage Breakdown (Avg Hybrid P@3):");
  console.log(`  Thai (th): ${result.summary.byLanguage.th.avgHybridP3}`);
  console.log(`  English (en): ${result.summary.byLanguage.en.avgHybridP3}`);
  console.log("=== Evaluation Complete ===");
}

main().catch((err) => {
  console.error("Evaluation script failed:", err);
  process.exit(1);
});
