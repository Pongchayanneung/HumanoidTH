/**
 * Benchmark Evaluator for Bilingual Classification and Evidence Uncertainty (Audit D05)
 * 
 * Compares the baseline substring classifier against the calibrated bilingual classifier.
 */

import fs from "node:fs";
import path from "node:path";
import { classifyRelevance as baselineClassifyRelevance, extractPerspective as baselineExtractPerspective } from "../classifiers";
import {
  classifyCalibratedRelevance,
  extractCalibratedPerspective,
  type CalibratedClassificationResult,
  type CalibratedPerspectiveResult,
  type RelevanceStatus
} from "./calibrated-classifier";

export interface BenchmarkCase {
  id: string;
  source: "real_seed" | "synthetic_fixture";
  language: "en" | "th" | "bilingual";
  category: string;
  title: string;
  excerpt: string;
  groundTruth: {
    relevanceStatus: RelevanceStatus;
    isRelevant: boolean;
    topicalRelevance: string;
    thailandConnection: boolean;
    evidenceSufficiency: string;
    expectedTheme: string;
    expectedStance: string;
    expectedSentiment: string;
    requiresHumanReview: boolean;
    autoPublishEligible: boolean;
    reason: string;
  };
}

export interface BenchmarkData {
  version: string;
  generatedAt: string;
  benchmarkDescription: string;
  metadata: {
    totalCases: number;
    realSeedCount: number;
    syntheticFixtureCount: number;
    languages: Record<string, number>;
    auditReferences: string[];
  };
  cases: BenchmarkCase[];
}

export interface SystemMetrics {
  totalCases: number;
  correctRelevanceCount: number;
  relevanceAccuracy: number;
  syntheticTrapsCount: number;
  syntheticTrapsFalsePositives: number;
  syntheticTrapsFalsePositiveRate: number;
  syntheticTrapsTrueNegativeRate: number;
  insufficientEvidenceCount: number;
  insufficientEvidenceCorrectlyUncertainCount: number;
  insufficientEvidenceUncertaintyRate: number;
  privacyCasesCount: number;
  privacyStanceCorrectCount: number;
  privacyStanceAccuracy: number;
  autoPublishFalsePositivesCount: number;
  autoPublishSafetyRate: number;
  byLanguage: {
    en: { total: number; correct: number; accuracy: number };
    th: { total: number; correct: number; accuracy: number };
    bilingual: { total: number; correct: number; accuracy: number };
  };
  bySource: {
    real_seed: { total: number; correct: number; accuracy: number };
    synthetic_fixture: { total: number; correct: number; accuracy: number };
  };
}

export interface CaseEvaluationResult {
  id: string;
  source: "real_seed" | "synthetic_fixture";
  language: "en" | "th" | "bilingual";
  category: string;
  title: string;
  groundTruth: BenchmarkCase["groundTruth"];
  baseline: {
    relevanceStatus: string;
    relevanceConfidence: number;
    relevanceReason: string;
    stance: string;
    sentiment: string;
    perspectiveTheme: string;
    isCorrectStatus: boolean;
    isTrapFalsePositive: boolean;
    autoPublishRisk: boolean;
  };
  calibrated: {
    relevanceStatus: string;
    calibratedConfidence: number;
    relevanceReason: string;
    evidenceSufficiency: string;
    topicalRelevance: string;
    thailandConnection: boolean;
    requiresHumanReview: boolean;
    autoPublishEligible: boolean;
    stance: string;
    sentiment: string;
    perspectiveTheme: string;
    isCorrectStatus: boolean;
    isTrapFalsePositive: boolean;
    autoPublishRisk: boolean;
  };
}

export interface BenchmarkEvaluationReport {
  evaluatedAt: string;
  benchmarkVersion: string;
  totalCases: number;
  summary: {
    baseline: SystemMetrics;
    calibrated: SystemMetrics;
    improvements: {
      accuracyDelta: number;
      trapFalsePositiveReduction: number;
      uncertaintyDetectionDelta: number;
      privacyStanceDelta: number;
      autoPublishSafetyDelta: number;
    };
  };
  details: CaseEvaluationResult[];
}

