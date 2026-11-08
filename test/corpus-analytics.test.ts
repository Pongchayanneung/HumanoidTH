process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatTimeBucketKey,
  parseIngestionDateSemantics,
  parseRobotDateSemantics,
  parseSourceDateSemantics
} from "../lib/analytics/date-semantics";
import {
  buildAnalyticsEvents,
  buildCorpusAggregateSummary,
  loadWholeCorpusAnalytics,
  DEFAULT_ANALYTICS_SAMPLE_LIMIT
} from "../lib/analytics/corpus-analytics";
import type { CorpusAnalyticsEvent } from "../lib/analytics/types";
import {
  publicSourceRecordWhere,
  publicRobotWhere,
  publicContributionWhere,
  publicPerspectiveWhere,
  isFreshPerspectiveAnnotation,
  isEligiblePublicRobot,
  isEligiblePublicContribution
} from "../lib/public-projection";
import { prisma } from "../lib/prisma";

test("Date Semantics: preserves nulls and never substitutes createdAt as publication date", () => {
  const missingPub = parseSourceDateSemantics(null, "2026-11-07T10:00:00.000Z");
  assert.equal(missingPub.dateKind, "missing");
  assert.equal(missingPub.datePrecision, "missing");
  assert.equal(missingPub.eventDate, null);
  assert.equal(missingPub.displayYear, null);
  assert.equal(missingPub.monthKey, null);
  assert.equal(missingPub.yearKey, null);
  assert.equal(missingPub.ingestionDate.toISOString(), "2026-11-07T10:00:00.000Z");

  const validPub = parseSourceDateSemantics("2023-05-18T00:00:00.000Z", "2026-11-07T10:00:00.000Z");
  assert.equal(validPub.dateKind, "publication");
  assert.equal(validPub.datePrecision, "exact_date");
  assert.equal(validPub.displayYear, 2023);
  assert.equal(validPub.monthKey, "2023-05");
  assert.equal(validPub.yearKey, "2023");
});

test("Date Semantics: distinguishes year-only citations from exact daily publications", () => {
  // OpenAlex citation known only by year (stored as YYYY-01-01 with openalexId)
  const yearOnly = parseSourceDateSemantics(
    "2021-01-01T00:00:00.000Z",
    "2026-11-07T10:00:00.000Z",
    { openalexId: "W123456", publicationDatePrecision: "year" }
  );
  assert.equal(yearOnly.datePrecision, "year_only");
  assert.equal(yearOnly.displayYear, 2021);
  assert.equal(yearOnly.monthKey, null); // Must be null to avoid fake January spike

  // Real publication on January 1st with explicit daily precision (without OpenAlex ID)
  const exactJanFirst = parseSourceDateSemantics(
    "2021-01-01T00:00:00.000Z",
    "2026-11-07T10:00:00.000Z",
    { publicationDatePrecision: "day" }
  );
  assert.equal(exactJanFirst.datePrecision, "exact_date");
  assert.equal(exactJanFirst.monthKey, "2021-01");

  // OpenAlex publication on January 1st with explicit daily precision (OpenAlex adapter output shape)
  // Must respect explicit day precision and NOT be overridden by the Jan 1 heuristic
  const exactJanFirstWithOpenAlex = parseSourceDateSemantics(
    "2021-01-01T00:00:00.000Z",
    "2026-11-07T10:00:00.000Z",
    { openalexId: "W987654", publicationDatePrecision: "day" }
  );
  assert.equal(exactJanFirstWithOpenAlex.datePrecision, "exact_date");
  assert.equal(exactJanFirstWithOpenAlex.monthKey, "2021-01");

  // Legacy OpenAlex citation on Jan 1 with NO explicit precision metadata: falls back to year_only
  const legacyJanFirst = parseSourceDateSemantics(
    "2021-01-01T00:00:00.000Z",
    "2026-11-07T10:00:00.000Z",
    { openalexId: "W111222" }
  );
  assert.equal(legacyJanFirst.datePrecision, "year_only");
  assert.equal(legacyJanFirst.monthKey, null);
});

test("Date Semantics: robot firstSeenYear is treated as observation time with year-only precision", () => {
  const robot = parseRobotDateSemantics(2019, "2026-11-07T10:00:00.000Z");
  assert.equal(robot.dateKind, "observation");
  assert.equal(robot.datePrecision, "year_only");
  assert.equal(robot.displayYear, 2019);
  assert.equal(robot.monthKey, null); // Must not produce "2019-01"
  assert.equal(robot.yearKey, "2019");

  const unobserved = parseRobotDateSemantics(null, "2026-11-07T10:00:00.000Z");
  assert.equal(unobserved.dateKind, "missing");
  assert.equal(unobserved.displayYear, null);
});

