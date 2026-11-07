import type { SearchDocument, LanguageTag } from "./types";
import { FROZEN_SEMANTIC_POLICY, type SemanticRetrievalPolicy } from "./semantic-policy";
import { cosineSimilarity } from "./vector-io";

export interface PilotQuery {
  queryId: string;
  lang: LanguageTag;
  queryText: string;
  targetKeywords: string[];
  expectedRelevantIds: string[];
}

export interface PilotIntent {
  intentId: string;
  category: "supported" | "unrelated" | "unsupported_condition";
  split: "dev" | "reserved";
  description: string;
  queries: PilotQuery[];
}

export interface PilotDataset {
  pilotVersion: string;
  generatedAt: string;
  description: string;
  intents: PilotIntent[];
}

export interface ScoredCandidate {
  document: SearchDocument;
  score: number;
  rank: number;
  mode: "keyword" | "semantic" | "hybrid";
}

export interface GroupedResult {
  groupId: string;
  bestScore: number;
  primaryDocument: SearchDocument;
  members: SearchDocument[];
  isRelevant: boolean;
}

export interface QueryEvaluationReport {
  queryId: string;
  intentId: string;
  category: "supported" | "unrelated" | "unsupported_condition";
  split: "dev" | "reserved";
  lang: LanguageTag;
  queryText: string;
  latencyMs: {
    keyword: number;
    semantic: number;
    hybrid: number; // Measures full end-to-end hybrid path
  };
  top3Results: {
    keyword: GroupedResult[];
    semantic: GroupedResult[];
    hybrid: GroupedResult[];
  };
  metrics: {
    keyword: { firstUsefulRank: number | null; precisionAt3: number };
    semantic: { firstUsefulRank: number | null; precisionAt3: number };
    hybrid: { firstUsefulRank: number | null; precisionAt3: number };
  };
  unrelatedSuppressed: boolean;
  notes: string[];
}

export interface PilotEvaluationSummary {
  evaluationMode: "mock_fixture" | "production_semantic" | "lexical_only";
  semanticStatus: "evaluated" | "unavailable";
  totalQueries: number;
  devQueries: number;
  reservedQueries: number;
  byCategory: {
    supported: {
      count: number;
      mrr: { keyword: number; semantic: number | null; hybrid: number };
      avgP3: { keyword: number; semantic: number | null; hybrid: number };
    };
    unrelated: {
      count: number;
      suppressionRate: { keyword: number; semantic: number | null; hybrid: number };
    };
    unsupported_condition: {
      count: number;
      inspectableGapPreserved: number;
    };
  };
  byLanguage: Record<LanguageTag, { count: number; avgHybridP3: number }>;
  policy: SemanticRetrievalPolicy;
}

/**
 * Normalizes query string for lexical matching: trims, collapses whitespace, Latin lowercases.
 */
