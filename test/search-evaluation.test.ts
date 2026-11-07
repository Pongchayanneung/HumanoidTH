import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeQueryTokens,
  computeKeywordScore,
  groupCandidates,
  RetrievalEvaluator,
  resolveEvaluationMode,
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
import { createSearchPost } from "../lib/search/api";

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
    evidence: [
      {
        fieldName: "body",
        originalText: body,
        label: "Evidence text",
        coverage: "full",
        startOffset: 0,
        endOffset: body.length
      }
    ],
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
  assert.equal(
    FROZEN_SEMANTIC_POLICY.calibrationStatus,
    "provisional_uncalibrated",
    "0.62 has no measured support and must stay labelled provisional"
  );

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
  assert.ok(reportSupported.latencyMs.hybrid >= 0);

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

test("F8 MRR Evaluation Depth: first useful rank 4 gives exact rank and MRR of 0.25", () => {
  // Query tokens: robot, delta, target. Scores (title weight 4, body weight 1, divided by 3):
  //   doc1 title 3 + body 3 = 15/3 = 5.0
  //   doc2 title 3          = 12/3 = 4.0
  //   doc3 title 2          =  8/3 = 2.667
  //   doc4 body 3 only      =  3/3 = 1.0   (the only relevant doc, must rank 4th)
  //   doc5 body 1           =  1/3 = 0.333
  const docs = [
    createDummyDoc("1", "robot delta target one", "robot delta target"),
    createDummyDoc("2", "robot delta target two", "unrelated words"),
    createDummyDoc("3", "robot delta three", "unrelated words"),
    createDummyDoc("4", "general heading", "robot delta target"),
    createDummyDoc("5", "general heading five", "robot only")
  ];

  const evaluator = new RetrievalEvaluator(docs, new Map(), FROZEN_SEMANTIC_POLICY, "lexical_only");

  const query = {
    queryId: "depth-test-01",
    lang: "en" as const,
    queryText: "robot delta target",
    targetKeywords: ["robot", "delta", "target"],
    expectedRelevantIds: ["doc:4"]
  };
  const intent = {
    intentId: "depth-test",
    category: "supported" as const,
    split: "dev" as const,
    description: "depth test",
    queries: [query]
  };

  const report = evaluator.evaluateQuery(query, intent);
  assert.equal(report.metrics.keyword.firstUsefulRank, 4);
  assert.equal(report.metrics.keyword.precisionAt3, 0, "relevant doc is outside the top 3");

  const dataset: PilotDataset = {
    pilotVersion: "1.0",
    generatedAt: "2026-11-07T00:00:00.000Z",
    description: "test",
    intents: [intent]
  };
  const { summary } = evaluator.evaluatePilot(dataset);
  assert.equal(summary.byCategory.supported.mrr.keyword, 0.25);
  assert.equal(summary.byCategory.supported.avgP3.keyword, 0);
});

