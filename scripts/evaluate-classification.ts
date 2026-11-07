#!/usr/bin/env tsx
/**
 * R3: Evaluate Bilingual Classification and Evidence Uncertainty CLI
 * 
 * Executes benchmark against both baseline and calibrated classifiers,
 * displays evaluation metrics and false-positive containment, and records report.
 */

import fs from "node:fs";
import path from "node:path";
import { runBenchmarkEvaluation } from "../lib/classification/benchmark-evaluator";

async function main() {
  console.log("================================================================================");
  console.log(" [R3] Evaluating Bilingual Classification & Evidence Uncertainty (Audit D05)");
  console.log("================================================================================\n");

  const report = runBenchmarkEvaluation();
  const reportPath = path.resolve(process.cwd(), "data/evaluation/classification-evaluation-report.json");

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Saved evaluation report to: ${reportPath}\n`);

  const { baseline, calibrated, improvements } = report.summary;

  console.log("--- Benchmark Evaluation Summary ---");
  console.log(`Total Cases Evaluated: ${report.totalCases} (Real Seed: 16, Synthetic Fixtures: 16)`);
  console.log(`Benchmark Version: ${report.benchmarkVersion} | Evaluated At: ${report.evaluatedAt}\n`);

  console.table([
    {
      Metric: "Overall Relevance Accuracy",
      Baseline: `${(baseline.relevanceAccuracy * 100).toFixed(1)}% (${baseline.correctRelevanceCount}/${baseline.totalCases})`,
      Calibrated: `${(calibrated.relevanceAccuracy * 100).toFixed(1)}% (${calibrated.correctRelevanceCount}/${calibrated.totalCases})`,
      Delta: `${improvements.accuracyDelta >= 0 ? "+" : ""}${(improvements.accuracyDelta * 100).toFixed(1)}%`
    },
    {
      Metric: "Synthetic Traps False Positives",
      Baseline: `${baseline.syntheticTrapsFalsePositives}/${baseline.syntheticTrapsCount} (${(baseline.syntheticTrapsFalsePositiveRate * 100).toFixed(1)}% FPR)`,
      Calibrated: `${calibrated.syntheticTrapsFalsePositives}/${calibrated.syntheticTrapsCount} (${(calibrated.syntheticTrapsFalsePositiveRate * 100).toFixed(1)}% FPR)`,
      Delta: `-${improvements.trapFalsePositiveReduction} false positives`
    },
    {
      Metric: "Synthetic Traps TNR (Specific Rejection)",
      Baseline: `${(baseline.syntheticTrapsTrueNegativeRate * 100).toFixed(1)}%`,
      Calibrated: `${(calibrated.syntheticTrapsTrueNegativeRate * 100).toFixed(1)}%`,
      Delta: `+${((calibrated.syntheticTrapsTrueNegativeRate - baseline.syntheticTrapsTrueNegativeRate) * 100).toFixed(1)}%`
    },
    {
      Metric: "Insufficient Evidence Uncertainty (D05)",
      Baseline: `${baseline.insufficientEvidenceCorrectlyUncertainCount}/${baseline.insufficientEvidenceCount} (${(baseline.insufficientEvidenceUncertaintyRate * 100).toFixed(1)}%)`,
      Calibrated: `${calibrated.insufficientEvidenceCorrectlyUncertainCount}/${calibrated.insufficientEvidenceCount} (${(calibrated.insufficientEvidenceUncertaintyRate * 100).toFixed(1)}%)`,
      Delta: `${improvements.uncertaintyDetectionDelta >= 0 ? "+" : ""}${(improvements.uncertaintyDetectionDelta * 100).toFixed(1)}%`
    },
    {
      Metric: "Privacy Stance & Sentiment Disentanglement",
      Baseline: `${baseline.privacyStanceCorrectCount}/${baseline.privacyCasesCount} (${(baseline.privacyStanceAccuracy * 100).toFixed(1)}%)`,
      Calibrated: `${calibrated.privacyStanceCorrectCount}/${calibrated.privacyCasesCount} (${(calibrated.privacyStanceAccuracy * 100).toFixed(1)}%)`,
      Delta: `${improvements.privacyStanceDelta >= 0 ? "+" : ""}${(improvements.privacyStanceDelta * 100).toFixed(1)}%`
    },
    {
      Metric: "Auto-Publication Safety Rate",
      Baseline: `${(baseline.autoPublishSafetyRate * 100).toFixed(1)}% (${baseline.autoPublishFalsePositivesCount} unsafe publishes)`,
      Calibrated: `${(calibrated.autoPublishSafetyRate * 100).toFixed(1)}% (${calibrated.autoPublishFalsePositivesCount} unsafe publishes)`,
      Delta: `${improvements.autoPublishSafetyDelta >= 0 ? "+" : ""}${(improvements.autoPublishSafetyDelta * 100).toFixed(1)}%`
    }
  ]);

  console.log("\n--- Breakdown by Language ---");
  console.table([
    {
      Language: "English (EN)",
      BaselineAccuracy: `${(baseline.byLanguage.en.accuracy * 100).toFixed(1)}% (${baseline.byLanguage.en.correct}/${baseline.byLanguage.en.total})`,
      CalibratedAccuracy: `${(calibrated.byLanguage.en.accuracy * 100).toFixed(1)}% (${calibrated.byLanguage.en.correct}/${calibrated.byLanguage.en.total})`
    },
    {
      Language: "Thai (TH)",
      BaselineAccuracy: `${(baseline.byLanguage.th.accuracy * 100).toFixed(1)}% (${baseline.byLanguage.th.correct}/${baseline.byLanguage.th.total})`,
      CalibratedAccuracy: `${(calibrated.byLanguage.th.accuracy * 100).toFixed(1)}% (${calibrated.byLanguage.th.correct}/${calibrated.byLanguage.th.total})`
    },
    {
      Language: "Bilingual (EN/TH)",
      BaselineAccuracy: `${(baseline.byLanguage.bilingual.accuracy * 100).toFixed(1)}% (${baseline.byLanguage.bilingual.correct}/${baseline.byLanguage.bilingual.total})`,
      CalibratedAccuracy: `${(calibrated.byLanguage.bilingual.accuracy * 100).toFixed(1)}% (${calibrated.byLanguage.bilingual.correct}/${calibrated.byLanguage.bilingual.total})`
    }
  ]);

  console.log("\n--- Breakdown by Source ---");
  console.table([
    {
      Source: "Real Seed Records",
      BaselineAccuracy: `${(baseline.bySource.real_seed.accuracy * 100).toFixed(1)}% (${baseline.bySource.real_seed.correct}/${baseline.bySource.real_seed.total})`,
      CalibratedAccuracy: `${(calibrated.bySource.real_seed.accuracy * 100).toFixed(1)}% (${calibrated.bySource.real_seed.correct}/${calibrated.bySource.real_seed.total})`
    },
    {
      Source: "Synthetic Fixtures (Traps & Placeholders)",
      BaselineAccuracy: `${(baseline.bySource.synthetic_fixture.accuracy * 100).toFixed(1)}% (${baseline.bySource.synthetic_fixture.correct}/${baseline.bySource.synthetic_fixture.total})`,
      CalibratedAccuracy: `${(calibrated.bySource.synthetic_fixture.accuracy * 100).toFixed(1)}% (${calibrated.bySource.synthetic_fixture.correct}/${calibrated.bySource.synthetic_fixture.total})`
    }
  ]);

  // Acceptance Verification Gate
  console.log("\n--- Acceptance Gate Verification ---");
  const checks = [
    {
      description: "Synthetic traps false positive rate is 0%",
      passed: calibrated.syntheticTrapsFalsePositives === 0
    },
    {
      description: "Insufficient evidence and placeholders are 100% marked UNCERTAIN",
      passed: calibrated.insufficientEvidenceCorrectlyUncertainCount === calibrated.insufficientEvidenceCount
    },
    {
      description: "Auto-publication gate eliminates unsafe auto-publishes on benchmark corpus (0 leaks on benchmark)",
      passed: calibrated.autoPublishFalsePositivesCount === 0
    },
    {
      description: "Privacy telemetry stance is disentangled from skepticism (100% accurate)",
      passed: calibrated.privacyStanceCorrectCount === calibrated.privacyCasesCount
    },
    {
      description: "Overall relevance accuracy exceeds 90%",
      passed: calibrated.relevanceAccuracy >= 0.90
    }
  ];

  let allPassed = true;
  for (const check of checks) {
    const mark = check.passed ? "✔ PASS" : "✖ FAIL";
    console.log(`[${mark}] ${check.description}`);
    if (!check.passed) allPassed = false;
  }

  if (!allPassed) {
    console.error("\n❌ Acceptance verification failed.");
    process.exit(1);
  }

  console.log("\n✅ All acceptance checks verified successfully.");
}

main().catch((err) => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});