export function evaluateCase(c: BenchmarkCase): CaseEvaluationResult {
  // Baseline evaluation
  const baseRel = baselineClassifyRelevance(c.title, c.excerpt);
  const basePers = baselineExtractPerspective(c.title, c.excerpt);

  const baseIsCorrect = baseRel.relevanceStatus === c.groundTruth.relevanceStatus;
  const isTrapCase = [
    "software_android_trap",
    "non_robot_eldercare_trap",
    "substring_trap"
  ].includes(c.category);

  const baseIsTrapFP = isTrapCase && baseRel.relevanceStatus === "ACCEPTED";
  const baseAutoPublishRisk =
    !c.groundTruth.autoPublishEligible && baseRel.relevanceStatus === "ACCEPTED";

  // Calibrated evaluation
  const calRel = classifyCalibratedRelevance(c.title, c.excerpt);
  const calPers = extractCalibratedPerspective(c.title, c.excerpt);

  const calIsCorrect = calRel.relevanceStatus === c.groundTruth.relevanceStatus;
  const calIsTrapFP = isTrapCase && calRel.relevanceStatus === "ACCEPTED";
  const calAutoPublishRisk =
    !c.groundTruth.autoPublishEligible && calRel.autoPublishEligible;

  return {
    id: c.id,
    source: c.source,
    language: c.language,
    category: c.category,
    title: c.title,
    groundTruth: c.groundTruth,
    baseline: {
      relevanceStatus: baseRel.relevanceStatus,
      relevanceConfidence: baseRel.relevanceConfidence,
      relevanceReason: baseRel.relevanceReason,
      stance: basePers.stance,
      sentiment: basePers.sentiment,
      perspectiveTheme: basePers.perspectiveTheme,
      isCorrectStatus: baseIsCorrect,
      isTrapFalsePositive: baseIsTrapFP,
      autoPublishRisk: baseAutoPublishRisk
    },
    calibrated: {
      relevanceStatus: calRel.relevanceStatus,
      calibratedConfidence: calRel.calibratedConfidence,
      relevanceReason: calRel.relevanceReason,
      evidenceSufficiency: calRel.factors.evidenceSufficiency,
      topicalRelevance: calRel.factors.topicalRelevance,
      thailandConnection: calRel.factors.thailandConnection,
      requiresHumanReview: calRel.requiresHumanReview,
      autoPublishEligible: calRel.autoPublishEligible,
      stance: calPers.stance,
      sentiment: calPers.sentiment,
      perspectiveTheme: calPers.perspectiveTheme,
      isCorrectStatus: calIsCorrect,
      isTrapFalsePositive: calIsTrapFP,
      autoPublishRisk: calAutoPublishRisk
    }
  };
}

