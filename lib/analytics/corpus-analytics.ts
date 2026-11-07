/**
 * Whole-Corpus Analytics Aggregator & Reconciliation Engine (Audit D11 / R4)
 * 
 * Aggregates complete eligible snapshot, enforces policy scoping,
 * tracks sample limits & coverage fractions, and computes missing-date disclosures.
 */

import { prisma } from "../prisma";
import {
  PUBLIC_DATASET_SCOPE_LABEL,
  publicContributionWhere,
  publicRobotWhere,
  publicSourceRecordWhere,
  publicPerspectiveWhere,
  isEligiblePublicRobot,
  isEligiblePublicContribution
} from "../public-projection";
import {
  parseIngestionDateSemantics,
  parseRobotDateSemantics,
  parseSourceDateSemantics
} from "./date-semantics";
import type {
  CorpusAggregateSummary,
  CorpusAnalyticsEvent,
  DateDisclosures
} from "./types";

export const DEFAULT_ANALYTICS_SAMPLE_LIMIT = 5000;

export interface RawAnalyticsSource {
  sourceType: string;
  relevanceStatus: string;
  platform: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  relevanceConfidence: number;
  title: string;
  rawMeta?: Record<string, unknown> | null;
}

export interface RawAnalyticsRobot {
  canonicalName: string;
  robotType: string;
  thailandStatus: string;
  countryOfOrigin: string | null;
  statusConfidence: number | null;
  firstSeenYear: number | null;
  createdAt: Date;
}

export interface RawAnalyticsContribution {
  title: string;
  contributionType: string;
  verificationStatus: string;
  visibility: string;
  organization: string | null;
  createdAt: Date;
  sourceUrl?: string | null;
}

export interface RawAnalyticsPerspective {
  perspectiveTheme: string;
  stance: string;
  sentiment: string;
  targetEntity: string;
  confidence: number;
  createdAt: Date;
  evidenceExcerpt: string;
  source?: { relevanceStatus?: string } | null;
}

/**
 * Transforms raw database models into normalized CorpusAnalyticsEvents
 * with explicit date semantics. Enforces strict public eligibility filters.
 */
export function buildAnalyticsEvents(params: {
  sources: RawAnalyticsSource[];
  robots: RawAnalyticsRobot[];
  contributions: RawAnalyticsContribution[];
  perspectives: RawAnalyticsPerspective[];
}): CorpusAnalyticsEvent[] {
  const events: CorpusAnalyticsEvent[] = [];

  // Sources (Publication event-time vs Ingestion system-time)
  for (const item of params.sources) {
    if (item.relevanceStatus !== "ACCEPTED") continue;
    const dates = parseSourceDateSemantics(item.publishedAt, item.createdAt, item.rawMeta);
    events.push({
      scope: "sources",
      label: item.title,
      confidence: item.relevanceConfidence,
      eventType: "source",
      eventDate: dates.eventDate ? dates.eventDate.toISOString() : null,
      ingestionDate: dates.ingestionDate.toISOString(),
      dateKind: dates.dateKind,
      datePrecision: dates.datePrecision,
      displayYear: dates.displayYear,
      monthKey: dates.monthKey,
      yearKey: dates.yearKey,
      sourceType: item.sourceType,
      relevanceStatus: item.relevanceStatus,
      platform: item.platform || "unknown",
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
    });
  }

  // Robots (First-seen observation year vs Ingestion system-time)
  for (const item of params.robots) {
    if (!isEligiblePublicRobot(item.canonicalName)) continue;
    const dates = parseRobotDateSemantics(item.firstSeenYear, item.createdAt);
    events.push({
      scope: "robots",
      label: item.canonicalName,
      confidence: item.statusConfidence,
      eventType: "robot",
      eventDate: dates.eventDate ? dates.eventDate.toISOString() : null,
      ingestionDate: dates.ingestionDate.toISOString(),
      dateKind: dates.dateKind,
      datePrecision: dates.datePrecision,
      displayYear: dates.displayYear,
      monthKey: dates.monthKey,
      yearKey: dates.yearKey,
      sourceType: "unknown",
      relevanceStatus: "unknown",
      platform: "unknown",
      robotType: item.robotType,
      thailandStatus: item.thailandStatus,
      contributionType: "unknown",
      verificationStatus: "unknown",
      perspectiveTheme: "unknown",
      stance: "unknown",
      sentiment: "unknown",
      submissionType: "unknown",
      status: "unknown",
      visibility: "unknown",
      countryOfOrigin: item.countryOfOrigin || "unknown",
      ownerOrg: "unknown"
    });
  }

  // Contributions (Public verified contributions)
  for (const item of params.contributions) {
    if (!isEligiblePublicContribution(item)) continue;
    const dates = parseIngestionDateSemantics(item.createdAt, "ingestion");
    events.push({
      scope: "contributions",
      label: item.title,
      confidence: null,
      eventType: "contribution",
      eventDate: dates.eventDate ? dates.eventDate.toISOString() : null,
      ingestionDate: dates.ingestionDate.toISOString(),
      dateKind: dates.dateKind,
      datePrecision: dates.datePrecision,
      displayYear: dates.displayYear,
      monthKey: dates.monthKey,
      yearKey: dates.yearKey,
      sourceType: "unknown",
      relevanceStatus: "unknown",
      platform: "unknown",
      robotType: "unknown",
      thailandStatus: "unknown",
      contributionType: item.contributionType,
      verificationStatus: item.verificationStatus,
      perspectiveTheme: "unknown",
      stance: "unknown",
      sentiment: "unknown",
      submissionType: "unknown",
      status: "unknown",
      visibility: item.visibility,
      countryOfOrigin: "unknown",
      ownerOrg: item.organization || "unknown"
    });
  }

  // Perspectives (Associated with accepted sources)
  for (const item of params.perspectives) {
    if (item.source && item.source.relevanceStatus !== "ACCEPTED") continue;
    const dates = parseIngestionDateSemantics(item.createdAt, "ingestion");
    events.push({
      scope: "perspectives",
      label: item.perspectiveTheme,
      confidence: item.confidence,
      eventType: "perspective",
      eventDate: dates.eventDate ? dates.eventDate.toISOString() : null,
      ingestionDate: dates.ingestionDate.toISOString(),
      dateKind: dates.dateKind,
      datePrecision: dates.datePrecision,
      displayYear: dates.displayYear,
      monthKey: dates.monthKey,
      yearKey: dates.yearKey,
      sourceType: "unknown",
      relevanceStatus: "unknown",
      platform: "unknown",
      robotType: "unknown",
      thailandStatus: "unknown",
      contributionType: "unknown",
      verificationStatus: "unknown",
      perspectiveTheme: item.perspectiveTheme,
      stance: item.stance,
      sentiment: item.sentiment,
      submissionType: "unknown",
      status: "unknown",
      visibility: "unknown",
      countryOfOrigin: "unknown",
      ownerOrg: "unknown"
    });
  }

  return events;
}