test("Audit D11 Fix: year-only dates do not produce artificial January spikes in monthly view", () => {
  const mockEvent: CorpusAnalyticsEvent = {
    scope: "robots",
    label: "Dinsaw Robot",
    confidence: 0.9,
    eventType: "robot",
    eventDate: "2020-01-01T00:00:00.000Z",
    ingestionDate: "2026-11-07T10:00:00.000Z",
    dateKind: "observation",
    datePrecision: "year_only",
    displayYear: 2020,
    monthKey: null,
    yearKey: "2020",
    sourceType: "unknown",
    relevanceStatus: "unknown",
    platform: "unknown",
    robotType: "social_robot",
    thailandStatus: "commercial",
    contributionType: "unknown",
    verificationStatus: "unknown",
    perspectiveTheme: "unknown",
    stance: "unknown",
    sentiment: "unknown",
    submissionType: "unknown",
    status: "unknown",
    visibility: "unknown",
    countryOfOrigin: "Thailand",
    ownerOrg: "unknown"
  };

  // When viewing monthly, year-only date returns "year_only", NOT "2020-01"
  const monthlyKey = formatTimeBucketKey(mockEvent, "month", "publication");
  assert.equal(monthlyKey, "year_only");

  // When viewing yearly, it groups under the actual year
  const yearlyKey = formatTimeBucketKey(mockEvent, "year", "publication");
  assert.equal(yearlyKey, "2020");
});

test("Audit D11 Fix: changing ingestion time does not shift publication timeline", () => {
  const eventV1: CorpusAnalyticsEvent = {
    scope: "sources",
    label: "Paper",
    confidence: 0.85,
    eventType: "source",
    eventDate: "2018-06-15T00:00:00.000Z",
    ingestionDate: "2024-01-10T00:00:00.000Z", // Earlier ingestion
    dateKind: "publication",
    datePrecision: "exact_date",
    displayYear: 2018,
    monthKey: "2018-06",
    yearKey: "2018",
    sourceType: "OPENALEX",
    relevanceStatus: "ACCEPTED",
    platform: "openalex",
    robotType: "unknown",
    thailandStatus: "unknown",
    contributionType: "unknown",
    verificationStatus: "unknown",
    perspectiveTheme: "unknown",
    stance: "unknown",
    sentiment: "unknown",
    submissionType: "unknown",
    status: "unknown",
    visibility: "unknown",
    countryOfOrigin: "unknown",
    ownerOrg: "unknown"
  };

  const eventV2: CorpusAnalyticsEvent = {
    ...eventV1,
    ingestionDate: "2026-11-07T12:00:00.000Z" // Re-ingested in 2026
  };

  // Under publication dimension, both point to 2018-06 regardless of ingestion date
  assert.equal(formatTimeBucketKey(eventV1, "month", "publication"), "2018-06");
  assert.equal(formatTimeBucketKey(eventV2, "month", "publication"), "2018-06");

  // Under ingestion dimension, system time is accurately reflected
  assert.equal(formatTimeBucketKey(eventV1, "month", "ingestion"), "2024-01");
  assert.equal(formatTimeBucketKey(eventV2, "month", "ingestion"), "2026-11");
});

test("Corpus Aggregation: summary helper reconciles whole-corpus counts and sample truncation with >5,000 values", () => {
  // Simulating an isolated fixture with 6,714 sources and 5,000-record query cap
  const totalEligibleSources = 6714;
  const analyzedSourcesCount = 5000;

  const summary = buildCorpusAggregateSummary({
    totalSources: totalEligibleSources,
    totalRobots: 20,
    totalContributions: 15,
    totalPerspectives: 30,
    totalScoredSources: 6500,
    sourcesWithPubDate: 6000,
    robotsWithYear: 18,
    analyzedSourcesCount,
    analyzedRobotsCount: 20,
    analyzedContributionsCount: 15,
    analyzedPerspectivesCount: 30,
    sampleLimit: DEFAULT_ANALYTICS_SAMPLE_LIMIT
  });

  // Totals must reflect the full 6,714 records, NOT the capped 5,000 loader length
  assert.equal(summary.totalEligibleSources, 6714);
  assert.equal(summary.analyzedSourcesCount, 5000);
  assert.equal(summary.isSampleTruncated, true);
  assert.ok(summary.coveragePercent < 100);
  assert.equal(summary.coverageFraction, 0.7472); // 5065 / 6779
  assert.equal(summary.dateDisclosures.sourcesMissingPublicationDate, 714);
  assert.ok(summary.dateDisclosures.sourcesMissingPublicationDateRate > 0.1);
});

