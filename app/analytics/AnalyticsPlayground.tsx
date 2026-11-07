"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";
import type {
  CorpusAggregateSummary,
  CorpusAnalyticsEvent,
  DateDimension,
  Scope,
  TimeBucket
} from "@/lib/analytics/types";
import { formatTimeBucketKey } from "@/lib/analytics/date-semantics";

interface AnalyticsPlaygroundProps {
  events: CorpusAnalyticsEvent[];
  summary?: CorpusAggregateSummary;
}

const scopeLabels: Record<Scope, string> = {
  all: "All Pages",
  sources: "Internet Sources",
  robots: "Robot Registry",
  contributions: "Contributions",
  perspectives: "Perspectives",
  submissions: "Submissions"
};

const scopeOrder: Scope[] = ["sources", "robots", "contributions", "perspectives", "submissions", "all"];

const fieldCatalog: Record<Scope, Array<{ value: string; label: string }>> = {
  all: [
    { value: "eventType", label: "Event Type" },
    { value: "sourceType", label: "Source Type" },
    { value: "relevanceStatus", label: "Relevance Status" },
    { value: "platform", label: "Platform" },
    { value: "robotType", label: "Robot Type" },
    { value: "thailandStatus", label: "Thailand Status" },
    { value: "contributionType", label: "Contribution Type" },
    { value: "verificationStatus", label: "Review Status" },
    { value: "perspectiveTheme", label: "Perspective Theme" },
    { value: "stance", label: "Stance" },
    { value: "sentiment", label: "Sentiment" },
    { value: "submissionType", label: "Submission Type" },
    { value: "status", label: "Status" },
    { value: "visibility", label: "Visibility" }
  ],
  sources: [
    { value: "sourceType", label: "Source Type" },
    { value: "relevanceStatus", label: "Relevance Status" },
    { value: "platform", label: "Platform" }
  ],
  robots: [
    { value: "robotType", label: "Robot Type" },
    { value: "thailandStatus", label: "Thailand Status" },
    { value: "countryOfOrigin", label: "Country of Origin" }
  ],
  contributions: [
    { value: "contributionType", label: "Contribution Type" },
    { value: "verificationStatus", label: "Verification Status" },
    { value: "visibility", label: "Visibility" },
    { value: "ownerOrg", label: "Organization" }
  ],
  perspectives: [
    { value: "perspectiveTheme", label: "Perspective Theme" },
    { value: "stance", label: "Stance" },
    { value: "sentiment", label: "Sentiment" }
  ],
  submissions: [
    { value: "submissionType", label: "Submission Type" },
    { value: "status", label: "Status" }
  ]
};

const palette = ["#19523c", "#28744b", "#4f8b62", "#7fa87f", "#a9bea9", "#d4af37", "#c5931b", "#9c2e26", "#5e7568"];
const remainderLabel = "Remaining live categories";

function humanize(value: string) {
  return value.replace(/_/g, " ");
}

function seriesLabel(value: string) {
  return value === "unknown" || value === "n/a" ? value : humanize(value);
}

function getFieldValue(event: CorpusAnalyticsEvent, field: string) {
  switch (field) {
    case "eventType":
      return event.eventType;
    case "sourceType":
      return event.sourceType;
    case "relevanceStatus":
      return event.relevanceStatus;
    case "platform":
      return event.platform;
    case "robotType":
      return event.robotType;
    case "thailandStatus":
      return event.thailandStatus;
    case "contributionType":
      return event.contributionType;
    case "verificationStatus":
      return event.verificationStatus;
    case "perspectiveTheme":
      return event.perspectiveTheme;
    case "stance":
      return event.stance;
    case "sentiment":
      return event.sentiment;
    case "submissionType":
      return event.submissionType;
    case "status":
      return event.status;
    case "visibility":
      return event.visibility;
    case "countryOfOrigin":
      return event.countryOfOrigin;
    case "ownerOrg":
      return event.ownerOrg;
    default:
      return "unknown";
  }
}