/**
 * Builds the complete corpus aggregate summary and coverage disclosure.
 */
export function buildCorpusAggregateSummary(params: {
  totalSources: number;
  totalRobots: number;
  totalContributions: number;
  totalPerspectives: number;
  totalScoredSources: number;
  sourcesWithPubDate: number;
  robotsWithYear: number;
  analyzedSourcesCount: number;
  analyzedRobotsCount: number;
  analyzedContributionsCount: number;
  analyzedPerspectivesCount: number;
  sampleLimit?: number;
  events?: CorpusAnalyticsEvent[];
}): CorpusAggregateSummary {
  const limit = params.sampleLimit ?? DEFAULT_ANALYTICS_SAMPLE_LIMIT;

  const totalVerifiedPublicRecords =
    params.totalSources + params.totalRobots + params.totalContributions + params.totalPerspectives;

  const totalAnalyzedEvents =
    params.analyzedSourcesCount +
    params.analyzedRobotsCount +
    params.analyzedContributionsCount +
    params.analyzedPerspectivesCount;

  // Sample is truncated if ANY category reached the per-table loader cap
  // or if analyzed count is strictly less than total eligible count
  const isSampleTruncated =
    params.analyzedSourcesCount < params.totalSources ||
    params.analyzedRobotsCount < params.totalRobots ||
    params.analyzedContributionsCount < params.totalContributions ||
    params.analyzedPerspectivesCount < params.totalPerspectives;

  const coverageFraction =
    totalVerifiedPublicRecords > 0
      ? Math.min(1, Number((totalAnalyzedEvents / totalVerifiedPublicRecords).toFixed(4)))
      : 1;

  const coveragePercent = Number((coverageFraction * 100).toFixed(1));

  // Date disclosures
  const missingPubDates = Math.max(0, params.totalSources - params.sourcesWithPubDate);
  const missingRate =
    params.totalSources > 0 ? Number((missingPubDates / params.totalSources).toFixed(4)) : 0;

  const events = params.events || [];
  const yearOnlyDatesCount = events.filter((e) => e.datePrecision === "year_only").length;
  const exactDatesCount = events.filter((e) => e.datePrecision === "exact_date").length;

  const dateDisclosures: DateDisclosures = {
    sourcesWithPublicationDate: params.sourcesWithPubDate,
    sourcesMissingPublicationDate: missingPubDates,
    sourcesMissingPublicationDateRate: missingRate,
    robotsWithFirstSeenYear: params.robotsWithYear,
    robotsMissingFirstSeenYear: Math.max(0, params.totalRobots - params.robotsWithYear),
    yearOnlyDatesCount,
    exactDatesCount
  };

  return {
    totalEligibleSources: params.totalSources,
    totalEligibleRobots: params.totalRobots,
    totalEligibleContributions: params.totalContributions,
    totalEligiblePerspectives: params.totalPerspectives,
    totalEligibleSubmissions: 0,
    totalScoredSources: params.totalScoredSources,
    totalVerifiedPublicRecords,
    analyzedSourcesCount: params.analyzedSourcesCount,
    analyzedRobotsCount: params.analyzedRobotsCount,
    analyzedContributionsCount: params.analyzedContributionsCount,
    analyzedPerspectivesCount: params.analyzedPerspectivesCount,
    totalAnalyzedEvents,
    isSampleTruncated,
    sampleLimit: limit,
    coverageFraction,
    coveragePercent,
    dateDisclosures,
    datasetScopeLabel: PUBLIC_DATASET_SCOPE_LABEL
  };
}