test("Audit D11 Acceptance: loadWholeCorpusAnalytics exercises database loader with 6,714-row fixture, verifying counts, filters, samples and truncation", async () => {
  const origSourceCount = prisma.sourceRecord.count;
  const origRobotCount = prisma.robotModel.count;
  const origContribCount = prisma.contribution.count;
  const origPerspCount = prisma.perspectiveAnnotation.count;
  const origSourceFindMany = prisma.sourceRecord.findMany;
  const origRobotFindMany = prisma.robotModel.findMany;
  const origContribFindMany = prisma.contribution.findMany;
  const origPerspFindMany = prisma.perspectiveAnnotation.findMany;

  const capturedCountWheres: any[] = [];
  const capturedFindManyArgs: any[] = [];

  try {
    // 1. Mock count queries across the complete snapshot
    (prisma.sourceRecord as any).count = async (args: any) => {
      capturedCountWheres.push({ domain: "sourceRecord", where: args?.where });
      if (args?.where?.publishedAt?.not !== undefined) return 6000;
      if (args?.where?.relevanceConfidence?.gt !== undefined) return 6500;
      return 6714;
    };
    (prisma.robotModel as any).count = async (args: any) => {
      capturedCountWheres.push({ domain: "robotModel", where: args?.where });
      if (args?.where?.firstSeenYear?.not !== undefined) return 18;
      return 20;
    };
    (prisma.contribution as any).count = async (args: any) => {
      capturedCountWheres.push({ domain: "contribution", where: args?.where });
      return 15;
    };

    // 2. Mock findMany queries returning a sample bounded by take (sampleLimit = 5,000)
    (prisma.sourceRecord as any).findMany = async (args: any) => {
      capturedFindManyArgs.push({ domain: "sourceRecord", ...args });
      const take = args?.take ?? 5000;
      return Array.from({ length: Math.min(take, 5000) }, (_, i) => ({
        sourceType: "NEWS",
        relevanceStatus: "ACCEPTED",
        platform: "Web",
        publishedAt: new Date("2024-01-01"),
        createdAt: new Date("2024-01-02"),
        relevanceConfidence: 0.9,
        title: `Mock News Source ${i}`,
        rawMeta: {}
      }));
    };
    (prisma.robotModel as any).findMany = async (args: any) => {
      capturedFindManyArgs.push({ domain: "robotModel", ...args });
      return [
        {
          canonicalName: "Dinsaw 4",
          robotType: "social_service_robot",
          thailandStatus: "developed_in_thailand",
          countryOfOrigin: "Thailand",
          statusConfidence: 0.9,
          firstSeenYear: 2020,
          createdAt: new Date("2024-01-01")
        }
      ];
    };
    (prisma.contribution as any).findMany = async (args: any) => {
      capturedFindManyArgs.push({ domain: "contribution", ...args });
      return [];
    };
    (prisma.perspectiveAnnotation as any).findMany = async (args: any) => {
      capturedFindManyArgs.push({ domain: "perspectiveAnnotation", ...args });
      return Array.from({ length: 30 }, (_, i) => ({
        perspectiveTheme: `healthcare_trust_${i}`,
        stance: "supportive",
        sentiment: "positive",
        targetEntity: "CU-Robo",
        confidence: 0.9,
        createdAt: new Date("2024-01-01"),
        evidenceExcerpt: "CU-Robo telepresence and medication delivery robot deployed across hospital wards",
        method: "human_review",
        source: {
          title: "CU-Robo in hospital",
          excerpt: "CU-Robo telepresence and medication delivery robot deployed across hospital wards",
          relevanceStatus: "ACCEPTED",
          updatedAt: new Date("2024-01-01")
        }
      }));
    };

    // 3. Call the actual database loader with 5,000 sampleLimit
    const result = await loadWholeCorpusAnalytics(5000);

    // Verify whole-corpus totals are preserved (6,714), not capped at 5,000
    assert.equal(result.summary.totalEligibleSources, 6714);
    assert.equal(result.summary.analyzedSourcesCount, 5000);
    assert.equal(result.summary.isSampleTruncated, true);
    assert.equal(result.summary.sampleLimit, 5000);
    assert.ok(result.summary.coveragePercent < 100);
    assert.equal(result.summary.totalVerifiedPublicRecords, 6714 + 20 + 15 + 30);
    assert.equal(result.summary.totalAnalyzedEvents, 5031); // 5000 sources + 1 robot + 30 perspectives

    // Verify that the query filters applied the approved public WHERE clauses
    const sourceCountCall = capturedCountWheres.find(
      (c) => c.domain === "sourceRecord" && !c.where?.publishedAt && !c.where?.relevanceConfidence
    );
    assert.deepEqual(sourceCountCall.where, publicSourceRecordWhere);

    const robotCountCall = capturedCountWheres.find(
      (c) => c.domain === "robotModel" && !c.where?.firstSeenYear
    );
    assert.deepEqual(robotCountCall.where, publicRobotWhere);

    const contribCountCall = capturedCountWheres.find((c) => c.domain === "contribution");
    assert.deepEqual(contribCountCall.where, publicContributionWhere);

    const perspFindCall = capturedFindManyArgs.find((a) => a.domain === "perspectiveAnnotation");
    assert.deepEqual(perspFindCall.where, publicPerspectiveWhere);

    const sourceFindCall = capturedFindManyArgs.find((a) => a.domain === "sourceRecord");
    assert.equal(sourceFindCall.take, 5000);
    assert.deepEqual(sourceFindCall.where, publicSourceRecordWhere);
  } finally {
    prisma.sourceRecord.count = origSourceCount;
    prisma.robotModel.count = origRobotCount;
    prisma.contribution.count = origContribCount;
    prisma.perspectiveAnnotation.count = origPerspCount;
    prisma.sourceRecord.findMany = origSourceFindMany;
    prisma.robotModel.findMany = origRobotFindMany;
    prisma.contribution.findMany = origContribFindMany;
    prisma.perspectiveAnnotation.findMany = origPerspFindMany;
  }
});

