/**
 * Date Semantics & Normalization Module (Audit D11 / R4)
 * 
 * Enforces strict distinction between:
 * 1. Publication Date (Event-time: when research/media was published)
 * 2. Observation Year (Event-time: when robot was first observed/released)
 * 3. Ingestion Date (System-time: when record was entered into the database)
 * 4. Missing/Unknown Dates (preserving nulls without fake January 1 fallbacks)
 */

import type {
  CorpusAnalyticsEvent,
  DateDimension,
  DateKind,
  DatePrecision,
  DateSemantics,
  TimeBucket
} from "./types";

/**
 * Parses date semantics for a source record.
 * Never silently substitutes createdAt as the publication date.
 */
export function parseSourceDateSemantics(
  publishedAt: Date | string | null | undefined,
  createdAt: Date | string,
  rawMeta?: Record<string, unknown> | null
): DateSemantics {
  const ingestionDate = createdAt instanceof Date ? createdAt : new Date(createdAt);

  if (!publishedAt) {
    return {
      dateKind: "missing",
      datePrecision: "missing",
      eventDate: null,
      ingestionDate,
      displayYear: null,
      monthKey: null,
      yearKey: null
    };
  }

  const pubDate = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(pubDate.getTime())) {
    return {
      dateKind: "missing",
      datePrecision: "missing",
      eventDate: null,
      ingestionDate,
      displayYear: null,
      monthKey: null,
      yearKey: null
    };
  }

  const year = pubDate.getUTCFullYear();
  const month = pubDate.getUTCMonth(); // 0-indexed
  const day = pubDate.getUTCDate();

  // Detect date precision: explicit metadata has strict precedence over fallback heuristics
  const explicitPrecision = rawMeta?.publicationDatePrecision;
  const isSyntheticJanFirst = month === 0 && day === 1 && pubDate.getUTCHours() === 0 && pubDate.getUTCMinutes() === 0;

  let precision: DatePrecision;
  if (explicitPrecision === "year") {
    precision = "year_only";
  } else if (explicitPrecision === "day") {
    precision = "exact_date";
  } else if (Boolean(rawMeta?.openalexId) && isSyntheticJanFirst) {
    // Fallback heuristic for legacy OpenAlex citations without explicit precision metadata
    precision = "year_only";
  } else {
    precision = "exact_date";
  }
  const monthKey = precision === "exact_date"
    ? `${year}-${String(month + 1).padStart(2, "0")}`
    : null; // Critical: Year-only records must not produce a January monthKey

  return {
    dateKind: "publication",
    datePrecision: precision,
    eventDate: pubDate,
    ingestionDate,
    displayYear: year,
    monthKey,
    yearKey: String(year)
  };
}

/**
 * Parses date semantics for a robot model record.
 * First-seen year is observation time with year-only precision.
 */
export function parseRobotDateSemantics(
  firstSeenYear: number | null | undefined,
  createdAt: Date | string
): DateSemantics {
  const ingestionDate = createdAt instanceof Date ? createdAt : new Date(createdAt);

  if (!firstSeenYear || Number.isNaN(firstSeenYear) || firstSeenYear <= 1900 || firstSeenYear > 2100) {
    return {
      dateKind: "missing",
      datePrecision: "missing",
      eventDate: null,
      ingestionDate,
      displayYear: null,
      monthKey: null,
      yearKey: null
    };
  }

  return {
    dateKind: "observation",
    datePrecision: "year_only",
    eventDate: new Date(Date.UTC(firstSeenYear, 0, 1)),
    ingestionDate,
    displayYear: firstSeenYear,
    monthKey: null, // Critical: Year-only records must not produce a January monthKey
    yearKey: String(firstSeenYear)
  };
}

/**
 * Parses date semantics for contributions and annotations (ingestion-time events).
 * By policy, createdAt is strictly an ingestion/system timestamp. It must never
 * be substituted as an eventDate or publication date in event timelines.
 */
export function parseIngestionDateSemantics(
  createdAt: Date | string,
  kind: DateKind = "missing"
): DateSemantics {
  const ingestionDate = createdAt instanceof Date ? createdAt : new Date(createdAt);

  return {
    dateKind: "missing",
    datePrecision: "missing",
    eventDate: null,
    ingestionDate,
    displayYear: null,
    monthKey: null,
    yearKey: null
  };
}

/**
 * Computes the time bucket key for grouping time-series analytics.
 * Strictly respects the chosen date dimension (Publication/Event vs Ingestion/System).
 */
export function formatTimeBucketKey(
  event: CorpusAnalyticsEvent,
  bucket: TimeBucket,
  dimension: DateDimension = "publication"
): string {
  if (dimension === "ingestion") {
    // Ingestion timeline: derived from createdAt
    const date = new Date(event.ingestionDate);
    if (Number.isNaN(date.getTime())) return "undated";
    if (bucket === "year") {
      return String(date.getUTCFullYear());
    }
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${date.getUTCFullYear()}-${month}`;
  }

  // Publication / Observation timeline (Event-time)
  if (event.datePrecision === "missing" || event.displayYear === null) {
    return "undated";
  }

  if (bucket === "year") {
    return event.yearKey ?? "undated";
  }

  // Monthly bucket:
  // If date precision is year-only, return "year_only" so it doesn't pollute January!
  if (event.datePrecision === "year_only") {
    return "year_only";
  }

  return event.monthKey ?? "undated";
}
