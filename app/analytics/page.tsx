import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslation, parseLanguage } from "@/lib/translations";
import { PUBLIC_DATASET_SCOPE_LABEL } from "@/lib/public-projection";
import { loadWholeCorpusAnalytics } from "@/lib/analytics/corpus-analytics";
import AnalyticsPlayground from "./AnalyticsPlayground";
import AnalyticsBpmn from "./AnalyticsBpmn";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analytics & Stance Insights | Thailand Humanoid Atlas",
  description: "Statistical breakdown and charts tracking public sentiment, attention, and stance on embodied AI and robotics across Thailand.",
  alternates: { canonical: "/analytics" },
  openGraph: {
    title: "Analytics & Stance Insights | Thailand Humanoid Atlas",
    description: "Statistical breakdown and charts tracking public sentiment, attention, and stance on embodied AI and robotics across Thailand.",
    url: "/analytics",
    siteName: "Thailand Humanoid Atlas",
    images: [
      {
        url: "/logo.png",
        width: 512,
        height: 512,
        alt: "Thailand Humanoid Atlas Logo"
      }
    ],
    locale: "en_US",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Analytics & Stance Insights | Thailand Humanoid Atlas",
    description: "Statistical breakdown and charts tracking public sentiment, attention, and stance on embodied AI and robotics across Thailand.",
    images: ["/logo.png"]
  }
};

export default async function AnalyticsPage() {
  const cookieStore = await cookies();
  const lang = parseLanguage(cookieStore.get("lang")?.value);
  const t = getTranslation(lang);

  const { summary, events, dbOffline } = await loadWholeCorpusAnalytics();

  return (
    <>
      <h1>{t.analyticsTitle}</h1>
      <p className="muted" style={{ marginBottom: "18px" }}>{t.analyticsDesc}</p>
      
      <div className="notice" style={{ background: "rgba(59, 130, 246, 0.08)", borderColor: "var(--accent)", marginBottom: "16px" }}>
        <strong>Dataset Scope:</strong> {PUBLIC_DATASET_SCOPE_LABEL}. Analytics aggregate verified public records only. Pending submissions, private inventory, and unaccepted sources are strictly excluded.
      </div>

      {summary.isSampleTruncated && (
        <div className="notice" style={{ background: "rgba(245, 158, 11, 0.08)", borderColor: "#f59e0b", marginBottom: "16px" }}>
          <strong>Sampled Visualization Active:</strong> Charts plot a bounded sample of {summary.totalAnalyzedEvents.toLocaleString()} records ({summary.coveragePercent}% coverage of {summary.totalVerifiedPublicRecords.toLocaleString()} verified public records). Summary metric cards and BPMN pipeline lanes reflect the complete un-truncated corpus.
        </div>
      )}

      {dbOffline && (
        <div className="notice" style={{ marginBottom: 16 }}>
          Live analytics are unavailable. This page needs PostgreSQL to build the analysis workspace.
        </div>
      )}

      <div className="grid" style={{ margin: "18px 0" }}>
        <div className="panel motion-panel motion-pop">
          <div className="muted">Internet Sources</div>
          <div className="stat">{summary.totalEligibleSources}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "60ms" }}>
          <div className="muted">Robot Models</div>
          <div className="stat">{summary.totalEligibleRobots}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "120ms" }}>
          <div className="muted">Contributions</div>
          <div className="stat">{summary.totalEligibleContributions}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "180ms" }}>
          <div className="muted">Scored Records</div>
          <div className="stat">{summary.totalScoredSources}</div>
        </div>
      </div>

      <AnalyticsPlayground events={events} summary={summary} />

      <div style={{ marginTop: "16px" }}>
        <AnalyticsBpmn
          counts={{
            sources: summary.totalEligibleSources,
            robots: summary.totalEligibleRobots,
            contributions: summary.totalEligibleContributions,
            perspectives: summary.totalEligiblePerspectives,
            submissions: summary.totalEligibleSubmissions
          }}
        />
      </div>
    </>
  );
}
