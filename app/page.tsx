import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import RobotViewer from "./components/RobotViewer";
import CopyCommands from "./components/CopyCommands";
import { getTranslation, parseLanguage } from "@/lib/translations";
import { getOperatorPrincipal, pendingReviewsFor, type SessionResult } from "@/lib/operator";
import {
  Bot,
  Box,
  ClipboardList,
  Database,
  Facebook,
  FolderOpen,
  Github,
  Globe,
  Play,
  Send,
  Users,
  Youtube
} from "lucide-react";

export const metadata: Metadata = {
  title: "Thailand Humanoid Atlas | Embodied AI & Robotics Database",
  description: "Explore Thailand's humanoid, social, and service robotics ecosystem. Trace robot models, research contributions, public perspectives, physical inventories, and AI-powered ecosystem maps.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Thailand Humanoid Atlas | Embodied AI & Robotics Database",
    description: "Explore Thailand's humanoid, social, and service robotics ecosystem. Trace robot models, research contributions, public perspectives, physical inventories, and AI-powered ecosystem maps.",
    url: "/",
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
    title: "Thailand Humanoid Atlas | Embodied AI & Robotics Database",
    description: "Explore Thailand's humanoid, social, and service robotics ecosystem. Trace robot models, research contributions, public perspectives, physical inventories, and AI-powered ecosystem maps.",
    images: ["/logo.png"]
  }
};