test("F8 Inspectable Evidence Gap: verifies evidence presence and zero-result preservation", () => {
  const docWithEvidence = createDummyDoc("1", "Humanoid Robot", "Standard robot description");
  const docWithoutEvidence: SearchDocument = {
    ...createDummyDoc("2", "Camera-less robot", "Claim with no evidence"),
    evidence: []
  };

  const evaluator = new RetrievalEvaluator([docWithEvidence], new Map(), FROZEN_SEMANTIC_POLICY);

  const dataset: PilotDataset = {
    pilotVersion: "1.0",
    generatedAt: "2026-11-07T00:00:00.000Z",
    description: "test",
    intents: [
      {
        intentId: "unsupported-test",
        category: "unsupported_condition",
        split: "dev",
        description: "Unsupported test",
        queries: [
          {
            queryId: "unsup-01",
            lang: "en",
            queryText: "humanoid robot without cameras",
            targetKeywords: ["humanoid", "robot", "cameras"],
            expectedRelevantIds: []
          }
        ]
      }
    ]
  };

  const evalResult = evaluator.evaluatePilot(dataset);
  assert.equal(evalResult.summary.byCategory.unsupported_condition.count, 1);
  const gap = evalResult.summary.byCategory.unsupported_condition;
  assert.equal(gap.zeroResult, 0);
  assert.equal(gap.returnedWithExcerpt, 1, "returned result has a non-empty excerpt");
  assert.equal(gap.returnedWithoutExcerpt, 0);
  assert.equal(gap.excerptContentAssessed, false, "excerpt content is never assessed");

  // Zero-result and missing-excerpt cases are counted separately, never as 'preserved'.
  const noMatchEvaluator = new RetrievalEvaluator([docWithEvidence], new Map(), FROZEN_SEMANTIC_POLICY);
  const noMatch = noMatchEvaluator.evaluatePilot({
    ...dataset,
    intents: [{ ...dataset.intents[0], queries: [{ ...dataset.intents[0].queries[0], queryText: "zzzz qqqq" }] }]
  });
  assert.equal(noMatch.summary.byCategory.unsupported_condition.zeroResult, 1);
  assert.equal(noMatch.summary.byCategory.unsupported_condition.returnedWithExcerpt, 0);

  const noExcerptEvaluator = new RetrievalEvaluator([docWithoutEvidence], new Map(), FROZEN_SEMANTIC_POLICY);
  const noExcerpt = noExcerptEvaluator.evaluatePilot({
    ...dataset,
    intents: [{ ...dataset.intents[0], queries: [{ ...dataset.intents[0].queries[0], queryText: "camera-less robot" }] }]
  });
  assert.equal(noExcerpt.summary.byCategory.unsupported_condition.returnedWithoutExcerpt, 1);
});

test("F8 Evaluation mode: never claims production_semantic without a real provider and real vectors", () => {
  const base = {
    mockFixtureRequested: false,
    realQueryProviderConfigured: false,
    onDiskVectorProvider: null,
    onDiskProfileCompatible: false
  } as const;
  assert.equal(resolveEvaluationMode(base), "lexical_only", "nothing configured");
  assert.equal(resolveEvaluationMode({ ...base, mockFixtureRequested: true }), "mock_fixture");
  assert.equal(resolveEvaluationMode({ ...base, onDiskVectorProvider: "mock" }), "mock_fixture");
  // Real on-disk vectors but no real query provider: queries cannot be embedded honestly.
  assert.equal(
    resolveEvaluationMode({ ...base, onDiskVectorProvider: "tei", onDiskProfileCompatible: true }),
    "lexical_only"
  );
  // Real provider but no real document vectors: still not production.
  assert.equal(resolveEvaluationMode({ ...base, realQueryProviderConfigured: true }), "lexical_only");
  // Real vectors for a different profile than the policy: not production.
  assert.equal(
    resolveEvaluationMode({ ...base, realQueryProviderConfigured: true, onDiskVectorProvider: "tei" }),
    "lexical_only"
  );
  assert.equal(
    resolveEvaluationMode({
      mockFixtureRequested: false,
      realQueryProviderConfigured: true,
      onDiskVectorProvider: "tei",
      onDiskProfileCompatible: true
    }),
    "production_semantic"
  );
});