test("Perspective Freshness: isFreshPerspectiveAnnotation and buildAnalyticsEvents exclude stale annotations after re-ingestion", () => {
  const currentSource = {
    title: "Chulalongkorn University deploys CU-Robo in hospital",
    excerpt: "CU-Robo telepresence and medication delivery robot deployed across hospital wards in Bangkok.",
    relevanceStatus: "ACCEPTED",
    updatedAt: new Date("2026-11-07T12:00:00Z")
  };

  // Fresh annotation: evidence excerpt is preserved in re-ingested source
  const freshAnnotation = {
    evidenceExcerpt: "CU-Robo telepresence and medication delivery robot deployed across hospital wards",
    createdAt: new Date("2026-11-01"),
    method: "human_review"
  };
  assert.equal(isFreshPerspectiveAnnotation(freshAnnotation, currentSource), true);

  // Stale annotation: source text was changed on re-ingestion, old evidence excerpt is absent
  const staleAnnotation = {
    evidenceExcerpt: "Old prototype discontinued before hospital deployment",
    createdAt: new Date("2024-01-01"),
    method: "human_review"
  };
  assert.equal(isFreshPerspectiveAnnotation(staleAnnotation, currentSource), false);

  // Ineligible parent source: rejected
  const rejectedSource = {
    ...currentSource,
    relevanceStatus: "REJECTED"
  };
  assert.equal(isFreshPerspectiveAnnotation(freshAnnotation, rejectedSource), false);

  // Verification in buildAnalyticsEvents: fresh survives, stale is excluded
  const events = buildAnalyticsEvents({
    sources: [],
    robots: [],
    contributions: [],
    perspectives: [
      {
        perspectiveTheme: "healthcare_trust",
        stance: "supportive",
        sentiment: "positive",
        targetEntity: "CU-Robo",
        confidence: 0.9,
        createdAt: new Date("2026-11-01"),
        evidenceExcerpt: freshAnnotation.evidenceExcerpt,
        source: currentSource
      },
      {
        perspectiveTheme: "discontinued_risk",
        stance: "skeptical",
        sentiment: "negative",
        targetEntity: "Old prototype",
        confidence: 0.85,
        createdAt: new Date("2024-01-01"),
        evidenceExcerpt: staleAnnotation.evidenceExcerpt,
        source: currentSource
      }
    ]
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].label, "healthcare_trust");
});

test("Perspective Freshness Reconciliation: stale annotations do not inflate totals and cannot crowd out fresh annotations beyond the sample limit", async () => {
  const origFindMany = prisma.perspectiveAnnotation.findMany;
  const origSourceCount = prisma.sourceRecord.count;
  const origRobotCount = prisma.robotModel.count;
  const origContribCount = prisma.contribution.count;
  const origSourceFindMany = prisma.sourceRecord.findMany;
  const origRobotFindMany = prisma.robotModel.findMany;
  const origContribFindMany = prisma.contribution.findMany;

  try {
    (prisma.sourceRecord.count as any) = async () => 0;
    (prisma.robotModel.count as any) = async () => 0;
    (prisma.contribution.count as any) = async () => 0;
    (prisma.sourceRecord.findMany as any) = async () => [];
    (prisma.robotModel.findMany as any) = async () => [];
    (prisma.contribution.findMany as any) = async () => [];

    const acceptedSource = {
      title: "Active Humanoid Robotics Project in Thailand",
      excerpt: "Demonstrating autonomous navigation and interaction in real hospitals.",
      relevanceStatus: "ACCEPTED",
      updatedAt: new Date("2026-11-07")
    };

    // Construct 2 stale annotations with recent timestamps (ahead in desc order)
    const staleAhead = [
      {
        perspectiveTheme: "stale_theme_1",
        stance: "supportive",
        sentiment: "positive",
        targetEntity: "robot_1",
        confidence: 0.9,
        createdAt: new Date("2026-11-08T10:00:00Z"), // Most recent
        evidenceExcerpt: "Removed obsolete excerpt that is no longer in parent text",
        method: "rules_with_evidence",
        source: acceptedSource
      },
      {
        perspectiveTheme: "stale_theme_2",
        stance: "supportive",
        sentiment: "positive",
        targetEntity: "robot_2",
        confidence: 0.85,
        createdAt: new Date("2026-11-08T09:00:00Z"),
        evidenceExcerpt: "Another deleted obsolete excerpt",
        method: "rules_with_evidence",
        source: acceptedSource
      }
    ];

    // Construct 4 fresh annotations with older timestamps
    const freshBeyond = Array.from({ length: 4 }, (_, i) => ({
      perspectiveTheme: `fresh_theme_${i + 1}`,
      stance: "supportive",
      sentiment: "positive",
      targetEntity: `robot_fresh_${i + 1}`,
      confidence: 0.88,
      createdAt: new Date(`2026-11-01T0${i + 1}:00:00Z`), // Older
      evidenceExcerpt: "Demonstrating autonomous navigation", // Matches parent excerpt!
      method: "human_review",
      source: acceptedSource
    }));

    // In descending createdAt order: 2 stale annotations are ahead of the 4 fresh annotations
    (prisma.perspectiveAnnotation.findMany as any) = async (args: any) => {
      // Reconciled loader fetches all candidates to evaluate freshness without premature limit cutoffs
      return [...staleAhead, ...freshBeyond];
    };

    // Call loadWholeCorpusAnalytics with sampleLimit = 3
    // Under the old bug: take: 3 would fetch 2 stale + 1 fresh, leaving only 1 fresh annotation
    // in the sample while crowding out the remaining 3 fresh annotations.
    // Under the reconciled engine: stale annotations are filtered out before slicing the sample,
    // so all 3 slots of sampleLimit are filled by fresh annotations and totals strictly reflect
    // the 4 fresh annotations (never inflated to 6).
    const { summary, events } = await loadWholeCorpusAnalytics(3);

    // 1. Total count must reconcile to ONLY fresh annotations (4), NOT inflated by stale annotations (6)
    assert.equal(summary.totalEligiblePerspectives, 4);

    // 2. Analyzed sample count must equal the sampleLimit (3), proving fresh annotations were NOT crowded out
    assert.equal(summary.analyzedPerspectivesCount, 3);
    assert.equal(events.length, 3);
    assert.equal(summary.isSampleTruncated, true);
    assert.equal(summary.sampleLimit, 3);

    // 3. Every single analyzed event must be fresh
    for (const ev of events) {
      assert.ok(ev.label.startsWith("fresh_theme_"), `Expected fresh theme, got: ${ev.label}`);
    }
  } finally {
    prisma.perspectiveAnnotation.findMany = origFindMany;
    prisma.sourceRecord.count = origSourceCount;
    prisma.robotModel.count = origRobotCount;
    prisma.contribution.count = origContribCount;
    prisma.sourceRecord.findMany = origSourceFindMany;
    prisma.robotModel.findMany = origRobotFindMany;
    prisma.contribution.findMany = origContribFindMany;
  }
});