function topValues(events: CorpusAnalyticsEvent[], field: string, limit = 6) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const value = getFieldValue(event, field) || "unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

function toScatterPoint(event: CorpusAnalyticsEvent, dimension: DateDimension) {
  // Exclude year-only points and undated records from exact-date scatter plot under publication dimension
  if (dimension === "publication" && event.datePrecision !== "exact_date") {
    return {
      x: null,
      y: event.confidence,
      name: event.label,
      scope: event.scope,
      precision: event.datePrecision
    };
  }
  const rawDate = dimension === "ingestion" ? event.ingestionDate : event.eventDate;
  const date = rawDate ? new Date(rawDate) : null;
  return {
    x: date && !Number.isNaN(date.getTime()) ? date.getTime() : null,
    y: event.confidence,
    name: event.label,
    scope: event.scope,
    precision: dimension === "ingestion" ? "exact_date" : event.datePrecision
  };
}

export default function AnalyticsPlayground({ events, summary: corpusSummary }: AnalyticsPlaygroundProps) {
  const [scope, setScope] = useState<Scope>("sources");
  const [timeBucket, setTimeBucket] = useState<TimeBucket>("month");
  const [dateDimension, setDateDimension] = useState<DateDimension>("publication");
  const [seriesField, setSeriesField] = useState("relevanceStatus");
  const [rowField, setRowField] = useState("sourceType");
  const [columnField, setColumnField] = useState("relevanceStatus");
  const [showConfidence, setShowConfidence] = useState(true);

  const scopeEvents = useMemo(() => {
    if (scope === "all") return events;
    return events.filter((event) => event.scope === scope);
  }, [events, scope]);

  const availableFields = fieldCatalog[scope];

  // Keep selector state synchronized with available fields on scope change
  useEffect(() => {
    const fields = fieldCatalog[scope];
    if (fields && fields.length > 0) {
      if (!fields.some((f) => f.value === seriesField)) {
        setSeriesField(fields[0].value);
      }
      if (!fields.some((f) => f.value === rowField)) {
        setRowField(fields[0].value);
      }
      if (!fields.some((f) => f.value === columnField)) {
        setColumnField(fields[1]?.value || fields[0].value);
      }
    }
  }, [scope]);

  const trendSeriesField = availableFields.some((field) => field.value === seriesField)
    ? seriesField
    : availableFields[0]?.value || "eventType";
  const matrixRowField = availableFields.some((field) => field.value === rowField)
    ? rowField
    : availableFields[0]?.value || "eventType";
  const matrixColumnField = availableFields.some((field) => field.value === columnField)
    ? columnField
    : availableFields[1]?.value || matrixRowField;

  // Track non-temporal records (year-only and undated) for explicit disclosure
  const nonTemporalStats = useMemo(() => {
    return scopeEvents.reduce(
      (acc, event) => {
        const timeKey = formatTimeBucketKey(event, timeBucket, dateDimension);
        if (timeKey === "year_only") acc.yearOnly += 1;
        else if (timeKey === "undated") acc.undated += 1;
        return acc;
      },
      { yearOnly: 0, undated: 0 }
    );
  }, [scopeEvents, timeBucket, dateDimension]);

  const totalNonTemporal = nonTemporalStats.yearOnly + nonTemporalStats.undated;

  const trendTopValues = useMemo(() => topValues(scopeEvents, trendSeriesField), [scopeEvents, trendSeriesField]);
  const trendSeriesTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const event of scopeEvents) {
      const value = getFieldValue(event, trendSeriesField) || "unknown";
      totals.set(value, (totals.get(value) ?? 0) + 1);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [scopeEvents, trendSeriesField]);

  // Area chart timeline only plots chronological dates (excluding "year_only" and "undated")
  const isChronologicalKey = (key: string) => key !== "year_only" && key !== "undated";

  const trendRows = useMemo(() => {
    const byBucket = new Map<string, Record<string, number>>();

    for (const event of scopeEvents) {
      const timeKey = formatTimeBucketKey(event, timeBucket, dateDimension);
      if (!isChronologicalKey(timeKey)) continue; // Segregate non-date categories from time axis

      const seriesValue = getFieldValue(event, trendSeriesField) || "unknown";
      const normalizedSeries = trendTopValues.includes(seriesValue) ? seriesValue : remainderLabel;

      if (!byBucket.has(timeKey)) {
        byBucket.set(timeKey, {});
      }
      const bucket = byBucket.get(timeKey)!;
      bucket[normalizedSeries] = (bucket[normalizedSeries] ?? 0) + 1;
    }

    return [...byBucket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([timeKey, values]) => ({
        timeKey,
        ...values
      }));
  }, [scopeEvents, timeBucket, dateDimension, trendSeriesField, trendTopValues]);

  const trendKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of trendRows) {
      Object.keys(row).forEach((key) => {
        if (key !== "timeKey") keys.add(key);
      });
    }
    return [...keys];
  }, [trendRows]);

  const matrix = useMemo(() => {
    const rowLabels = topValues(scopeEvents, matrixRowField, 6);
    const colLabels = topValues(scopeEvents, matrixColumnField, 6);
    const counts = new Map<string, number>();

    for (const event of scopeEvents) {
      const rowValue = getFieldValue(event, matrixRowField) || "unknown";
      const colValue = getFieldValue(event, matrixColumnField) || "unknown";
      const rowKey = rowLabels.includes(rowValue) ? rowValue : remainderLabel;
      const colKey = colLabels.includes(colValue) ? colValue : remainderLabel;
      const key = `${rowKey}|||${colKey}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const normalizedRows = rowLabels.includes(remainderLabel) ? rowLabels : [...rowLabels, remainderLabel];
    const normalizedCols = colLabels.includes(remainderLabel) ? colLabels : [...colLabels, remainderLabel];

    const max = Math.max(1, ...counts.values());
    return {
      rowLabels: normalizedRows,
      colLabels: normalizedCols,
      counts,
      max
    };
  }, [scopeEvents, matrixRowField, matrixColumnField]);

  const confidenceSeries = useMemo(() => {
    return scopeEvents
      .filter((event) => typeof event.confidence === "number")
      .map((event) => ({
        ...toScatterPoint(event, dateDimension),
        y: event.confidence ?? 0
      }))
      .filter((point) => point.x !== null);
  }, [scopeEvents, dateDimension]);

  const summary = useMemo(() => {
    const withDates = scopeEvents.filter((event) => {
      const d = dateDimension === "ingestion" ? event.ingestionDate : event.eventDate;
      return d && !Number.isNaN(new Date(d).getTime());
    });
    const yearOnlyCount = scopeEvents.filter((e) => dateDimension === "publication" && e.datePrecision === "year_only").length;
    const missingDateCount = scopeEvents.length - withDates.length;

    const confidenceValues = scopeEvents
      .map((event) => event.confidence)
      .filter((value): value is number => typeof value === "number");

    const avgConfidence = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null;

    return {
      total: scopeEvents.length,
      dated: withDates.length,
      yearOnlyCount,
      missingDateCount,
      avgConfidence,
      topSeries: trendSeriesTotals[0]?.[0] || "No live records",
      topRow: [...matrix.rowLabels].sort((a, b) => {
        const totalA = matrix.colLabels.reduce((sum, col) => sum + (matrix.counts.get(`${a}|||${col}`) ?? 0), 0);
        const totalB = matrix.colLabels.reduce((sum, col) => sum + (matrix.counts.get(`${b}|||${col}`) ?? 0), 0);
        return totalB - totalA;
      })[0] || "No live records"
    };
  }, [matrix, scopeEvents, trendSeriesTotals, dateDimension]);

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <section className="panel motion-panel motion-pop">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <div>
            <div className="muted">Scope</div>
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} style={{ width: "100%" }}>
              {scopeOrder.map((value) => (
                <option key={value} value={value}>{scopeLabels[value]}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="muted">Date dimension</div>
            <select
              value={dateDimension}
              onChange={(e) => setDateDimension(e.target.value as DateDimension)}
              style={{ width: "100%" }}
            >
              <option value="publication">Publication / Event Date</option>
              <option value="ingestion">Ingestion / System Date</option>
            </select>
          </div>
          <div>
            <div className="muted">Time bucket</div>
            <select value={timeBucket} onChange={(e) => setTimeBucket(e.target.value as TimeBucket)} style={{ width: "100%" }}>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </div>
          <div>
            <div className="muted">Trend factor</div>
            <select value={trendSeriesField} onChange={(e) => setSeriesField(e.target.value)} style={{ width: "100%" }}>
              {availableFields.map((field) => (
                <option key={field.value} value={field.value}>{field.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="muted">Matrix row</div>
            <select value={matrixRowField} onChange={(e) => setRowField(e.target.value)} style={{ width: "100%" }}>
              {availableFields.map((field) => (
                <option key={field.value} value={field.value}>{field.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="muted">Matrix column</div>
            <select value={matrixColumnField} onChange={(e) => setColumnField(e.target.value)} style={{ width: "100%" }}>
              {availableFields.map((field) => (
                <option key={field.value} value={field.value}>{field.label}</option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", paddingTop: "20px" }}>
            <input type="checkbox" checked={showConfidence} onChange={(e) => setShowConfidence(e.target.checked)} />
            <span className="muted">Confidence lens</span>
          </label>
        </div>
      </section>

      <div className="grid">
        <div className="panel motion-panel motion-pop">
          <div className="muted">Analyzed in scope</div>
          <div className="stat">{summary.total}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "60ms" }}>
          <div className="muted">{dateDimension === "publication" ? "With publication date" : "With ingestion date"}</div>
          <div className="stat">{summary.dated}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "120ms" }}>
          <div className="muted">
            {dateDimension === "publication" ? "Year-only / Undated" : "System timestamps"}
          </div>
          <div className="stat">
            {dateDimension === "publication" ? `${summary.yearOnlyCount} yr / ${summary.missingDateCount} undated` : `${summary.dated} valid`}
          </div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "180ms" }}>
          <div className="muted">Average confidence</div>
          <div className="stat">{summary.avgConfidence === null ? "No live confidence" : summary.avgConfidence.toFixed(2)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 0.95fr)" }}>
        <section className="panel motion-panel motion-pop">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}>
            <div>
              <h2>Appearance Trend ({dateDimension === "publication" ? "Event Time" : "System Ingestion Time"})</h2>
              <div className="muted" style={{ fontSize: "12px" }}>
                {dateDimension === "publication"
                  ? "Publication and observation timeline. Year-only records are segregated in month view to prevent artificial January spikes."
                  : "Database entry timeline tracking import batches and ingestion operations across the atlas."}
              </div>
            </div>
            <div className="badge">{scopeLabels[scope]}</div>
          </div>

          <div style={{ width: "100%", height: 360, marginTop: "12px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendRows} margin={{ top: 10, right: 18, left: 0, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8ded8" />
                <XAxis dataKey="timeKey" stroke="#56645c" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} stroke="#56645c" tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: unknown) => [value as number, "Records"]}
                  labelFormatter={(label) => `Period: ${label}`}
                />
                <Legend />
                {trendKeys.map((series, index) => (
                  <Area
                    key={series}
                    type="monotone"
                    dataKey={series}
                    stackId="1"
                    stroke={palette[index % palette.length]}
                    fill={palette[index % palette.length]}
                    fillOpacity={0.18}
                    strokeWidth={2}
                    isAnimationActive
                    animationDuration={650}
                  />
                ))}
                {trendRows.some((row) => remainderLabel in row) && (
                  <Area
                    type="monotone"
                    dataKey={remainderLabel}
                    stackId="1"
                    stroke="#7a8a80"
                    fill="#7a8a80"
                    fillOpacity={0.12}
                    strokeWidth={2}
                    isAnimationActive
                    animationDuration={650}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {totalNonTemporal > 0 && (
            <div className="notice" style={{ marginTop: "10px", fontSize: "12px", background: "rgba(100, 116, 139, 0.06)", borderColor: "#cbd5e1" }}>
              <strong>Non-temporal Records ({totalNonTemporal.toLocaleString()}):</strong> {nonTemporalStats.yearOnly.toLocaleString()} year-only observation{nonTemporalStats.yearOnly === 1 ? "" : "s"} and {nonTemporalStats.undated.toLocaleString()} undated record{nonTemporalStats.undated === 1 ? "" : "s"} in this subset are segregated from the continuous chronological time axis to prevent distortion.
            </div>
          )}
          <div className="muted" style={{ fontSize: "11px", marginTop: "10px", fontStyle: "italic" }}>
            Note: Trend and sentiment metrics reflect the verified public corpus and do not imply generalized public polling or clinical health outcomes.
          </div>
        </section>

        <section className="panel motion-panel motion-pop">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}>
            <div>
              <h2>Confidence Lens</h2>
              <div className="muted" style={{ fontSize: "12px" }}>
                Confidence versus time for records with scoring signals.
              </div>
            </div>
            <div className="badge">{showConfidence ? "On" : "Off"}</div>
          </div>

          {showConfidence ? (
            <div style={{ width: "100%", height: 360, marginTop: "12px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 14, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d8ded8" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={["dataMin", "dataMax"]}
                    name="Time"
                    tickFormatter={(value) => new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short" })}
                    stroke="#56645c"
                  />
                  <YAxis type="number" dataKey="y" domain={[0, 1]} name="Confidence" stroke="#56645c" />
                  <ZAxis type="number" dataKey="y" range={[30, 120]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    formatter={(value: unknown) => Number(value).toFixed(2)}
                    labelFormatter={(_, payload) => {
                      const point = payload?.[0]?.payload;
                      if (!point?.x) return "Confidence";
                      const date = new Date(point.x);
                      if (point.precision === "year_only") {
                        return `${point.name} (${date.getUTCFullYear()} - Year Only)`;
                      }
                      return `${point.name} (${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })})`;
                    }}
                  />
                  <Scatter data={confidenceSeries} fill="#19523c" isAnimationActive animationDuration={500} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty" style={{ minHeight: "360px", display: "grid", placeItems: "center" }}>
              Toggle confidence lens to inspect scored records.
            </div>
          )}
        </section>
      </div>

      <section className="panel motion-panel motion-pop">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}>
          <div>
            <h2>Factor Matrix</h2>
            <div className="muted" style={{ fontSize: "12px" }}>
              Pair any two factors to surface combinations across the selected corpus slice.
            </div>
          </div>
          <div className="badge">{seriesLabel(matrixRowField)} × {seriesLabel(matrixColumnField)}</div>
        </div>

        <div style={{ overflowX: "auto", marginTop: "12px" }}>
          <table style={{ minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, zIndex: 1 }}>Row / Column</th>
                {matrix.colLabels.map((label) => (
                  <th key={label}>{seriesLabel(label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rowLabels.map((rowLabel) => (
                <tr key={rowLabel}>
                  <td style={{ position: "sticky", left: 0, background: "var(--surface)", fontWeight: 700 }}>
                    {seriesLabel(rowLabel)}
                  </td>
                  {matrix.colLabels.map((colLabel) => {
                    const count = matrix.counts.get(`${rowLabel}|||${colLabel}`) ?? 0;
                    const alpha = count > 0 ? Math.max(0.08, count / matrix.max) : 0;
                    return (
                      <td
                        key={`${rowLabel}-${colLabel}`}
                        style={{
                          background: count > 0 ? `rgba(25, 82, 60, ${alpha})` : "transparent",
                          textAlign: "center",
                          fontWeight: count > 0 ? 700 : 400
                        }}
                      >
                        {count || ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
