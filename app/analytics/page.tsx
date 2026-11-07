import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslation, parseLanguage } from "@/lib/translations";
import { PUBLIC_DATASET_SCOPE_LABEL } from "@/lib/public-projection";
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
};export default async function AnalyticsPage() {
  const cookieStore = await cookies();
  const lang = parseLanguage(cookieStore.get("lang")?.value);
  const t = getTranslation(lang);

  let events: Array<any> = [];
  let summary = {
    sourceCount: 0,
    robotCount: 0,
    contributionCount: 0,
    perspectiveCount: 0,
    submissionCount: 0,
    sourceConfidenceCount: 0
  };
  let dbOffline = false;

  try {
    const [
      sources,
      robots,
      contributions,
      perspectives
    ] = await Promise.all([
      prisma.sourceRecord.findMany({
        where: { relevanceStatus: "ACCEPTED" },
        select: {
          sourceType: true,
          relevanceStatus: true,
          platform: true,
          publishedAt: true,
          createdAt: true,
          relevanceConfidence: true,
          title: true
        },
        orderBy: { publishedAt: "desc" },
        take: 5000
      }),
      prisma.robotModel.findMany({
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
        take: 5000
      }),
      prisma.contribution.findMany({
        where: { visibility: "public", verificationStatus: "APPROVED" },
        select: {
          title: true,
          contributionType: true,
          verificationStatus: true,
          visibility: true,
          organization: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" },
        take: 5000
      }),
      prisma.perspectiveAnnotation.findMany({
        where: { source: { relevanceStatus: "ACCEPTED" } },
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
        take: 5000
      })
    ]);

    events = [
      ...sources.map((item) => ({
        scope: "sources",
        date: (item.publishedAt ?? item.createdAt).toISOString(),
        year: (item.publishedAt ?? item.createdAt).getFullYear(),
        monthKey: (item.publishedAt ?? item.createdAt).toISOString().slice(0, 7),
        label: item.title,
        confidence: item.relevanceConfidence,
        eventType: "source",
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
      })),
      ...robots.map((item) => {
        const date = item.firstSeenYear ? new Date(item.firstSeenYear, 0, 1) : item.createdAt;
        return {
          scope: "robots",
          date: date.toISOString(),
          year: date.getFullYear(),
          monthKey: date.toISOString().slice(0, 7),
          label: item.canonicalName,
          confidence: item.statusConfidence,
          eventType: "robot",
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
        };
      }),
      ...contributions.map((item) => ({
        scope: "contributions",
        date: item.createdAt.toISOString(),
        year: item.createdAt.getFullYear(),
        monthKey: item.createdAt.toISOString().slice(0, 7),
        label: item.title,
        confidence: null,
        eventType: "contribution",
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
      })),
      ...perspectives.map((item) => ({
        scope: "perspectives",
        date: item.createdAt.toISOString(),
        year: item.createdAt.getFullYear(),
        monthKey: item.createdAt.toISOString().slice(0, 7),
        label: item.perspectiveTheme,
        confidence: item.confidence,
        eventType: "perspective",
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
      }))
    ];

    summary = {
      sourceCount: sources.length,
      robotCount: robots.length,
      contributionCount: contributions.length,
      perspectiveCount: perspectives.length,
      submissionCount: 0,
      sourceConfidenceCount: sources.filter((item) => item.relevanceConfidence > 0).length
    };
  } catch (error) {
    console.error("Database query failed in analytics page:", error);
    dbOffline = true;
  }

  return (
    <>
      <h1>{t.analyticsTitle}</h1>
      <p className="muted" style={{ marginBottom: "18px" }}>{t.analyticsDesc}</p>
      <div className="notice" style={{ background: "rgba(59, 130, 246, 0.08)", borderColor: "var(--accent)", marginBottom: "16px" }}>
        <strong>Dataset Scope:</strong> {PUBLIC_DATASET_SCOPE_LABEL}. Analytics aggregate verified public records only. Pending submissions, private inventory, and unaccepted sources are strictly excluded.
      </div>
      {dbOffline && (
        <div className="notice" style={{ marginBottom: 16 }}>
          Live analytics are unavailable. This page needs PostgreSQL to build the analysis workspace.
        </div>
      )}
      <div className="grid" style={{ margin: "18px 0" }}>
        <div className="panel motion-panel motion-pop">
          <div className="muted">Internet Sources</div>
          <div className="stat">{summary.sourceCount}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "60ms" }}>
          <div className="muted">Robot Models</div>
          <div className="stat">{summary.robotCount}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "120ms" }}>
          <div className="muted">Contributions</div>
          <div className="stat">{summary.contributionCount}</div>
        </div>
        <div className="panel motion-panel motion-pop" style={{ animationDelay: "180ms" }}>
          <div className="muted">Scored Records</div>
          <div className="stat">{summary.sourceConfidenceCount}</div>
        </div>
      </div>

      <AnalyticsPlayground events={events} />
      <div style={{ marginTop: "16px" }}>
        <AnalyticsBpmn
          counts={{
            sources: summary.sourceCount,
            robots: summary.robotCount,
            contributions: summary.contributionCount,
            perspectives: summary.perspectiveCount,
            submissions: summary.submissionCount
          }}
        />
      </div>
    </>
  );
}