export function computeSystemMetrics(
  details: CaseEvaluationResult[],
  cases: BenchmarkCase[],
  system: "baseline" | "calibrated"
): SystemMetrics {
  const total = details.length;
  let correct = 0;
  let trapCount = 0;
  let trapFP = 0;
  let insufficientCount = 0;
  let insufficientUncertain = 0;
  let privacyCount = 0;
  let privacyCorrect = 0;
  let autoPublishRiskCount = 0;

  const langMap: Record<"en" | "th" | "bilingual", { total: number; correct: number }> = {
    en: { total: 0, correct: 0 },
    th: { total: 0, correct: 0 },
    bilingual: { total: 0, correct: 0 }
  };

  const srcMap: Record<"real_seed" | "synthetic_fixture", { total: number; correct: number }> = {
    real_seed: { total: 0, correct: 0 },
    synthetic_fixture: { total: 0, correct: 0 }
  };

  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const c = cases[i];
    const item = system === "baseline" ? d.baseline : d.calibrated;

    if (item.isCorrectStatus) {
      correct += 1;
    }

    langMap[c.language].total += 1;
    if (item.isCorrectStatus) langMap[c.language].correct += 1;

    srcMap[c.source].total += 1;
    if (item.isCorrectStatus) srcMap[c.source].correct += 1;

    const isTrap = [
      "software_android_trap",
      "non_robot_eldercare_trap",
      "substring_trap"
    ].includes(c.category);

    if (isTrap) {
      trapCount += 1;
      if (item.isTrapFalsePositive) trapFP += 1;
    }

    const isInsufficient = [
      "placeholder_openalex",
      "placeholder_generic",
      "title_only_thin"
    ].includes(c.category);

    if (isInsufficient) {
      insufficientCount += 1;
      if (item.relevanceStatus === "UNCERTAIN") {
        insufficientUncertain += 1;
      }
    }

    const isPrivacy = c.category === "privacy_telemetry_neutral";
    if (isPrivacy) {
      privacyCount += 1;
      const stanceMatches = item.stance === c.groundTruth.expectedStance;
      const sentimentMatches =
        !c.groundTruth.expectedSentiment || item.sentiment === c.groundTruth.expectedSentiment;
      if (stanceMatches && sentimentMatches) {
        privacyCorrect += 1;
      }
    }

    if (item.autoPublishRisk) {
      autoPublishRiskCount += 1;
    }
  }

  const invalidCasesCount = cases.filter((c) => !c.groundTruth.autoPublishEligible).length;
  const safeCount = invalidCasesCount - autoPublishRiskCount;

  return {
    totalCases: total,
    correctRelevanceCount: correct,
    relevanceAccuracy: total > 0 ? Number((correct / total).toFixed(4)) : 0,
    syntheticTrapsCount: trapCount,
    syntheticTrapsFalsePositives: trapFP,
    syntheticTrapsFalsePositiveRate: trapCount > 0 ? Number((trapFP / trapCount).toFixed(4)) : 0,
    syntheticTrapsTrueNegativeRate: trapCount > 0 ? Number(((trapCount - trapFP) / trapCount).toFixed(4)) : 1,
    insufficientEvidenceCount: insufficientCount,
    insufficientEvidenceCorrectlyUncertainCount: insufficientUncertain,
    insufficientEvidenceUncertaintyRate:
      insufficientCount > 0 ? Number((insufficientUncertain / insufficientCount).toFixed(4)) : 0,
    privacyCasesCount: privacyCount,
    privacyStanceCorrectCount: privacyCorrect,
    privacyStanceAccuracy: privacyCount > 0 ? Number((privacyCorrect / privacyCount).toFixed(4)) : 0,
    autoPublishFalsePositivesCount: autoPublishRiskCount,
    autoPublishSafetyRate: invalidCasesCount > 0 ? Number((safeCount / invalidCasesCount).toFixed(4)) : 1,
    byLanguage: {
      en: {
        total: langMap.en.total,
        correct: langMap.en.correct,
        accuracy: langMap.en.total > 0 ? Number((langMap.en.correct / langMap.en.total).toFixed(4)) : 0
      },
      th: {
        total: langMap.th.total,
        correct: langMap.th.correct,
        accuracy: langMap.th.total > 0 ? Number((langMap.th.correct / langMap.th.total).toFixed(4)) : 0
      },
      bilingual: {
        total: langMap.bilingual.total,
        correct: langMap.bilingual.correct,
        accuracy: langMap.bilingual.total > 0 ? Number((langMap.bilingual.correct / langMap.bilingual.total).toFixed(4)) : 0
      }
    },
    bySource: {
      real_seed: {
        total: srcMap.real_seed.total,
        correct: srcMap.real_seed.correct,
        accuracy: srcMap.real_seed.total > 0 ? Number((srcMap.real_seed.correct / srcMap.real_seed.total).toFixed(4)) : 0
      },
      synthetic_fixture: {
        total: srcMap.synthetic_fixture.total,
        correct: srcMap.synthetic_fixture.correct,
        accuracy: srcMap.synthetic_fixture.total > 0 ? Number((srcMap.synthetic_fixture.correct / srcMap.synthetic_fixture.total).toFixed(4)) : 0
      }
    }
  };
}

export function runBenchmarkEvaluation(benchmarkFilePath?: string): BenchmarkEvaluationReport {
  const defaultPath = path.resolve(process.cwd(), "data/evaluation/bilingual-classification-benchmark.json");
  const filePath = benchmarkFilePath || defaultPath;
  const rawData = fs.readFileSync(filePath, "utf-8");
  const benchmark: BenchmarkData = JSON.parse(rawData);

  const details = benchmark.cases.map(evaluateCase);

  const baselineMetrics = computeSystemMetrics(details, benchmark.cases, "baseline");
  const calibratedMetrics = computeSystemMetrics(details, benchmark.cases, "calibrated");

  return {
    evaluatedAt: new Date().toISOString(),
    benchmarkVersion: benchmark.version,
    totalCases: benchmark.cases.length,
    summary: {
      baseline: baselineMetrics,
      calibrated: calibratedMetrics,
      improvements: {
        accuracyDelta: Number((calibratedMetrics.relevanceAccuracy - baselineMetrics.relevanceAccuracy).toFixed(4)),
        trapFalsePositiveReduction: baselineMetrics.syntheticTrapsFalsePositives - calibratedMetrics.syntheticTrapsFalsePositives,
        uncertaintyDetectionDelta: Number((calibratedMetrics.insufficientEvidenceUncertaintyRate - baselineMetrics.insufficientEvidenceUncertaintyRate).toFixed(4)),
        privacyStanceDelta: Number((calibratedMetrics.privacyStanceAccuracy - baselineMetrics.privacyStanceAccuracy).toFixed(4)),
        autoPublishSafetyDelta: Number((calibratedMetrics.autoPublishSafetyRate - baselineMetrics.autoPublishSafetyRate).toFixed(4))
      }
    },
    details
  };
}