test("Whole-Corpus Fixture Reconciliation: verifies loader metrics directly against real thailand_humanoid_atlas_seed_records.json fixture (6,749 records)", async () => {
  const fixturePath = resolve(process.cwd(), "data/imports/thailand_humanoid_atlas_seed_records.json");
  assert.ok(existsSync(fixturePath), "Real seed fixture file must exist");
  const rawContent = readFileSync(fixturePath, "utf8");
  const seedRecords = JSON.parse(rawContent) as any[];

  // 1. Reconcile raw record counts from the real fixture file
  const sourceRecords = seedRecords.filter((r) => r.category === "source_record");
  const robotModels = seedRecords.filter((r) => r.category === "robot_model");
  const contributions = seedRecords.filter((r) => r.category === "contribution");
  const perspectiveAnnotations = seedRecords.filter((r) => r.category === "perspective_annotation");

  assert.equal(seedRecords.length, 6749, "Real seed fixture must have 6,749 records");
  assert.equal(sourceRecords.length, 6714, "Real seed fixture must contain exactly 6,714 source records");
  assert.equal(robotModels.length, 16, "Real seed fixture must contain 16 robot models");
  assert.equal(contributions.length, 3, "Real seed fixture must contain 3 contributions");
  assert.equal(perspectiveAnnotations.length, 4, "Real seed fixture must contain 4 perspective annotations");

  // 2. Reconcile public eligibility policies on the real fixture
  const eligibleRobots = robotModels.filter((r) => isEligiblePublicRobot(r.canonical_name || ""));
  assert.equal(eligibleRobots.length, 15, "Exactly 15 of 16 robots are eligible (Bumi humanoid robot excluded)");

  const eligibleContributions = contributions.filter((c) =>
    isEligiblePublicContribution({ visibility: "public", verificationStatus: "APPROVED", sourceUrl: c.url })
  );
  assert.equal(eligibleContributions.length, 3, "All 3 contributions are eligible public records");

  const sourcesWithPubDate = sourceRecords.filter((s) => s.published_at !== null && s.published_at !== undefined);
  assert.equal(sourcesWithPubDate.length, 6705, "Exactly 6,705 sources have published_at");
  const missingPubDates = sourceRecords.length - sourcesWithPubDate.length;
  assert.equal(missingPubDates, 9, "Exactly 9 sources are missing publication date");

  // 3. Connect real fixture records into the loader execution
  const origSourceCount = prisma.sourceRecord.count;
  const origRobotCount = prisma.robotModel.count;
  const origContribCount = prisma.contribution.count;
  const origSourceFindMany = prisma.sourceRecord.findMany;
  const origRobotFindMany = prisma.robotModel.findMany;
  const origContribFindMany = prisma.contribution.findMany;
  const origPerspFindMany = prisma.perspectiveAnnotation.findMany;

  try {
    (prisma.sourceRecord as any).count = async (args: any) => {
      if (args?.where?.publishedAt?.not !== undefined) return sourcesWithPubDate.length;
      if (args?.where?.relevanceConfidence?.gt !== undefined) return sourceRecords.length;
      return sourceRecords.length;
    };
    (prisma.robotModel as any).count = async (args: any) => {
      if (args?.where?.firstSeenYear?.not !== undefined) {
        return eligibleRobots.filter((r) => r.first_seen_year !== null && r.first_seen_year !== undefined).length;
      }
      return eligibleRobots.length;
    };
    (prisma.contribution as any).count = async () => eligibleContributions.length;

    // Loader queries mapped directly from real fixture data
    (prisma.sourceRecord as any).findMany = async (args: any) => {
      const take = args?.take ?? 5000;
      return sourceRecords.slice(0, take).map((s) => ({
        sourceType: s.source_platform ? "WEB" : "NEWS",
        relevanceStatus: "ACCEPTED",
        platform: s.source_platform,
        publishedAt: s.published_at ? new Date(s.published_at) : null,
        createdAt: new Date("2024-01-01"),
        relevanceConfidence: s.confidence ?? 0.5,
        title: s.title,
        rawMeta: {}
      }));
    };
    (prisma.robotModel as any).findMany = async (args: any) => {
      const take = args?.take ?? 5000;
      return eligibleRobots.slice(0, take).map((r) => ({
        canonicalName: r.canonical_name,
        robotType: r.robot_type || "unknown",
        thailandStatus: "observed_in_thailand",
        countryOfOrigin: r.country,
        statusConfidence: r.confidence ?? 0.5,
        firstSeenYear: null,
        createdAt: new Date("2024-01-01")
      }));
    };
    (prisma.contribution as any).findMany = async () => {
      return eligibleContributions.map((c) => ({
        title: c.title,
        contributionType: c.contribution_type || "research_paper",
        verificationStatus: "APPROVED",
        visibility: "public",
        organization: c.organization,
        createdAt: new Date("2024-01-01"),
        sourceUrl: c.url
      }));
    };
    (prisma.perspectiveAnnotation as any).findMany = async () => {
      return perspectiveAnnotations.map((p) => ({
        perspectiveTheme: p.perspective_theme || "robotics_adoption",
        stance: p.stance || "neutral",
        sentiment: p.sentiment || "neutral",
        targetEntity: p.canonical_name || "robot",
        confidence: p.confidence ?? 0.8,
        createdAt: new Date("2024-01-01"),
        evidenceExcerpt: p.evidence_excerpt || p.description || "",
        method: "seed_json",
        source: {
          title: p.title,
          excerpt: p.evidence_excerpt || p.description || "",
          relevanceStatus: "ACCEPTED",
          updatedAt: new Date("2024-01-01")
        }
      }));
    };

    const { summary } = await loadWholeCorpusAnalytics(5000);

    // Verify complete reconciliation against real seed fixture
    assert.equal(summary.totalEligibleSources, 6714);
    assert.equal(summary.analyzedSourcesCount, 5000);
    assert.equal(summary.isSampleTruncated, true);
    assert.equal(summary.sampleLimit, 5000);
    assert.equal(summary.totalEligibleRobots, 15);
    assert.equal(summary.totalEligibleContributions, 3);
    assert.equal(summary.totalEligiblePerspectives, 4);
    assert.equal(summary.totalVerifiedPublicRecords, 6714 + 15 + 3 + 4); // 6,736
    assert.equal(summary.dateDisclosures.sourcesWithPublicationDate, 6705);
    assert.equal(summary.dateDisclosures.sourcesMissingPublicationDate, 9);
    assert.ok(Math.abs(summary.dateDisclosures.sourcesMissingPublicationDateRate - (9 / 6714)) < 0.0001);
  } finally {
    prisma.sourceRecord.count = origSourceCount;
    prisma.robotModel.count = origRobotCount;
    prisma.contribution.count = origContribCount;
    prisma.sourceRecord.findMany = origSourceFindMany;
    prisma.robotModel.findMany = origRobotFindMany;
    prisma.contribution.findMany = origContribFindMany;
    prisma.perspectiveAnnotation.findMany = origPerspFindMany;
  }
});

