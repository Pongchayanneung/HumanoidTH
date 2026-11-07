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
  DEFAULT_ANALYTICS_SAMPLE_LIMIT
} from "../lib/analytics/corpus-analytics";
import type { CorpusAnalyticsEvent } from "../lib/analytics/types";

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

  // Real publication on January 1st with explicit daily precision
  const exactJanFirst = parseSourceDateSemantics(
    "2021-01-01T00:00:00.000Z",
    "2026-11-07T10:00:00.000Z",
    { publicationDatePrecision: "day" }
  );
  assert.equal(exactJanFirst.datePrecision, "exact_date");
  assert.equal(exactJanFirst.monthKey, "2021-01");
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

test("Audit D11 Acceptance: >5,000-row fixture yields full aggregate totals and explicit sample warning", () => {
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
});