/**
 * Fetches whole-corpus data and produces events and complete summary metadata.
 */
export async function loadWholeCorpusAnalytics(sampleLimit = DEFAULT_ANALYTICS_SAMPLE_LIMIT): Promise<{
  summary: CorpusAggregateSummary;
  events: CorpusAnalyticsEvent[];
  dbOffline: boolean;
}> {
  try {
    // 1. Whole-Corpus Aggregation (count queries across complete public snapshot)
    const [
      totalSources,
      totalRobots,
      totalContributions,
      totalPerspectives,
      totalScoredSources,
      sourcesWithPubDate,
      robotsWithYear
    ] = await Promise.all([
      prisma.sourceRecord.count({ where: publicSourceRecordWhere }),
      prisma.robotModel.count({ where: publicRobotWhere }),
      prisma.contribution.count({ where: publicContributionWhere }),
      prisma.perspectiveAnnotation.count({ where: publicPerspectiveWhere }),
      prisma.sourceRecord.count({ where: { ...publicSourceRecordWhere, relevanceConfidence: { gt: 0 } } }),
      prisma.sourceRecord.count({ where: { ...publicSourceRecordWhere, publishedAt: { not: null } } }),
      prisma.robotModel.count({ where: { ...publicRobotWhere, firstSeenYear: { not: null } } })
    ]);

    // 2. Fetch Sampled Events for Visualization (capped at sampleLimit per domain)
    const [sources, robots, contributions, perspectives] = await Promise.all([
      prisma.sourceRecord.findMany({
        where: publicSourceRecordWhere,
        select: {
          sourceType: true,
          relevanceStatus: true,
          platform: true,
          publishedAt: true,
          createdAt: true,
          relevanceConfidence: true,
          title: true,
          rawMeta: true
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: sampleLimit
      }),
      prisma.robotModel.findMany({
        where: publicRobotWhere,
        select: {
          canonicalName: true,
          robotType: true,
          thailandStatus: true,
          countryOfOrigin: true,
          statusConfidence: true,
          firstSeenYear: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" },
        take: sampleLimit
      }),
      prisma.contribution.findMany({
        where: publicContributionWhere,
        select: {
          title: true,
          contributionType: true,
          verificationStatus: true,
          visibility: true,
          organization: true,
          createdAt: true,
          sourceUrl: true
        },
        orderBy: { createdAt: "desc" },
        take: sampleLimit
      }),
      prisma.perspectiveAnnotation.findMany({
        where: publicPerspectiveWhere,
        select: {
          perspectiveTheme: true,
          stance: true,
          sentiment: true,
          targetEntity: true,
          confidence: true,
          createdAt: true,
          evidenceExcerpt: true
        },
        orderBy: { createdAt: "desc" },
        take: sampleLimit
      })
    ]);

    const events = buildAnalyticsEvents({
      sources: sources as RawAnalyticsSource[],
      robots,
      contributions,
      perspectives
    });

    const analyzedSourcesCount = events.filter((e) => e.scope === "sources").length;
    const analyzedRobotsCount = events.filter((e) => e.scope === "robots").length;
    const analyzedContributionsCount = events.filter((e) => e.scope === "contributions").length;
    const analyzedPerspectivesCount = events.filter((e) => e.scope === "perspectives").length;

    const summary = buildCorpusAggregateSummary({
      totalSources,
      totalRobots,
      totalContributions,
      totalPerspectives,
      totalScoredSources,
      sourcesWithPubDate,
      robotsWithYear,
      analyzedSourcesCount,
      analyzedRobotsCount,
      analyzedContributionsCount,
      analyzedPerspectivesCount,
      sampleLimit,
      events
    });

    return {
      summary,
      events,
      dbOffline: false
    };
  } catch (error) {
    console.error("loadWholeCorpusAnalytics database query failed:", error);
    const emptySummary = buildCorpusAggregateSummary({
      totalSources: 0,
      totalRobots: 0,
      totalContributions: 0,
      totalPerspectives: 0,
      totalScoredSources: 0,
      sourcesWithPubDate: 0,
      robotsWithYear: 0,
      analyzedSourcesCount: 0,
      analyzedRobotsCount: 0,
      analyzedContributionsCount: 0,
      analyzedPerspectivesCount: 0,
      sampleLimit,
      events: []
    });
    return {
      summary: emptySummary,
      events: [],
      dbOffline: true
    };
  }
}
