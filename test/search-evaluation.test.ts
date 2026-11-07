import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeQueryTokens,
  computeKeywordScore,
  groupCandidates,
  RetrievalEvaluator,
  type PilotDataset
} from "../lib/search/evaluation";
import {
  FROZEN_SEMANTIC_POLICY,
  isProfileCompatibleWithPolicy
} from "../lib/search/semantic-policy";
import {
  DEFAULT_MODEL_PROFILE
} from "../lib/search/vector-types";
import {
  l2Normalize,
  cosineSimilarity
} from "../lib/search/vector-io";
import type { SearchDocument } from "../lib/search/types";

function createDummyDoc(id: string, title: string, body: string, groupId?: string): SearchDocument {
  return {
    typedId: `doc:${id}`,
    kind: "source",
    title,
    body,
    retrievalText: `${title} ${body}`,
    url: `https://example.com/${id}`,
    groupId: groupId || `https://example.com/${id}`,
    origin: "web",
    language: "en",
    isTitleOnly: false,
    isPartial: false,
    parentTypedId: null,
    contentHash: `hash-${id}`,
    dependencyHash: `dep-${id}`,
    vectorRow: null,
    evidence: [],
    metadata: {}
  };
}

test("F8 Pilot Dataset: satisfies 20-query structure, intent balance, and dev/reserved split", () => {
  const pilotPath = resolve(process.cwd(), "data", "search", "pilot-queries.json");
  assert.ok(existsSync(pilotPath), "pilot-queries.json must exist in data/search/");

  const pilot: PilotDataset = JSON.parse(readFileSync(pilotPath, "utf8"));
  assert.equal(pilot.intents.length, 10, "Pilot must have exactly 10 independent intents");

  // Check intent distribution: 6 supported, 2 unrelated, 2 unsupported/negation
  const supported = pilot.intents.filter((i) => i.category === "supported");
  const unrelated = pilot.intents.filter((i) => i.category === "unrelated");
  const unsupported = pilot.intents.filter((i) => i.category === "unsupported_condition");

  assert.equal(supported.length, 6, "Must have exactly 6 supported intents");
  assert.equal(unrelated.length, 2, "Must have exactly 2 unrelated intents");
  assert.equal(unsupported.length, 2, "Must have exactly 2 unsupported_condition intents");

  // Check split: Dev (4 supported, 1 unrelated, 1 unsupported = 6 intents = 12 queries)
  // Reserved (2 supported, 1 unrelated, 1 unsupported = 4 intents = 8 queries)
  const devIntents = pilot.intents.filter((i) => i.split === "dev");
  const resIntents = pilot.intents.filter((i) => i.split === "reserved");

  assert.equal(devIntents.length, 6, "Must have 6 development intents");
  assert.equal(resIntents.length, 4, "Must have 4 reserved intents");

  let totalQueries = 0;
  let devQueries = 0;
  let resQueries = 0;

  for (const intent of pilot.intents) {
    assert.equal(intent.queries.length, 2, `Intent ${intent.intentId} must have paired TH/EN queries`);
    const thQuery = intent.queries.find((q) => q.lang === "th");
    const enQuery = intent.queries.find((q) => q.lang === "en");
    assert.ok(thQuery, `Intent ${intent.intentId} must have Thai query`);
    assert.ok(enQuery, `Intent ${intent.intentId} must have English query`);

    totalQueries += intent.queries.length;
    if (intent.split === "dev") devQueries += intent.queries.length;
    if (intent.split === "reserved") resQueries += intent.queries.length;
  }

  assert.equal(totalQueries, 20, "Total queries must be exactly 20");
  assert.equal(devQueries, 12, "Development queries must be exactly 12");
  assert.equal(resQueries, 8, "Reserved queries must be exactly 8");
});

test("F8 Lexical Scoring: applies title weight 4 and body weight 1 correctly", () => {
  const docTitleMatch = createDummyDoc("1", "Dinsaw healthcare robot in Thailand", "General text without term");
  const docBodyMatch = createDummyDoc("2", "General title", "Features Dinsaw healthcare robot in Thailand");

  const tokens = ["dinsaw", "healthcare"];

  const scoreTitle = computeKeywordScore(tokens, docTitleMatch, { title: 4.0, body: 1.0 });
  const scoreBody = computeKeywordScore(tokens, docBodyMatch, { title: 4.0, body: 1.0 });

  assert.ok(scoreTitle > scoreBody, "Title matches must score higher than body-only matches");
  assert.equal(scoreTitle, 4.0); // 2 title matches * 4.0 / 2 tokens = 4.0
  assert.equal(scoreBody, 1.0);  // 2 body matches * 1.0 / 2 tokens = 1.0
});