export function normalizeQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .split(/[\s,.;:!?()[\]{}"'\\/]+/)
    .filter((t) => t.length > 0);
}

/**
 * Computes lexical keyword score for a search document.
 */
export function computeKeywordScore(
  tokens: string[],
  doc: SearchDocument,
  weights = FROZEN_SEMANTIC_POLICY.lexicalWeights
): number {
  if (tokens.length === 0) return 0;

  const titleLower = (doc.title || "").toLowerCase();
  const bodyLower = (doc.body || "").toLowerCase();
  const authorLower = String(doc.metadata?.author || "").toLowerCase();

  let titleMatches = 0;
  let bodyMatches = 0;

  for (const token of tokens) {
    if (titleLower.includes(token)) titleMatches++;
    if (bodyLower.includes(token) || authorLower.includes(token)) bodyMatches++;
  }

  const rawScore = titleMatches * weights.title + bodyMatches * weights.body;
  return rawScore / tokens.length;
}

/**
 * Groups scored candidates by exact groupId, retaining best score and all member evidence.
 */
export function groupCandidates(
  candidates: { document: SearchDocument; score: number }[],
  expectedRelevantIds: string[]
): GroupedResult[] {
  const groups = new Map<string, { bestScore: number; primary: SearchDocument; members: SearchDocument[] }>();

  for (const cand of candidates) {
    const gid = cand.document.groupId || cand.document.typedId;
    const existing = groups.get(gid);
    if (!existing) {
      groups.set(gid, {
        bestScore: cand.score,
        primary: cand.document,
        members: [cand.document]
      });
    } else {
      existing.members.push(cand.document);
      if (cand.score > existing.bestScore) {
        existing.bestScore = cand.score;
        existing.primary = cand.document;
      }
    }
  }

  const sortedGroups = Array.from(groups.entries())
    .map(([groupId, data]) => {
      const isRelevant = data.members.some(
        (m) =>
          expectedRelevantIds.includes(m.typedId) ||
          (m.url && expectedRelevantIds.some((id) => m.url?.includes(id)))
      );
      return {
        groupId,
        bestScore: data.bestScore,
        primaryDocument: data.primary,
        members: data.members,
        isRelevant
      };
    })
    .sort((a, b) => b.bestScore - a.bestScore);

  return sortedGroups;
}

/**
 * Core Evaluation Engine running the 20-query pilot against an indexed corpus and vectors.
 */
export class RetrievalEvaluator {
  private documents: SearchDocument[];
  private vectorMap: Map<number, Float32Array>;
  private policy: SemanticRetrievalPolicy;
  private evaluationMode: "mock_fixture" | "production_semantic" | "lexical_only";

  constructor(
    documents: SearchDocument[],
    vectorMap: Map<number, Float32Array> = new Map(),
    policy: SemanticRetrievalPolicy = FROZEN_SEMANTIC_POLICY,
    evaluationMode: "mock_fixture" | "production_semantic" | "lexical_only" = "mock_fixture"
  ) {
    this.documents = documents;
    this.vectorMap = vectorMap;
    this.policy = policy;
    this.evaluationMode = evaluationMode;
  }

  /**
   * Evaluates a single pilot query across Keyword, Semantic, and Hybrid retrieval.
   * Full hybrid path latency is measured from start of query execution to grouped results.
   */
  evaluateQuery(
    query: PilotQuery,
    intent: PilotIntent,
    queryVector?: Float32Array
  ): QueryEvaluationReport {
    const startFullHybrid = performance.now();

    // 1. Keyword Retrieval
    const startKw = performance.now();
    const tokens = normalizeQueryTokens(query.queryText);
    const kwCandidates: { document: SearchDocument; score: number }[] = [];
    for (const doc of this.documents) {
      const score = computeKeywordScore(tokens, doc, this.policy.lexicalWeights);
      if (score > 0) {
        kwCandidates.push({ document: doc, score });
      }
    }
    kwCandidates.sort((a, b) => b.score - a.score);
    const endKw = performance.now();
    const kwLatency = Number((endKw - startKw).toFixed(2));

    // 2. Semantic Retrieval
    const startSem = performance.now();
    const semCandidates: { document: SearchDocument; score: number }[] = [];
    const hasVectors = queryVector && this.vectorMap.size > 0;

    if (hasVectors) {
      for (const doc of this.documents) {
        if (doc.vectorRow !== null && doc.vectorRow !== undefined) {
          const docVec = this.vectorMap.get(doc.vectorRow);
          if (docVec) {
            const sim = cosineSimilarity(queryVector, docVec);
            if (sim >= this.policy.semanticCutoffThreshold) {
              semCandidates.push({ document: doc, score: sim });
            }
          }
        }
      }
      semCandidates.sort((a, b) => b.score - a.score);
    }
    const endSem = performance.now();
    const semLatency = Number((endSem - startSem).toFixed(2));

    // 3. Hybrid Retrieval: Reciprocal Rank Fusion (RRF)
    const rrfScores = new Map<string, { doc: SearchDocument; rrf: number }>();
    const k = this.policy.rrfConstantK;

    kwCandidates.slice(0, this.policy.limits.candidatesPerBranch).forEach((cand, idx) => {
      const rank = idx + 1;
      const tid = cand.document.typedId;
      const curr = rrfScores.get(tid) || { doc: cand.document, rrf: 0 };
      curr.rrf += 1 / (k + rank);
      rrfScores.set(tid, curr);
    });

    semCandidates.slice(0, this.policy.limits.candidatesPerBranch).forEach((cand, idx) => {
      const rank = idx + 1;
      const tid = cand.document.typedId;
      const curr = rrfScores.get(tid) || { doc: cand.document, rrf: 0 };
      curr.rrf += 1 / (k + rank);
      rrfScores.set(tid, curr);
    });

    const hybCandidates = Array.from(rrfScores.values())
      .map((item) => ({ document: item.doc, score: item.rrf }))
      .sort((a, b) => b.score - a.score);

    // Group candidates across full retrieval depth
    const allKwGroups = groupCandidates(kwCandidates, query.expectedRelevantIds);
    const allSemGroups = groupCandidates(semCandidates, query.expectedRelevantIds);
    const allHybGroups = groupCandidates(hybCandidates, query.expectedRelevantIds);

    const endFullHybrid = performance.now();
    const fullHybridLatency = Number((endFullHybrid - startFullHybrid).toFixed(2));

    // Calculate metrics across full depth for MRR, and top 3 for Precision@3
    const calcMetrics = (allGroups: GroupedResult[], available: boolean = true) => {
      if (!available) {
        return { firstUsefulRank: null, precisionAt3: 0 };
      }
      let firstRank: number | null = null;
      for (let i = 0; i < allGroups.length; i++) {
        if (allGroups[i].isRelevant) {
          firstRank = i + 1;
          break;
        }
      }
      const top3 = allGroups.slice(0, 3);
      const relevantInTop3 = top3.filter((g) => g.isRelevant).length;
      const precisionAt3 = top3.length > 0 ? relevantInTop3 / 3 : 0;
      return { firstUsefulRank: firstRank, precisionAt3 };
    };

    const isUnrelated = intent.category === "unrelated";
    const unrelatedSuppressed = isUnrelated
      ? (!hasVectors ? allKwGroups.length === 0 : allHybGroups.length === 0)
      : false;

    const notes: string[] = [];
    if (!hasVectors) {
      notes.push("Semantic vectors unavailable; evaluated lexical branch only");
    }
    if (isUnrelated && unrelatedSuppressed) {
      notes.push("Cleanly suppressed below cutoff without false match claim");
    }

    // Top 3 groups for display
    const kwGroups = allKwGroups.slice(0, 3);
    const semGroups = allSemGroups.slice(0, 3);
    const hybGroups = allHybGroups.slice(0, 3);

    return {
      queryId: query.queryId,
      intentId: intent.intentId,
      category: intent.category,
      split: intent.split,
      lang: query.lang,
      queryText: query.queryText,
      latencyMs: {
        keyword: kwLatency,
        semantic: semLatency,
        hybrid: fullHybridLatency
      },
      top3Results: {
        keyword: kwGroups,
        semantic: semGroups,
        hybrid: hybGroups
      },
      metrics: {
        keyword: calcMetrics(allKwGroups, true),
        semantic: calcMetrics(allSemGroups, hasVectors),
        hybrid: calcMetrics(allHybGroups, true)
      },
      unrelatedSuppressed,
      notes
    };
  }

  /**
   * Evaluates all queries in the pilot dataset and computes aggregated metrics.
   */
  evaluatePilot(
    dataset: PilotDataset,
    queryVectorMap?: Map<string, Float32Array>,
    filterSplit?: "dev" | "reserved"
  ): {
    reports: QueryEvaluationReport[];
    summary: PilotEvaluationSummary;
  } {
    const reports: QueryEvaluationReport[] = [];
    const hasVectors = this.vectorMap.size > 0 && queryVectorMap && queryVectorMap.size > 0;

    const intentsToRun = dataset.intents.filter(
      (intent) => !filterSplit || intent.split === filterSplit
    );

    for (const intent of intentsToRun) {
      for (const query of intent.queries) {
        const queryVec = queryVectorMap?.get(query.queryId);
        const report = this.evaluateQuery(query, intent, queryVec);
        reports.push(report);
      }
    }

    let devCount = 0;
    let resCount = 0;

    const supportedReports = reports.filter((r) => r.category === "supported");
    const unrelatedReports = reports.filter((r) => r.category === "unrelated");
    const partialReports = reports.filter((r) => r.category === "unsupported_condition");

    for (const r of reports) {
      if (r.split === "dev") devCount++;
      if (r.split === "reserved") resCount++;
    }

    // Inspectable gap preservation verification:
    let inspectableGapPreserved = 0;
    for (const r of partialReports) {
      const hyb = r.top3Results.hybrid;
      if (hyb.length === 0) {
        // Zero-result regression case: cleanly rejected, preserving gap
        inspectableGapPreserved++;
        r.notes.push("Condition gap preserved via complete rejection (0 false claims)");
      } else {
        // Check if returned primary documents have inspectable evidence text
        const allHaveEvidence = hyb.every((g) => {
          const doc = g.primaryDocument;
          return (
            Array.isArray(doc.evidence) &&
            doc.evidence.length > 0 &&
            doc.evidence.some((e) => e.originalText && e.originalText.length > 0)
          );
        });
        if (allHaveEvidence) {
          inspectableGapPreserved++;
          r.notes.push(
            "Partial match preserved: original evidence text reveals condition gap for user inspection"
          );
        } else {
          r.notes.push("Evidence gap violation: candidate lacks verifiable source evidence");
        }
      }
    }

    // MRR calculation over full retrieval depth
    const calcMRR = (mode: "keyword" | "semantic" | "hybrid") => {
      if (mode === "semantic" && !hasVectors) return null;
      if (supportedReports.length === 0) return 0;
      let rrSum = 0;
      for (const r of supportedReports) {
        const rank = r.metrics[mode].firstUsefulRank;
        if (rank !== null) rrSum += 1.0 / rank;
      }
      return Number((rrSum / supportedReports.length).toFixed(3));
    };

    const calcAvgP3 = (mode: "keyword" | "semantic" | "hybrid") => {
      if (mode === "semantic" && !hasVectors) return null;
      if (supportedReports.length === 0) return 0;
      const sum = supportedReports.reduce((acc, r) => acc + r.metrics[mode].precisionAt3, 0);
      return Number((sum / supportedReports.length).toFixed(3));
    };

    const calcSuppression = (mode: "keyword" | "semantic" | "hybrid") => {
      if (mode === "semantic" && !hasVectors) return null;
      if (unrelatedReports.length === 0) return 1.0;
      const suppressed = unrelatedReports.filter((r) => r.top3Results[mode].length === 0).length;
      return Number((suppressed / unrelatedReports.length).toFixed(3));
    };

    const byLang: Record<LanguageTag, { count: number; avgHybridP3: number }> = {
      th: { count: 0, avgHybridP3: 0 },
      en: { count: 0, avgHybridP3: 0 },
      mixed: { count: 0, avgHybridP3: 0 },
      unknown: { count: 0, avgHybridP3: 0 }
    };

    for (const r of reports) {
      byLang[r.lang].count++;
      byLang[r.lang].avgHybridP3 += r.metrics.hybrid.precisionAt3;
    }
    for (const lang of Object.keys(byLang) as LanguageTag[]) {
      if (byLang[lang].count > 0) {
        byLang[lang].avgHybridP3 = Number(
          (byLang[lang].avgHybridP3 / byLang[lang].count).toFixed(3)
        );
      }
    }

    const summary: PilotEvaluationSummary = {
      evaluationMode: this.evaluationMode,
      semanticStatus: hasVectors ? "evaluated" : "unavailable",
      totalQueries: reports.length,
      devQueries: devCount,
      reservedQueries: resCount,
      byCategory: {
        supported: {
          count: supportedReports.length,
          mrr: {
            keyword: calcMRR("keyword") as number,
            semantic: calcMRR("semantic"),
            hybrid: calcMRR("hybrid") as number
          },
          avgP3: {
            keyword: calcAvgP3("keyword") as number,
            semantic: calcAvgP3("semantic"),
            hybrid: calcAvgP3("hybrid") as number
          }
        },
        unrelated: {
          count: unrelatedReports.length,
          suppressionRate: {
            keyword: calcSuppression("keyword") as number,
            semantic: calcSuppression("semantic"),
            hybrid: calcSuppression("hybrid") as number
          }
        },
        unsupported_condition: {
          count: partialReports.length,
          inspectableGapPreserved
        }
      },
      byLanguage: byLang,
      policy: this.policy
    };

    return { reports, summary };
  }
}