export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  let lang: "en" | "th" = "en";
  let session: SessionResult = { ok: false, code: "UNAUTHENTICATED" };
  try {
    const cookieStore = await cookies();
    lang = parseLanguage(cookieStore.get("lang")?.value);
    const operatorResult = await getOperatorPrincipal();
    session = operatorResult;
  } catch {
    // Outside request context
  }
  const t = getTranslation(lang);

  let sourcesCount: number | null = null;
  let acceptedCount: number | null = null;
  let robotsCount: number | null = null;
  let contributionsCount: number | null = null;
  let inventoryCount: number | null = null;
  let pendingReviewsCount: number | null = null;
  let platforms: any[] = [];
  let yearRangeStr = "No date data";
  let latestPipelineRun: any = null;
  let dbOffline = false;

  try {
    const [
      sCount,
      aCount,
      rCount,
      cCount,
      iCount,
      prCount,
      plts,
      dateRange,
      pipelineRun
    ] = await Promise.all([
      prisma.sourceRecord.count(),
      prisma.sourceRecord.count({ where: { relevanceStatus: "ACCEPTED" } }),
      prisma.robotModel.count(),
      prisma.contribution.count({
        where: {
          visibility: "public",
          verificationStatus: "APPROVED",
          NOT: { sourceUrl: { contains: "placeholder" } }
        }
      }),
      prisma.ownedInventory.count({ where: { visibility: "public" } }),
      pendingReviewsFor(session, () =>
        prisma.submittedData.count({ where: { status: { in: ["QUEUED", "NEEDS_REVIEW"] } } })
      ),
      prisma.sourceRecord.groupBy({ by: ["platform"], _count: { _all: true } }),
      prisma.sourceRecord.aggregate({ _min: { publishedAt: true }, _max: { publishedAt: true } }),
      prisma.pipelineRun.findFirst({ orderBy: { startedAt: "desc" } })
    ]);

    sourcesCount = sCount;
    acceptedCount = aCount;
    robotsCount = rCount;
    contributionsCount = cCount;
    inventoryCount = iCount;
    pendingReviewsCount = prCount;
    
    if (plts && plts.length > 0) {
      platforms = [...plts]
        .sort((a, b) => (b._count?._all ?? 0) - (a._count?._all ?? 0))
        .slice(0, 9);
    }
    
    if (pipelineRun) {
      latestPipelineRun = pipelineRun;
    }

    const minYear = dateRange._min.publishedAt ? dateRange._min.publishedAt.getFullYear() : "N/A";
    const maxYear = dateRange._max.publishedAt ? dateRange._max.publishedAt.getFullYear() : "N/A";
    yearRangeStr = minYear !== "N/A" || maxYear !== "N/A" ? `${minYear} – ${maxYear}` : "No date data";
  } catch (error) {
    console.error("Database connection failed in overview page:", error);
    dbOffline = true;
  }

  // Format date for Pipeline status card
  let lastUpdatedStr = lang === "th" ? "ล่าสุด: ไม่มีข้อมูล" : "Last: N/A";
  if (latestPipelineRun?.finishedAt) {
    const finishedDate = new Date(latestPipelineRun.finishedAt);
    lastUpdatedStr = `${lang === "th" ? "ล่าสุด" : "Last"}: ${finishedDate.getMonth() + 1}/${finishedDate.getDate()}/${finishedDate.getFullYear()}`;
  }

  const cliCommands = [
    "python -m humanoid_atlas db init",
    "python -m humanoid_atlas ingest seeds --file data/seeds/robot_models.seed.yml",
    "python -m humanoid_atlas ingest seeds --file data/seeds/inventory.seed.yml"
  ];

  const formatMetric = (value: number | null) => value?.toLocaleString() ?? "Unavailable";

  return (
    <main className="atlas-page">
      <style dangerouslySetInnerHTML={{ __html: `
        .atlas-page {
          display: grid;
          grid-template-areas:
            "header header"
            "stack robot"
            "terminal terminal";
          grid-template-columns: minmax(560px, 0.98fr) minmax(420px, 1.02fr);
          column-gap: 34px;
          row-gap: 18px;
          width: 100%;
          position: relative;
          z-index: 10;
          font-family: var(--font-sans);
          min-height: calc(100vh - 44px);
        }

        .mobile-only {
          display: none;
        }
        .desktop-only {
          display: inline;
        }

        .topbar {
          grid-area: header;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
          border-bottom: 1px solid var(--border);
          padding-bottom: 19px;
        }

        .topbar h1 {
          font-family: var(--font-sans);
          font-size: clamp(32px, 2.6vw, 42px);
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: 0;
          line-height: 0.98;
          margin: 6px 0 0;
          color: #07150f;
        }

        .topbar h1 span {
          color: var(--warning);
          font-weight: 800;
        }

        .eyebrow {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: var(--warning);
          font-weight: 750;
          margin: 0;
        }

        .subtitle {
          font-size: 13px;
          color: #17221d;
          margin: 9px 0 0 0;
          max-width: 600px;
          line-height: 1.5;
        }

        .topbar .actions {
          display: flex;
          gap: 9px;
          flex-wrap: wrap;
          justify-content: flex-end;
          padding-top: 0;
        }

        .topbar .actions .button {
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 42px;
          border-radius: 7px;
          border-color: rgba(177, 143, 47, 0.35);
          color: #08150f;
          box-shadow: 0 8px 18px rgba(112, 92, 48, 0.07);
          transition: all 0.2s ease;
        }

        .topbar .actions .button.primary {
          color: #ffffff;
        }

        .topbar .actions .button:hover {
          transform: translateY(-1px);
        }

        .topbar .actions .button > span:first-of-type {
          display: none;
        }

        .dashboard-stack {
          grid-area: stack;
          display: flex;
          flex-direction: column;
          gap: 14px;
          max-width: 760px;
        }

        /* Alert styling */
        .alert {
          background: rgba(156, 46, 38, 0.08);
          border: 1px solid rgba(156, 46, 38, 0.2);
          border-left: 4px solid var(--danger);
          border-radius: 8px;
          padding: 12px 16px;
          font-size: 13px;
          color: #7f221c;
          line-height: 1.5;
        }

        /* Metrics grid */
        .metrics-row {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }

        .metric-card {
          background: var(--surface);
          border: 1px solid rgba(74, 124, 89, 0.22);
          border-radius: 10px;
          min-height: 98px;
          padding: 18px 17px;
          display: flex;
          gap: 14px;
          align-items: flex-start;
          box-shadow: 0 10px 24px rgba(31, 37, 33, 0.1);
          transition: all 0.2s ease;
        }

        .metric-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(74, 124, 89, 0.08);
          border-color: var(--accent);
        }

        .metric-icon {
          font-size: 18px;
          color: #ffffff;
          background: #12a879;
          width: 38px;
          height: 38px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .metric-card p {
          margin: 0;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0;
          color: #07150f;
          font-weight: 850;
        }

        .metric-card strong {
          display: block;
          font-size: 29px;
          font-weight: 950;
          color: #07150f;
          margin-top: 4px;
          line-height: 1.1;
        }

        .metric-card small {
          display: block;
          font-size: 11px;
          color: var(--text-secondary);
          margin-top: 4px;
        }

        /* Status row: Glassmorphism cards */
        .status-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        .glass-card {
          background: rgba(255, 255, 255, 0.72);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(74, 124, 89, 0.12);
          border-radius: 10px;
          padding: 17px;
          box-shadow: 0 10px 22px rgba(31, 37, 33, 0.07);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 120px;
        }

        .card-label {
          margin: 0 0 10px 0;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary);
          font-weight: 600;
        }

        .success-pill {
          background: rgba(40, 116, 75, 0.1);
          border: 1px solid rgba(40, 116, 75, 0.25);
          color: var(--success);
          font-size: 12px;
          font-weight: 700;
          padding: 6px 13px;
          border-radius: 20px;
          align-self: flex-start;
          letter-spacing: 0.2px;
        }

        .glass-card h3 {
          margin: 0;
          font-size: 25px;
          font-weight: 950;
          color: #07150f;
        }

        .glass-card small {
          font-size: 11px;
          color: var(--text-secondary);
          margin-top: 8px;
          display: block;
        }

        /* Platform Ingestion Card */
        .platform-card {
          background: var(--surface);
          border: 1px solid rgba(74, 124, 89, 0.18);
          border-radius: 10px;
          padding: 20px 20px 18px;
          box-shadow: 0 9px 22px rgba(31, 37, 33, 0.06);
        }

        .platform-card h3 {
          margin: 0 0 16px 0;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-primary);
          font-weight: 800;
        }

        .platform-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 11px;
        }

        .platform-item {
          background: linear-gradient(180deg, rgba(255,255,255,0.75), rgba(244,240,232,0.78));
          border: 1px solid rgba(74, 124, 89, 0.23);
          border-bottom-color: rgba(74, 124, 89, 0.42);
          border-radius: 7px;
          min-height: 56px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          position: relative;
          overflow: hidden;
        }

        .platform-item span {
          width: 31px;
          height: 31px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 14px;
          color: white;
          flex-shrink: 0;
        }

        .platform-item.facebook span { background: #1877F2; }
        .platform-item.youtube span { background: #FF0000; }
        .platform-item.github span { background: #0b0b0f; }
        .platform-item.website span { background: #10B981; }

        .platform-item p {
          margin: 0;
          font-size: 10px;
          color: #07150f;
          text-transform: capitalize;
          font-weight: 650;
        }

        .platform-item strong {
          font-size: 19px;
          font-weight: 950;
          color: #07150f;
        }

        .platform-item .sparkline {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 3px;
          background: var(--accent);
          opacity: 0.4;
        }

        /* Robot stage */
        .robot-stage {
          grid-area: robot;
          background: transparent;
          border: none;
          border-radius: 0;
          height: min(74vh, 760px);
          min-height: 620px;
          position: relative;
          overflow: visible;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 0;
          margin-top: 12px;
          box-shadow: none;
        }

        .robot-glow {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 760px;
          height: 760px;
          background: radial-gradient(circle, rgba(16, 185, 129, 0.17) 0%, rgba(16, 185, 129, 0.05) 38%, transparent 72%);
          pointer-events: none;
          z-index: 1;
        }

        .orbit {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
          top: 50%;
          left: 50%;
          z-index: 1;
        }

        .orbit-one {
          width: 700px;
          height: 410px;
          border: 2px solid rgba(16, 185, 129, 0.36);
          margin-top: -172px;
          margin-left: -350px;
          transform: rotateX(72deg) rotateY(15deg);
          animation: spinRing 24s linear infinite;
        }

        .orbit-two {
          width: 820px;
          height: 500px;
          border: 1px solid rgba(16, 185, 129, 0.22);
          margin-top: -210px;
          margin-left: -410px;
          transform: rotateX(75deg) rotateY(-15deg);
          animation: spinRingInverse 29s linear infinite;
        }

        .orbit::after {
          content: "";
          position: absolute;
          right: 9%;
          top: 49%;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #99f6d4;
          box-shadow: 0 0 18px #38e4a9, 0 0 34px rgba(56, 228, 169, 0.5);
        }

        .robot-model-wrapper {
          width: min(860px, 120%);
          height: 120%;
          position: relative;
          z-index: 2;
          overflow: hidden;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          transform: translateY(-46px) scale(1.12);
          transform-origin: center top;
        }

        /* Terminal panel empty state */
        .terminal-panel {
          grid-area: terminal;
          background: #08130f;
          border: 1px solid #11261f;
          border-radius: 12px;
          padding: 22px;
          color: #eef7f2;
          margin-top: 2px;
        }

        .terminal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #14352a;
          padding-bottom: 12px;
          margin-bottom: 16px;
        }

        .terminal-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 800;
          color: var(--warning);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .terminal-panel p {
          margin: 0 0 16px 0;
          font-size: 13px;
          color: #a3c2b5;
          line-height: 1.5;
        }

        .command-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }

        .command-card {
          background: rgba(20, 53, 42, 0.3);
          border: 1px solid rgba(20, 53, 42, 0.6);
          border-radius: 8px;
          padding: 16px;
          position: relative;
          padding-top: 32px;
        }

        .command-card .step {
          position: absolute;
          top: 12px;
          left: 16px;
          background: var(--warning);
          color: #0b1a15;
          font-weight: 800;
          font-size: 10px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .command-card strong {
          display: block;
          font-size: 12.5px;
          color: #ffffff;
          margin-bottom: 8px;
        }

        .command-card code {
          display: block;
          background: #040a08;
          padding: 8px 10px;
          border-radius: 4px;
          color: #10B981;
          font-family: var(--font-sans);
          font-size: 11px;
          word-break: break-all;
          white-space: pre-wrap;
        }

        @keyframes spinRing {
          0% { transform: rotateX(72deg) rotateY(15deg) rotate(0deg); }
          100% { transform: rotateX(72deg) rotateY(15deg) rotate(360deg); }
        }

        @keyframes spinRingInverse {
          0% { transform: rotateX(75deg) rotateY(-15deg) rotate(360deg); }
          100% { transform: rotateX(75deg) rotateY(-15deg) rotate(0deg); }
        }

        @media (max-width: 860px) {
          .atlas-page {
            display: flex;
            flex-direction: column;
            gap: 24px;
          }
          .mobile-only {
            display: inline;
          }
          .desktop-only {
            display: none;
          }
          .topbar {
            display: block;
            border-bottom: none;
            padding-bottom: 0;
            margin-bottom: 0;
            gap: 4px;
          }
          .topbar h1 {
            font-size: 22px;
            font-weight: 800;
            letter-spacing: -0.5px;
            margin: 0;
            color: #2e3230;
          }
          .topbar .subtitle,
          .topbar .actions {
            display: none !important;
          }
          .robot-stage {
            height: 180px;
            min-height: 180px;
            background: var(--surface-muted);
            border: 1px solid var(--border);
            border-radius: 12px;
            overflow: hidden;
            position: relative;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 0;
            box-shadow: none;
          }
          .robot-stage .orbit,
          .robot-stage .robot-glow {
            display: none !important;
          }
          .robot-model-wrapper {
            width: 100%;
            height: 100%;
            transform: none;
          }
          .metrics-row {
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
          }
          .metric-card {
            padding: 12px 14px;
            gap: 10px;
            border-radius: 8px;
          }
          .metric-icon {
            width: 36px;
            height: 36px;
          }
          .metric-card strong {
            font-size: 20px;
          }
          .status-row {
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .glass-card {
            min-height: auto;
            padding: 14px 16px;
          }
          .platform-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
          }
          .platform-item {
            padding: 10px;
            gap: 8px;
          }
          .platform-item strong {
            font-size: 16px;
          }
          .command-grid {
            grid-template-columns: 1fr;
            gap: 12px;
          }
        }
      `}} />

      {/* 3D Immersive Robot Embodiment View */}
      <section className="robot-stage">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="robot-glow" />

        <div className="robot-model-wrapper">
          <RobotViewer />
        </div>
      </section>

      {/* Header Section */}
      <header className="topbar">
        <div>
          <p className="eyebrow">
            <span className="desktop-only">{lang === "th" ? "คอนโซลวิจัยระบบ" : "Research Console"}</span>
            <span className="mobile-only">{lang === "th" ? "คลังข้อมูลประเทศไทย" : "THAILAND ATLAS"}</span>
          </p>
          <h1>
            <span className="desktop-only">
              {lang === "th" ? "ภาพรวม" : "Overview"}{" "}
              <span>& {lang === "th" ? "สรุปคลังข้อมูล" : "Corpus Summary"}</span>
            </span>
            <span className="mobile-only">
              {lang === "th" ? "ภาพรวมและสรุปคลังข้อมูล" : "OVERVIEW & CORPUS SUMMARY"}
            </span>
          </h1>
          <p className="subtitle">{t.overviewDesc}</p>
        </div>

        <div className="actions">
          <Link className="button primary" href="/data-pulls">
            <Play size={14} fill="currentColor" />
            <span style={{ fontSize: "10px" }}>▶</span> {t.runDataPull}
          </Link>
          <Link className="button" href="/database">
            <FolderOpen size={15} color="#d19a1b" />
            <span>📂</span> {t.browseDatabase}
          </Link>
          <Link className="button" href="/submit-data">
            <Send size={15} color="#9a7bd8" />
            <span>📨</span> {t.submitRecord}
          </Link>
          <Link className="button" href="/admin">
            <ClipboardList size={15} color="#b17c56" />
            <span>📋</span> {t.reviewQueue}
            {session.ok && pendingReviewsCount !== null && (
              <span style={{ color: "var(--success)", fontWeight: "800", marginLeft: "4px" }}>
                ({pendingReviewsCount})
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* Main Dashboard stack */}
      <section className="dashboard-stack">
        {/* Database Offline warning alert container */}
        {dbOffline && (
          <div className="alert">
            <strong>Database Offline:</strong> Live PostgreSQL is unavailable. Overview metrics are not being substituted.
          </div>
        )}

        {/* Primary Metrics Row */}
        <div className="metrics-row">
          {/* Metric 1 */}
          <article className="metric-card">
            <div className="metric-icon">
              <Database size={18} />
            </div>
            <div>
              <p>{t.totalSources}</p>
              <strong>{formatMetric(sourcesCount)}</strong>
              <small>{lang === "th" ? `อนุมัติแล้ว: ${formatMetric(acceptedCount)}` : `Accepted: ${formatMetric(acceptedCount)}`}</small>
            </div>
          </article>

          {/* Metric 2 */}
          <article className="metric-card">
            <div className="metric-icon">
              <Bot size={18} />
            </div>
            <div>
              <p>{t.robotModels}</p>
              <strong>{formatMetric(robotsCount)}</strong>
              <small>{lang === "th" ? "รุ่นที่ลงทะเบียน" : "Registered models"}</small>
            </div>
          </article>

          {/* Metric 3 */}
          <article className="metric-card">
            <div className="metric-icon">
              <Box size={18} />
            </div>
            <div>
              <p>{t.ownedUnits}</p>
              <strong>{formatMetric(inventoryCount)}</strong>
              <small>{lang === "th" ? "คลังอุปกรณ์ของทีม" : "Team inventory"}</small>
            </div>
          </article>

          {/* Metric 4 */}
          <article className="metric-card">
            <div className="metric-icon">
              <Users size={18} />
            </div>
            <div>
              <p>{t.contributors}</p>
              <strong>{formatMetric(contributionsCount)}</strong>
              <small>{lang === "th" ? "คลังโค้ดและเอกสาร" : "Repos & papers"}</small>
            </div>
          </article>
        </div>

        {/* Secondary Status Row */}
        <div className="status-row">
          {/* Pipeline Status */}
          <div className="glass-card">
            <p className="card-label">{t.pipelineStatus}</p>
            {latestPipelineRun ? (
              <div className="success-pill">
                {latestPipelineRun.pipelineName}: {latestPipelineRun.status}
              </div>
            ) : (
              <div className="success-pill" style={{ background: "rgba(100, 116, 139, 0.1)", color: "#94a3b8", borderColor: "#475569" }}>
                No active runs
              </div>
            )}
            <small>{lastUpdatedStr}</small>
          </div>

          {/* Temporal Coverage */}
          <div className="glass-card">
            <p className="card-label">{t.temporalCoverage}</p>
            <h3>{yearRangeStr}</h3>
            <small>{t.activeMediaPubs}</small>
          </div>
        </div>

        {/* Sources by Ingestion Platform */}
        <div className="platform-card">
          <h3>{t.sourcesByPlatform}</h3>

          <div className="platform-grid">
            {platforms.map((p) => {
              const name = String(p.platform || "unknown").toLowerCase();
              let logoClass = "website";
              let IconComponent = Globe;

              if (name.includes("facebook")) {
                logoClass = "facebook";
                IconComponent = Facebook;
              } else if (name.includes("youtube")) {
                logoClass = "youtube";
                IconComponent = Youtube;
              } else if (name.includes("github")) {
                logoClass = "github";
                IconComponent = Github;
              }

              return (
                <div className={`platform-item ${logoClass}`} key={p.platform || "unknown"}>
                  <span>
                    <IconComponent size={16} />
                  </span>
                  <div>
                    <p style={{ textTransform: "capitalize" }}>{p.platform || "unknown"}</p>
                    <strong>{p._count?._all ?? p._count ?? 0}</strong>
                  </div>
                  <div className="sparkline" />
                </div>
              );
            })}
          </div>
        </div>


      </section>

      {/* Database Empty State Guide */}
      <section className="terminal-panel">
        <div className="terminal-header">
          <h3>{t.emptyStateTitle}</h3>
          <CopyCommands commands={cliCommands} />
        </div>

        <p>{t.emptyStateDesc}</p>

        <div className="command-grid">
          <div className="command-card">
            <div className="step">1</div>
            <strong>Initialize DB tables</strong>
            <code>python -m humanoid_atlas db init</code>
          </div>
          <div className="command-card">
            <div className="step">2</div>
            <strong>Seed robot models</strong>
            <code>python -m humanoid_atlas ingest seeds --file data/seeds/robot_models.seed.yml</code>
          </div>
          <div className="command-card">
            <div className="step">3</div>
            <strong>Seed inventory and relations</strong>
            <code>python -m humanoid_atlas ingest seeds --file data/seeds/inventory.seed.yml</code>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebSite",
                "@id": "https://humanoid.or.th/#website",
                "url": "https://humanoid.or.th/",
                "name": "Thailand Humanoid Atlas",
                "description": "Research database, registry, and analysis platform tracking the humanoid, social, and service robotics ecosystem in Thailand.",
                "publisher": {
                  "@id": "https://humanoid.or.th/#organization"
                }
              },
              {
                "@type": "Organization",
                "@id": "https://humanoid.or.th/#organization",
                "name": "Thailand Humanoid Atlas Project",
                "url": "https://humanoid.or.th/",
                "logo": "https://humanoid.or.th/logo.png"
              },
              {
                "@type": "WebApplication",
                "@id": "https://humanoid.or.th/#webapplication",
                "name": "Thailand Humanoid Atlas Platform",
                "url": "https://humanoid.or.th/",
                "applicationCategory": "ResearchApplication",
                "operatingSystem": "All",
                "description": "An interactive, open-source database cataloging humanoid robot models, academic contributions, public media sentiment, and physical inventory assets in Thailand."
              }
            ]
          })
        }}
      />
    </main>

  );
}