test("Live Database Whole-Corpus Reconciliation: verifies live database snapshot when seeded", { skip: !process.env.ATLAS_LIVE_DB_TEST }, async () => {
  const { summary } = await loadWholeCorpusAnalytics();
  assert.ok(summary.totalEligibleSources >= 6714);
  assert.ok(summary.totalEligibleRobots >= 15);
  assert.ok(summary.totalEligibleContributions >= 3);
  assert.ok(summary.totalEligiblePerspectives >= 4);
});

test("Timeline Date Segregation: formatTimeBucketKey distinguishes chronological periods from year_only and undated", () => {
  const datedEvent: CorpusAnalyticsEvent = {
    scope: "sources",
    label: "Dated Robot Paper",
    confidence: 0.9,
    eventType: "source",
    eventDate: "2023-04-15T00:00:00.000Z",
    ingestionDate: "2026-11-07T00:00:00.000Z",
    dateKind: "publication",
    datePrecision: "exact_date",
    displayYear: 2023,
    monthKey: "2023-04",
    yearKey: "2023",
    sourceType: "NEWS",
    relevanceStatus: "ACCEPTED",
    platform: "Web",
    robotType: "unknown",
    thailandStatus: "unknown",
    contributionType: "unknown",
    verificationStatus: "unknown",
    perspectiveTheme: "unknown",
    stance: "unknown",
    sentiment: "unknown",
    submissionType: "unknown",
    status: "unknown",
    visibility: "public",
    countryOfOrigin: "unknown",
    ownerOrg: "unknown"
  };

  const yearOnlyEvent: CorpusAnalyticsEvent = {
    ...datedEvent,
    datePrecision: "year_only",
    monthKey: null,
    eventDate: null
  };

  const undatedEvent: CorpusAnalyticsEvent = {
    ...datedEvent,
    datePrecision: "missing",
    displayYear: null,
    monthKey: null,
    yearKey: null,
    eventDate: null
  };

  assert.equal(formatTimeBucketKey(datedEvent, "month", "publication"), "2023-04");
  assert.equal(formatTimeBucketKey(yearOnlyEvent, "month", "publication"), "year_only");
  assert.equal(formatTimeBucketKey(undatedEvent, "month", "publication"), "undated");

  const isChronologicalKey = (k: string) => /^\d{4}(-\d{2})?$/.test(k);
  assert.ok(isChronologicalKey(formatTimeBucketKey(datedEvent, "month", "publication")));
  assert.ok(!isChronologicalKey(formatTimeBucketKey(yearOnlyEvent, "month", "publication")));
  assert.ok(!isChronologicalKey(formatTimeBucketKey(undatedEvent, "month", "publication")));
});

