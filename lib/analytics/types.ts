/**
 * Analytics and Date Semantics Type Definitions (Audit D11 / R4)
 */

export type Scope = "all" | "sources" | "robots" | "contributions" | "perspectives" | "submissions";

export type TimeBucket = "month" | "year";

export type DateDimension = "publication" | "ingestion";

export type DateKind = "publication" | "observation" | "ingestion" | "missing";

export type DatePrecision = "exact_date" | "year_only" | "missing";

export interface DateSemantics {
  dateKind: DateKind;
  datePrecision: DatePrecision;
  eventDate: Date | null;
  ingestionDate: Date;
  displayYear: number | null;
  monthKey: string | null;
  yearKey: string | null;
}

export interface CorpusAnalyticsEvent {
  scope: Scope;
  label: string;
  confidence: number | null;
  eventType: string;

  // Explicit date semantics (separating event time from ingestion time)
  eventDate: string | null;
  ingestionDate: string;
  dateKind: DateKind;
  datePrecision: DatePrecision;
  displayYear: number | null;
  monthKey: string | null;
  yearKey: string | null;

  // Attributes
  sourceType: string;
  relevanceStatus: string;
  platform: string;
  robotType: string;
  thailandStatus: string;
  contributionType: string;
  verificationStatus: string;
  perspectiveTheme: string;
  stance: string;
  sentiment: string;
  submissionType: string;
  status: string;
  visibility: string;
  countryOfOrigin: string;
  ownerOrg: string;
}

export interface DateDisclosures {
  sourcesWithPublicationDate: number;
  sourcesMissingPublicationDate: number;
  sourcesMissingPublicationDateRate: number;
  robotsWithFirstSeenYear: number;
  robotsMissingFirstSeenYear: number;
  yearOnlyDatesCount: number;
  exactDatesCount: number;
}

export interface CorpusAggregateSummary {
  // Whole-corpus totals (computed across entire database snapshot)
  totalEligibleSources: number;
  totalEligibleRobots: number;
  totalEligibleContributions: number;
  totalEligiblePerspectives: number;
  totalEligibleSubmissions: number;
  totalScoredSources: number;
  totalVerifiedPublicRecords: number;

  // Loaded sample counts
  analyzedSourcesCount: number;
  analyzedRobotsCount: number;
  analyzedContributionsCount: number;
  analyzedPerspectivesCount: number;
  totalAnalyzedEvents: number;

  // Sample truncation & coverage disclosure
  isSampleTruncated: boolean;
  sampleLimit: number;
  coverageFraction: number;
  coveragePercent: number;

  // Missing data and precision disclosures
  dateDisclosures: DateDisclosures;

  // Policy scope label
  datasetScopeLabel: string;
}