test("F8 Candidate Grouping: merges duplicate group members while preserving best score", () => {
  const docA1 = createDummyDoc("a1", "Dinsaw Mini Announcement", "News excerpt", "group-dinsaw");
  const docA2 = createDummyDoc("a2", "Dinsaw Mini Review", "Hospital deployment", "group-dinsaw");
  const docB = createDummyDoc("b", "Robo-Buddy", "Coding companion", "group-robobuddy");

  const candidates = [
    { document: docA1, score: 0.8 },
    { document: docA2, score: 0.95 }, // higher score in group-dinsaw
    { document: docB, score: 0.7 }
  ];

  const grouped = groupCandidates(candidates, ["doc:a1"]);
  assert.equal(grouped.length, 2, "Should group 3 candidates into 2 distinct groups");

  const dinsawGroup = grouped.find((g) => g.groupId === "group-dinsaw");
  assert.ok(dinsawGroup);
  assert.equal(dinsawGroup?.bestScore, 0.95);
  assert.equal(dinsawGroup?.members.length, 2);
  assert.equal(dinsawGroup?.isRelevant, true);
});

test("F8 Frozen Semantic Policy: validates profile compatibility and cutoff threshold", () => {
  assert.equal(FROZEN_SEMANTIC_POLICY.isFrozen, true);
  assert.equal(FROZEN_SEMANTIC_POLICY.semanticCutoffThreshold, 0.62);
  assert.equal(FROZEN_SEMANTIC_POLICY.rrfConstantK, 60);

  // Compatible profile
  const isCompat = isProfileCompatibleWithPolicy(DEFAULT_MODEL_PROFILE, FROZEN_SEMANTIC_POLICY);
  assert.equal(isCompat, true);

  // Incompatible profile (dimension mismatch or profileHash mismatch)
  const badProfile = { ...DEFAULT_MODEL_PROFILE, profileHash: "incompatible-v2" };
  assert.equal(isProfileCompatibleWithPolicy(badProfile, FROZEN_SEMANTIC_POLICY), false);
  assert.equal(isProfileCompatibleWithPolicy(null, FROZEN_SEMANTIC_POLICY), false);
});

test("F8 Evaluator: evaluates single query and suppresses unrelated requests below cutoff", () => {
  const doc1 = createDummyDoc("1", "Dinsaw elderly care robot", "Hospital assistant in Thailand");
  doc1.vectorRow = 0;

  const dim = 4;
  const docVec = l2Normalize(new Float32Array([1.0, 0.0, 0.0, 0.0]));
  const vectorMap = new Map<number, Float32Array>([[0, docVec]]);

  const evaluator = new RetrievalEvaluator([doc1], vectorMap, FROZEN_SEMANTIC_POLICY);

  // 1. Supported query with matching vector
  const querySupported = {
    queryId: "test-01",
    lang: "en" as const,
    queryText: "Dinsaw elderly care robot",
    targetKeywords: ["dinsaw", "elderly"],
    expectedRelevantIds: ["doc:1"]
  };
  const intentSupported = {
    intentId: "test-intent",
    category: "supported" as const,
    split: "dev" as const,
    description: "test",
    queries: [querySupported]
  };

  const matchingQueryVec = l2Normalize(new Float32Array([0.9, 0.1, 0.0, 0.0])); // cosine sim > 0.62
  const reportSupported = evaluator.evaluateQuery(querySupported, intentSupported, matchingQueryVec);
  assert.equal(reportSupported.metrics.keyword.firstUsefulRank, 1);
  assert.equal(reportSupported.metrics.semantic.firstUsefulRank, 1);
  assert.equal(reportSupported.metrics.hybrid.firstUsefulRank, 1);

  // 2. Unrelated query with orthogonal vector (sim ~ 0.0 < 0.62)
  const queryUnrelated = {
    queryId: "test-unrelated",
    lang: "en" as const,
    queryText: "quantum cryptography key exchange",
    targetKeywords: ["quantum", "cryptography"],
    expectedRelevantIds: []
  };
  const intentUnrelated = {
    intentId: "test-unrelated-intent",
    category: "unrelated" as const,
    split: "dev" as const,
    description: "test",
    queries: [queryUnrelated]
  };

  const orthogonalQueryVec = l2Normalize(new Float32Array([0.0, 1.0, 0.0, 0.0])); // orthogonal to docVec
  const reportUnrelated = evaluator.evaluateQuery(queryUnrelated, intentUnrelated, orthogonalQueryVec);

  assert.equal(reportUnrelated.top3Results.semantic.length, 0, "Semantic results must be empty below cutoff");
  assert.equal(reportUnrelated.unrelatedSuppressed, true, "Unrelated query must be suppressed");
});