test("Corpus Aggregation: confirms complete coverage when snapshot is within limit", () => {
  const summary = buildCorpusAggregateSummary({
    totalSources: 1200,
    totalRobots: 25,
    totalContributions: 10,
    totalPerspectives: 40,
    totalScoredSources: 1150,
    sourcesWithPubDate: 1100,
    robotsWithYear: 24,
    analyzedSourcesCount: 1200,
    analyzedRobotsCount: 25,
    analyzedContributionsCount: 10,
    analyzedPerspectivesCount: 40,
    sampleLimit: DEFAULT_ANALYTICS_SAMPLE_LIMIT
  });

  assert.equal(summary.totalEligibleSources, 1200);
  assert.equal(summary.isSampleTruncated, false);
  assert.equal(summary.coverageFraction, 1);
  assert.equal(summary.coveragePercent, 100);
});

test("Policy Scoping: buildAnalyticsEvents excludes non-eligible fields and retains public projections", () => {
  const events = buildAnalyticsEvents({
    sources: [
      {
        sourceType: "OPENALEX",
        relevanceStatus: "ACCEPTED",
        platform: "openalex",
        publishedAt: new Date("2022-03-01"),
        createdAt: new Date("2026-11-01"),
        relevanceConfidence: 0.92,
        title: "Thai Humanoid Robot Study",
        rawMeta: { openalexId: "W999" }
      }
    ],
    robots: [
      {
        canonicalName: "Dinsaw 4",
        robotType: "social_service_robot",
        thailandStatus: "commercial",
        countryOfOrigin: "Thailand",
        statusConfidence: 0.95,
        firstSeenYear: 2021,
        createdAt: new Date("2026-11-01")
      }
    ],
    contributions: [
      {
        title: "Hospital trial report",
        contributionType: "deployment_case",
        verificationStatus: "APPROVED",
        visibility: "public",
        organization: "Chulalongkorn",
        createdAt: new Date("2026-11-02")
      }
    ],
    perspectives: [
      {
        perspectiveTheme: "healthcare_and_eldercare_trust",
        stance: "supportive",
        sentiment: "positive",
        targetEntity: "Dinsaw 4",
        confidence: 0.88,
        createdAt: new Date("2026-11-02"),
        evidenceExcerpt: "Successful trial in ward."
      }
    ]
  });

  assert.equal(events.length, 4);
  assert.equal(events[0].scope, "sources");
  assert.equal(events[0].datePrecision, "exact_date");
  assert.equal(events[1].scope, "robots");
  assert.equal(events[1].datePrecision, "year_only");
  assert.equal(events[2].scope, "contributions");
  assert.equal(events[3].scope, "perspectives");
  // Contributions & perspectives must have null eventDate by policy
  assert.equal(events[2].eventDate, null);
  assert.equal(events[2].datePrecision, "missing");
  assert.equal(events[3].eventDate, null);
  assert.equal(events[3].datePrecision, "missing");
});

test("Date Semantics: contributions and perspectives preserve null event dates and only use createdAt for ingestion dimension", () => {
  const semantics = parseIngestionDateSemantics("2026-11-07T12:00:00.000Z");
  assert.equal(semantics.eventDate, null);
  assert.equal(semantics.dateKind, "missing");
  assert.equal(semantics.datePrecision, "missing");
  assert.equal(semantics.displayYear, null);
  assert.equal(semantics.monthKey, null);
  assert.equal(semantics.yearKey, null);
  assert.equal(semantics.ingestionDate.toISOString(), "2026-11-07T12:00:00.000Z");
});

