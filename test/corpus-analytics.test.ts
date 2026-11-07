process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

import assert from "node:assert/strict";
import { test } from "node:test";
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
  isFreshPerspectiveAnnotation
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
    (prisma.perspectiveAnnotation as any).count = async (args: any) => {
      capturedCountWheres.push({ domain: "perspectiveAnnotation", where: args?.where });
      return 30;
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
      return [];
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
    assert.equal(result.summary.totalAnalyzedEvents, 5001);

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

    const perspCountCall = capturedCountWheres.find((c) => c.domain === "perspectiveAnnotation");
    assert.deepEqual(perspCountCall.where, publicPerspectiveWhere);

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