test("F8 Semantic status: mock vectors report 'mock' and n/a semantic metrics, lexical_only reports 'unavailable'", () => {
  const doc = createDummyDoc("1", "Dinsaw robot", "Hospital assistant");
  doc.vectorRow = 0;
  const vectorMap = new Map<number, Float32Array>([[0, l2Normalize(new Float32Array([1, 0, 0, 0]))]]);
  const query = {
    queryId: "q1",
    lang: "en" as const,
    queryText: "quantum cryptography",
    targetKeywords: [],
    expectedRelevantIds: []
  };
  const dataset: PilotDataset = {
    pilotVersion: "1.0",
    generatedAt: "2026-11-07T00:00:00.000Z",
    description: "test",
    intents: [
      { intentId: "u", category: "unrelated", split: "dev", description: "u", queries: [query] },
      { intentId: "s", category: "supported", split: "dev", description: "s", queries: [{ ...query, queryId: "q2", expectedRelevantIds: ["doc:1"] }] }
    ]
  };
  const qv = new Map<string, Float32Array>([
    ["q1", l2Normalize(new Float32Array([0, 1, 0, 0]))],
    ["q2", l2Normalize(new Float32Array([0, 1, 0, 0]))]
  ]);

  const mock = new RetrievalEvaluator([doc], vectorMap, FROZEN_SEMANTIC_POLICY, "mock_fixture").evaluatePilot(dataset, qv);
  assert.equal(mock.summary.semanticStatus, "mock");
  assert.equal(mock.summary.byCategory.supported.mrr.semantic, null);
  assert.equal(mock.summary.byCategory.unrelated.suppressionRate.semantic, null);
  assert.ok(mock.summary.caveats.some((c) => c.includes("No real embedding model was evaluated")));

  const lex = new RetrievalEvaluator([doc], vectorMap, FROZEN_SEMANTIC_POLICY, "lexical_only").evaluatePilot(dataset, qv);
  assert.equal(lex.summary.semanticStatus, "unavailable");
  assert.equal(lex.summary.byCategory.supported.mrr.semantic, null);

  const real = new RetrievalEvaluator([doc], vectorMap, FROZEN_SEMANTIC_POLICY, "production_semantic").evaluatePilot(dataset, qv);
  assert.equal(real.summary.semanticStatus, "evaluated");
  assert.equal(real.summary.byCategory.unrelated.suppressionRate.semantic, 1);
});

test("F8 Latency: summary reports mean offline retrieval timing without embedding", () => {
  const doc = createDummyDoc("1", "Dinsaw robot", "Hospital assistant");
  const query = { queryId: "q1", lang: "en" as const, queryText: "dinsaw", targetKeywords: [], expectedRelevantIds: ["doc:1"] };
  const dataset: PilotDataset = {
    pilotVersion: "1.0",
    generatedAt: "2026-11-07T00:00:00.000Z",
    description: "test",
    intents: [{ intentId: "s", category: "supported", split: "dev", description: "s", queries: [query] }]
  };
  const { summary, reports } = new RetrievalEvaluator([doc], new Map(), FROZEN_SEMANTIC_POLICY, "lexical_only").evaluatePilot(dataset);
  assert.equal(summary.meanLatencyMs.hybrid, reports[0].latencyMs.hybrid);
  assert.ok(summary.caveats.some((c) => c.includes("embedding time is excluded")));
});


test("F8 evaluation uses serving lexical eligibility and group-first capped ordering", async () => {
  const unrelated = createDummyDoc("unrelated", "the", "nothing useful");
  const query = { queryId: "parity", lang: "en" as const, queryText: "the robot", targetKeywords: [], expectedRelevantIds: [] };
  const intent = { intentId: "parity", category: "supported" as const, split: "dev" as const, description: "", queries: [query] };
  const policy = { ...FROZEN_SEMANTIC_POLICY, limits: { ...FROZEN_SEMANTIC_POLICY.limits, candidatesPerBranch: 2 } };
  const docs = [unrelated, createDummyDoc("a", "robot", ""), createDummyDoc("a2", "robot copy", ""), createDummyDoc("b", "robot b", ""), createDummyDoc("c", "robot c", "")];
  docs[2].url = docs[1].url;
  docs[2].groupId = docs[1].groupId;
  const report = new RetrievalEvaluator(docs, new Map(), policy, "lexical_only").evaluateQuery(query, intent);
  const post = createSearchPost(async () => ({ documents: docs, release: { id: "x", generatedAt: "now" }, coverage: { indexed: 0, eligible: docs.length } }), { policy });
  const response = await post(new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: query.queryText }) }));
  const result = await response.json();
  assert.deepEqual(report.top3Results.hybrid.map((group) => group.groupId), result.groups.map((group: { groupKey: string }) => group.groupKey));
  assert.deepEqual(report.top3Results.hybrid.map((group) => group.primaryDocument.typedId), ["doc:a", "doc:b"]);
  assert.equal(normalizeQueryTokens(query.queryText).includes("the"), false);
  assert.equal(computeKeywordScore(normalizeQueryTokens(query.queryText), unrelated), 0);
});