test("Loader Filtering: buildAnalyticsEvents strictly filters unaccepted, placeholder, and excluded records", () => {
  const events = buildAnalyticsEvents({
    sources: [
      {
        sourceType: "WEB",
        relevanceStatus: "ACCEPTED",
        platform: "web",
        publishedAt: new Date("2024-01-01"),
        createdAt: new Date("2026-11-01"),
        relevanceConfidence: 0.95,
        title: "Eligible Robot News"
      },
      {
        sourceType: "WEB",
        relevanceStatus: "REJECTED", // Must be filtered out
        platform: "web",
        publishedAt: new Date("2024-01-01"),
        createdAt: new Date("2026-11-01"),
        relevanceConfidence: 0.1,
        title: "Rejected Software News"
      }
    ],
    robots: [
      {
        canonicalName: "Dinsaw 4", // Eligible
        robotType: "social_service_robot",
        thailandStatus: "commercial",
        countryOfOrigin: "Thailand",
        statusConfidence: 0.95,
        firstSeenYear: 2021,
        createdAt: new Date("2026-11-01")
      },
      {
        canonicalName: "Hospital Delivery Service Robot", // Excluded placeholder bucket
        robotType: "placeholder",
        thailandStatus: "unknown",
        countryOfOrigin: null,
        statusConfidence: 0.1,
        firstSeenYear: 2020,
        createdAt: new Date("2026-11-01")
      },
      {
        canonicalName: "Bumi Humanoid Robot", // Excluded out-of-scope foreign robot
        robotType: "humanoid",
        thailandStatus: "exhibited",
        countryOfOrigin: "China",
        statusConfidence: 0.5,
        firstSeenYear: 2023,
        createdAt: new Date("2026-11-01")
      }
    ],
    contributions: [
      {
        title: "Eligible Public Contribution",
        contributionType: "deployment",
        verificationStatus: "APPROVED",
        visibility: "public",
        organization: "CU",
        createdAt: new Date("2026-11-02"),
        sourceUrl: "https://example.com/case-1"
      },
      {
        title: "Excluded Placeholder Contribution",
        contributionType: "deployment",
        verificationStatus: "APPROVED",
        visibility: "public",
        organization: "CU",
        createdAt: new Date("2026-11-02"),
        sourceUrl: "seed:contribution:thai-hri-research" // Excluded
      },
      {
        title: "Private Contribution",
        contributionType: "dataset",
        verificationStatus: "APPROVED",
        visibility: "private", // Excluded
        organization: "Internal",
        createdAt: new Date("2026-11-02"),
        sourceUrl: "https://example.com/internal"
      },
      {
        title: "Unreviewed Contribution",
        contributionType: "dataset",
        verificationStatus: "NEEDS_REVIEW", // Excluded
        visibility: "public",
        organization: "External",
        createdAt: new Date("2026-11-02"),
        sourceUrl: "https://example.com/pending"
      }
    ],
    perspectives: [
      {
        perspectiveTheme: "trust",
        stance: "supportive",
        sentiment: "positive",
        targetEntity: "Dinsaw 4",
        confidence: 0.9,
        createdAt: new Date("2026-11-02"),
        evidenceExcerpt: "Great results.",
        source: { relevanceStatus: "ACCEPTED" } // Eligible parent
      },
      {
        perspectiveTheme: "trust",
        stance: "critical",
        sentiment: "negative",
        targetEntity: "Rejected Robot",
        confidence: 0.8,
        createdAt: new Date("2026-11-02"),
        evidenceExcerpt: "Flawed.",
        source: { relevanceStatus: "REJECTED" } // Ineligible parent -> must drop
      }
    ]
  });

  // Exactly 1 source, 1 robot, 1 contribution, 1 perspective must remain
  assert.equal(events.length, 4);
  assert.equal(events[0].label, "Eligible Robot News");
  assert.equal(events[1].label, "Dinsaw 4");
  assert.equal(events[2].label, "Eligible Public Contribution");
  assert.equal(events[3].label, "trust");
});

test("Hybrid Graph: loadGraphRecordsHybrid propagates Prisma loader cap warnings", async () => {
  const { prisma } = await import("../lib/prisma");
  const origRobots = prisma.robotModel.findMany;
  const origInventory = prisma.ownedInventory.findMany;
  const origContributions = prisma.contribution.findMany;
  const origSources = prisma.sourceRecord.findMany;
  const origPerspectives = prisma.perspectiveAnnotation.findMany;
  const origTriplets = prisma.triplet.findMany;

  try {
    // Mock 700 robots to simulate loader cap hit
    (prisma.robotModel as any).findMany = async () => new Array(700).fill({
      id: "mock",
      canonicalName: "Mock Robot",
      robotType: "humanoid",
      thailandStatus: "commercial",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    (prisma.ownedInventory as any).findMany = async () => [];
    (prisma.contribution as any).findMany = async () => [];
    (prisma.sourceRecord as any).findMany = async () => [];
    (prisma.perspectiveAnnotation as any).findMany = async () => [];
    (prisma.triplet as any).findMany = async () => [];

    const { loadGraphRecordsHybrid } = await import("../lib/network-graph");
    const result = await loadGraphRecordsHybrid();
    assert.ok(Array.isArray(result.warnings));
    assert.ok(
      result.warnings.some((w) => w.includes("Robot models query reached loader cap (700)")),
      "Expected cap warning to be propagated through hybrid loader"
    );
  } finally {
    prisma.robotModel.findMany = origRobots;
    prisma.ownedInventory.findMany = origInventory;
    prisma.contribution.findMany = origContributions;
    prisma.sourceRecord.findMany = origSources;
    prisma.perspectiveAnnotation.findMany = origPerspectives;
    prisma.triplet.findMany = origTriplets;
  }
});
