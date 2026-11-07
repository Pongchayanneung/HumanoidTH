import React from "react";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslation, parseLanguage } from "@/lib/translations";
import { publicContributionWhere, isEligiblePublicRobot } from "@/lib/public-projection";
import {
  CONTRIBUTION_TYPES,
  validateContributionFilters,
  buildContributionWhere,
  type ContributionFilterInput
} from "@/lib/contribution-filters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Academic & Software Contributions | Thailand Humanoid Atlas",
  description: "Directory of open-source software, research publications, datasets, and hardware designs contributing to humanoid robotics in Thailand.",
  alternates: { canonical: "/contributions" },
  openGraph: {
    title: "Academic & Software Contributions | Thailand Humanoid Atlas",
    description: "Directory of open-source software, research publications, datasets, and hardware designs contributing to humanoid robotics in Thailand.",
    url: "/contributions",
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
    title: "Academic & Software Contributions | Thailand Humanoid Atlas",
    description: "Directory of open-source software, research publications, datasets, and hardware designs contributing to humanoid robotics in Thailand.",
    images: ["/logo.png"]
  }
};

type SearchParams = Promise<ContributionFilterInput>;

export default async function ContributionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  let lang: "en" | "th" = "en";
  try {
    const cookieStore = await cookies();
    lang = parseLanguage(cookieStore.get("lang")?.value);
  } catch {
    // Default to 'en' when rendered outside request store (e.g. unit tests)
  }
  const t = getTranslation(lang);

  // Validate and normalize filter inputs (M8-B)
  const validatedFilters = validateContributionFilters(params, lang);
  const { type, org, robot, q, filterError, statusNotice } = validatedFilters;

  // Build filter conditions enforcing M3/M5 public projection
  const where = buildContributionWhere(validatedFilters);

  let dbItems: any[] = [];
  let dbRobots: any[] = [];
  let dbOrganizations: any[] = [];
  let queryFailed = false;

  // Reusable query for robot models associated with public contributions
  const robotWhere = {
    contributions: {
      some: publicContributionWhere
    }
  };

  try {
    if (!filterError) {
      const [resItems, resRobots, resOrgs] = await Promise.all([
        prisma.contribution.findMany({
          where,
          include: { relatedRobotModel: true },
          orderBy: { updatedAt: "desc" },
          take: 200
        }),
        prisma.robotModel.findMany({
          where: robotWhere,
          select: { id: true, canonicalName: true },
          orderBy: { canonicalName: "asc" }
        }),
        prisma.contribution.findMany({
          select: { organization: true },
          distinct: ["organization"],
          where: {
            organization: { not: null },
            ...publicContributionWhere
          }
        })
      ]);
      dbItems = resItems;
      dbRobots = resRobots;
      dbOrganizations = resOrgs;
    } else {
      // For invalid filters, populate dropdowns from public data without querying invalid records
      const [resRobots, resOrgs] = await Promise.all([
        prisma.robotModel.findMany({
          where: robotWhere,
          select: { id: true, canonicalName: true },
          orderBy: { canonicalName: "asc" }
        }),
        prisma.contribution.findMany({
          select: { organization: true },
          distinct: ["organization"],
          where: {
            organization: { not: null },
            ...publicContributionWhere
          }
        })
      ]);
      dbRobots = resRobots;
      dbOrganizations = resOrgs;
    }
  } catch (error) {
    // Log detailed technical error only to server logs, never leak raw Prisma traces to public HTML
    console.error("Failed to query contributions in contributions page:", error);
    queryFailed = true;
  }

  const items = dbItems;
  const robots = dbRobots.filter((r) => isEligiblePublicRobot(r.canonicalName));
  const uniqueOrgs = dbOrganizations.map((o) => o.organization).filter(Boolean) as string[];

  const localT = {
    en: {
      statusNoticeTitle: "Status Notice",
      invalidFilterTitle: "Invalid Filter Parameter",
      dbFailureTitle: "Database Query Failure",
      dbFailureDesc: "Unable to load contribution records. Please try again later.",
      filterTypeLabel: "Type",
      filterOrgLabel: "Organization",
      filterRobotLabel: "Target Robot",
      filterSearchLabel: "Text Search",
      allTypes: "All Types",
      allOrgs: "All Organizations",
      allRobots: "All Robots",
      searchPlaceholder: "e.g. SLAM, study",
      applyBtn: "Apply Filters",
      emptyRecords: "No contribution records match the current filter criteria.",
      thTitle: "Title / Contributor",
      thType: "Type",
      thOrg: "Organization",
      thTargetModel: "Target Model",
      thLicense: "License",
      thStatus: "Status",
      thDescription: "Abstract / Description",
      thLastUpdated: "Last Updated"
    },
    th: {
      statusNoticeTitle: "การแจ้งเตือนสถานะ",
      invalidFilterTitle: "พารามิเตอร์ตัวกรองไม่ถูกต้อง",
      dbFailureTitle: "เกิดข้อผิดพลาดในการดึงข้อมูล",
      dbFailureDesc: "ไม่สามารถดึงข้อมูลรายการได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง",
      filterTypeLabel: "ประเภท",
      filterOrgLabel: "องค์กร",
      filterRobotLabel: "หุ่นยนต์เป้าหมาย",
      filterSearchLabel: "ค้นหาข้อความ",
      allTypes: "ทุกประเภทผลงาน",
      allOrgs: "ทุกองค์กร",
      allRobots: "ทุกหุ่นยนต์",
      searchPlaceholder: "ค้นหาผลงาน, ผู้จัดทำ...",
      applyBtn: "ค้นหา",
      emptyRecords: "ไม่พบข้อมูลผลงานหรือการมีส่วนร่วมที่ตรงกับเงื่อนไขการค้นหา",
      thTitle: "ชื่อผลงาน / ผู้จัดทำ",
      thType: "ประเภท",
      thOrg: "องค์กร",
      thTargetModel: "หุ่นยนต์เป้าหมาย",
      thLicense: "สัญญาอนุญาต",
      thStatus: "สถานะ",
      thDescription: "บทคัดย่อ / คำอธิบาย",
      thLastUpdated: "อัปเดตล่าสุด"
    }
  }[lang];

  return (
    <>
      <div className="topline">
        <div>
          <h1>{t.contributorsTitle}</h1>
          <p className="muted">{t.contributorsDesc}</p>
        </div>
      </div>

      {statusNotice && (
        <div
          role="status"
          aria-live="polite"
          className="notice"
          style={{ backgroundColor: "#eff6ff", borderLeftColor: "#3b82f6", color: "#1e40af", marginBottom: 16 }}
        >
          <strong>{localT.statusNoticeTitle}:</strong> {statusNotice}
        </div>
      )}

      {filterError && (
        <div
          role="alert"
          aria-live="polite"
          className="notice"
          style={{ backgroundColor: "#fdf2f2", borderLeftColor: "var(--danger)", color: "#b91c1c", marginBottom: 16 }}
        >
          <strong>{localT.invalidFilterTitle}:</strong> {filterError}
        </div>
      )}

      {queryFailed && (
        <div
          role="alert"
          aria-live="polite"
          className="notice"
          style={{ backgroundColor: "#fef2f2", borderLeftColor: "var(--danger)", color: "#b91c1c", marginBottom: 16 }}
        >
          <strong>{localT.dbFailureTitle}:</strong> {localT.dbFailureDesc}
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .filter-form {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) 120px;
          gap: 10px;
          align-items: end;
          margin-bottom: 16px;
        }
        @media (max-width: 860px) {
          .filter-form {
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          }
          .filter-form .submit-btn {
            grid-column: span 1;
            width: 100%;
          }
        }
        @media (max-width: 480px) {
          .filter-form {
            grid-template-columns: 1fr;
          }
        }
        .type-badge {
          border-radius: 4px !important;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 7px;
          background: rgba(74, 124, 89, 0.12) !important;
          color: var(--accent) !important;
          border: 1px solid rgba(74, 124, 89, 0.3) !important;
          text-transform: capitalize;
          display: inline-block;
        }
      `}} />

      {/* Filter Toolbar */}
      <form method="GET" className="panel filter-form">
        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {localT.filterTypeLabel}
          <select name="type" defaultValue={type || ""} style={{ minHeight: "44px" }}>
            <option value="">{localT.allTypes}</option>
            {CONTRIBUTION_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {ct.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {localT.filterOrgLabel}
          <select name="org" defaultValue={org || ""} style={{ minHeight: "44px" }}>
            <option value="">{localT.allOrgs}</option>
            {uniqueOrgs.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {localT.filterRobotLabel}
          <select name="robot" defaultValue={robot || ""} style={{ minHeight: "44px" }}>
            <option value="">{localT.allRobots}</option>
            {robots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.canonicalName}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {localT.filterSearchLabel}
          <input name="q" defaultValue={q || ""} placeholder={localT.searchPlaceholder} style={{ minHeight: "44px" }} />
        </label>

        <button type="submit" className="primary submit-btn" style={{ minHeight: "44px" }}>
          {localT.applyBtn}
        </button>
      </form>

      {/* Contributions Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{localT.thTitle}</th>
              <th>{localT.thType}</th>
              <th>{localT.thOrg}</th>
              <th>{localT.thTargetModel}</th>
              <th>{localT.thLicense}</th>
              <th>{localT.thStatus}</th>
              <th>{localT.thDescription}</th>
              <th>{localT.thLastUpdated}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                  <br />
                  <span className="muted" style={{ fontSize: "12px" }}>
                    By {item.contributorName}
                  </span>
                </td>
                <td>
                  <span className="badge type-badge">
                    {item.contributionType.replace(/_/g, " ")}
                  </span>
                </td>
                <td>{item.organization || "N/A"}</td>
                <td>{item.relatedRobotModel?.canonicalName || "General / None"}</td>
                <td>
                  <code>{item.license || "N/A"}</code>
                </td>
                <td>
                  <span className="badge ok">
                    {item.verificationStatus}
                  </span>
                </td>
                <td style={{ maxWidth: "300px", fontSize: "12px" }}>
                  <div>{item.description || "No description."}</div>
                  {item.sourceUrl && (
                    <div style={{ marginTop: "4px" }}>
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>
                        {item.sourceUrl}
                      </a>
                    </div>
                  )}
                </td>
                <td style={{ fontSize: "12px" }}>
                  {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "-"}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td className="empty" colSpan={8}>
                  {queryFailed
                    ? localT.dbFailureDesc
                    : filterError
                    ? localT.invalidFilterTitle
                    : localT.emptyRecords}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
