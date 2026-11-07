"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";

type Scope = "all" | "sources" | "robots" | "contributions" | "perspectives" | "submissions";
type TimeBucket = "month" | "year";

type AnalyticsEvent = {
  scope: Scope;
  date: string | null;
  year: number | null;
  monthKey: string | null;
  label: string;
  confidence: number | null;
  eventType: string;
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
};

interface AnalyticsPlaygroundProps {
  events: AnalyticsEvent[];
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

function normalizeDateKey(value: string | null, bucket: TimeBucket) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  if (bucket === "year") {
    return String(date.getFullYear());
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function getFieldValue(event: AnalyticsEvent, field: string) {
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

function topValues(events: AnalyticsEvent[], field: string, limit = 6) {
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

function toScatterPoint(event: AnalyticsEvent) {
  const date = event.date ? new Date(event.date) : null;
  return {
    x: date && !Number.isNaN(date.getTime()) ? date.getTime() : null,
    y: event.confidence,
    name: event.label,
    scope: event.scope
  };
}

export default function AnalyticsPlayground({ events, lang = "en" }: AnalyticsPlaygroundProps & { lang?: "en" | "th" }) {
  const thai = lang === "th";
  const [scope, setScope] = useState<Scope>("sources");
  const [timeBucket, setTimeBucket] = useState<TimeBucket>("month");
  const [seriesField, setSeriesField] = useState("relevanceStatus");
  const [rowField, setRowField] = useState("sourceType");
  const [columnField, setColumnField] = useState("relevanceStatus");
  const [showConfidence, setShowConfidence] = useState(true);

  const scopeEvents = useMemo(() => {
    if (scope === "all") return events;
    return events.filter((event) => event.scope === scope);
  }, [events, scope]);

  const availableFields = fieldCatalog[scope];

  const trendSeriesField = availableFields.some((field) => field.value === seriesField)
    ? seriesField
    : availableFields[0]?.value || "eventType";
  const matrixRowField = availableFields.some((field) => field.value === rowField)
    ? rowField
    : availableFields[0]?.value || "eventType";
  const matrixColumnField = availableFields.some((field) => field.value === columnField)
    ? columnField
    : availableFields[1]?.value || matrixRowField;

  const trendTopValues = useMemo(() => topValues(scopeEvents, trendSeriesField), [scopeEvents, trendSeriesField]);
  const trendSeriesTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const event of scopeEvents) {
      const value = getFieldValue(event, trendSeriesField) || "unknown";
      totals.set(value, (totals.get(value) ?? 0) + 1);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [scopeEvents, trendSeriesField]);

  const trendRows = useMemo(() => {
    const byBucket = new Map<string, Record<string, number>>();

    for (const event of scopeEvents) {
      const timeKey = normalizeDateKey(event.date, timeBucket);
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
  }, [scopeEvents, timeBucket, trendSeriesField, trendTopValues]);

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
        ...toScatterPoint(event),
        y: event.confidence ?? 0
      }))
      .filter((point) => point.x !== null);
  }, [scopeEvents]);

  const summary = useMemo(() => {
    const withDates = scopeEvents.filter((event) => event.date && !Number.isNaN(new Date(event.date).getTime()));
    const confidenceValues = scopeEvents.map((event) => event.confidence).filter((value): value is number => typeof value === "number");
    const avgConfidence = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null;

    return {
      total: scopeEvents.length,
      dated: withDates.length,
      avgConfidence,
      topSeries: trendSeriesTotals[0]?.[0] || "No live records",
      topRow: [...matrix.rowLabels].sort((a, b) => {
        const totalA = matrix.colLabels.reduce((sum, col) => sum + (matrix.counts.get(`${a}|||${col}`) ?? 0), 0);
        const totalB = matrix.colLabels.reduce((sum, col) => sum + (matrix.counts.get(`${b}|||${col}`) ?? 0), 0);
        return totalB - totalA;
      })[0] || "No live records"
    };
  }, [matrix, scopeEvents, trendSeriesTotals]);

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <section className="panel motion-panel motion-pop">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <div>
            <label className="muted" htmlFor="analytics-scope">{thai ? "ขอบเขต" : "Scope"}</label>
            <select id="analytics-scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)} style={{ width: "100%" }}>
              {scopeOrder.map((value) => (
                <option key={value} value={value}>{scopeLabels[value]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="analytics-period">{thai ? "ช่วงเวลา" : "Time bucket"}</label>
            <select id="analytics-period" value={timeBucket} onChange={(e) => setTimeBucket(e.target.value as TimeBucket)} style={{ width: "100%" }}>
              <option value="month">{thai ? "เดือน" : "Month"}</option>
              <option value="year">{thai ? "ปี" : "Year"}</option>
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="analytics-factor">{thai ? "จัดกลุ่มตาม" : "Trend factor"}</label>
            <select id="analytics-factor" value={trendSeriesField} onChange={(e) => setSeriesField(e.target.value)} style={{ width: "100%" }}>
              {availableFields.map((field) => (
                <option key={field.value} value={field.value}>{field.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="analytics-row">{thai ? "แถวในตารางเปรียบเทียบ" : "Matrix row"}</label>
            <select id="analytics-row" value={matrixRowField} onChange={(e) => setRowField(e.target.value)} style={{ width: "100%" }}>
              {availableFields.map((field) => (
                <option key={field.value} value={field.value}>{field.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="muted" htmlFor="analytics-column">{thai ? "คอลัมน์ในตารางเปรียบเทียบ" : "Matrix column"}</label>
            <select id="analytics-column" value={matrixColumnField} onChange={(e) => setColumnField(e.target.value)} style={{ width: "100%" }}>
              {availableFields.map((field) => (
                <option key={field.value} value={field.value}>{field.label}</option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", paddingTop: "20px" }}>
            <input type="checkbox" checked={showConfidence} onChange={(e) => setShowConfidence(e.target.checked)} />
            <span className="muted">{thai ? "แสดงคะแนนความเชื่อมั่น" : "Confidence lens"}</span>
          </label>
        </div>
      </section>

      <div className="grid">
        <div className="panel motion-panel motion-pop">
          <div className="muted">Records in scope</div>
          <div className="stat">{summary.total}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "60ms" }}>
          <div className="muted">With usable dates</div>
          <div className="stat">{summary.dated}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "120ms" }}>
          <div className="muted">Average confidence</div>
          <div className="stat">{summary.avgConfidence === null ? "No live confidence" : summary.avgConfidence.toFixed(2)}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "180ms" }}>
          <div className="muted">Top trend factor</div>
          <div className="stat" style={{ fontSize: "18px" }}>{seriesLabel(summary.topSeries)}</div>
        </div>
      </div>

      <div className="atlas-analytics-grid">
        <section className="panel motion-panel motion-pop">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}>
            <div>
              <h2>{thai ? "จำนวนระเบียนตามเวลา" : "Records over time"}</h2>
              <div className="muted" style={{ fontSize: "12px" }}>
                {thai ? "จำนวนระเบียนรายเดือนหรือรายปีตามขอบเขตที่เลือก" : "Monthly or yearly record counts in the selected scope."}
              </div>
            </div>
            <div className="badge">{scopeLabels[scope]}</div>
          </div>

          {trendRows.length ? <div style={{ width: "100%", height: 360, marginTop: "12px" }}>
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
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div> : <p className="muted">{thai ? "ไม่พบข้อมูลตามตัวกรอง" : "No records match the current filters."}</p>}
          {trendRows.length > 0 && <details>
            <summary>{thai ? "ดูข้อมูลในกราฟ" : "View chart data"}</summary>
            <div className="atlas-scroll-table" tabIndex={0} role="region" aria-label={thai ? "ตารางข้อมูลตามเวลา" : "Time series table"}><table>
              <caption>{thai ? "จำนวนระเบียนตามช่วงเวลา" : "Record counts by period"}</caption>
              <thead><tr><th scope="col">{thai ? "ช่วงเวลา" : "Period"}</th>{trendKeys.map(key => <th scope="col" key={key}>{seriesLabel(key)}</th>)}</tr></thead>
              <tbody>{trendRows.map(row => <tr key={row.timeKey}>
                <th scope="row">{row.timeKey}</th>
                {trendKeys.map(key => <td key={key}>{(row as Record<string, string | number>)[key] ?? 0}</td>)}
              </tr>)}</tbody>
            </table></div>
          </details>}
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
                      return new Date(point.x).toLocaleString();
                    }}
                  />
                  <Scatter data={confidenceSeries} fill="#19523c" isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty" style={{ minHeight: "360px", display: "grid", placeItems: "center" }}>
              Toggle confidence lens to inspect scored records.
            </div>
          )}
          {showConfidence && confidenceSeries.length > 0 && <details>
            <summary>{thai ? "ดูคะแนนความเชื่อมั่น" : "View confidence data"}</summary>
            <div className="atlas-scroll-table" tabIndex={0} role="region" aria-label={thai ? "ตารางคะแนนความเชื่อมั่น" : "Confidence table"}><table>
              <caption>{thai ? "คะแนนความเชื่อมั่นตามวัน" : "Confidence by date"}</caption>
              <thead><tr><th scope="col">{thai ? "วันที่" : "Date"}</th><th scope="col">{thai ? "คะแนน" : "Confidence"}</th></tr></thead>
              <tbody>{confidenceSeries.map((point, index) => <tr key={index}>
                <td>{new Date(point.x!).toLocaleDateString(lang, { timeZone: "UTC" })}</td><td>{point.y}</td>
              </tr>)}</tbody>
            </table></div>
          </details>}
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
                    const alpha = count > 0 ? Math.max(0.08, 0.3 * count / matrix.max) : 0;
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
