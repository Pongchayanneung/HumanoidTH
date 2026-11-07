import React from "react";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslation } from "@/lib/translations";
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
    lang = (cookieStore.get("lang")?.value || "en") as "en" | "th";
  } catch {
    // Default to 'en' when rendered outside request store (e.g. unit tests)
  }
  const t = getTranslation(lang);

  // Validate and normalize filter inputs (M8-B)
  const validatedFilters = validateContributionFilters(params);
  const { type, org, robot, q, filterError } = validatedFilters;

  // Build filter conditions enforcing M3/M5 public projection
  const where = buildContributionWhere(validatedFilters);

  let dbItems: any[] = [];
  let dbRobots: any[] = [];
  let dbOrganizations: any[] = [];
  let queryFailed = false;

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
          where: {
            NOT: [
              { canonicalName: { contains: "placeholder", mode: "insensitive" } },
              { canonicalName: { contains: "pending", mode: "insensitive" } },
              { canonicalName: { contains: "unverified", mode: "insensitive" } }
            ]
          },
          select: { id: true, canonicalName: true }
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
          where: {
            NOT: [
              { canonicalName: { contains: "placeholder", mode: "insensitive" } },
              { canonicalName: { contains: "pending", mode: "insensitive" } },
              { canonicalName: { contains: "unverified", mode: "insensitive" } }
            ]
          },
          select: { id: true, canonicalName: true }
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

  return (
    <>
      <div className="topline">
        <div>
          <h1>{t.contributorsTitle}</h1>
          <p className="muted">{t.contributorsDesc}</p>
        </div>
      </div>

      {filterError && (
        <div
          role="alert"
          aria-live="polite"
          className="notice"
          style={{ backgroundColor: "#fdf2f2", borderLeftColor: "var(--danger)", color: "#b91c1c", marginBottom: 16 }}
        >
          <strong>Invalid Filter Parameter:</strong> {filterError}
        </div>
      )}

      {queryFailed && (
        <div
          role="alert"
          aria-live="polite"
          className="notice"
          style={{ backgroundColor: "#fef2f2", borderLeftColor: "var(--danger)", color: "#b91c1c", marginBottom: 16 }}
        >
          <strong>Database Query Failure:</strong> Unable to load contribution records. Please try again later.
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .filter-form {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) 100px;
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
          Type
          <select name="type" defaultValue={type || ""}>
            <option value="">All Types</option>
            {CONTRIBUTION_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {ct.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          Organization
          <select name="org" defaultValue={org || ""}>
            <option value="">All Organizations</option>
            {uniqueOrgs.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          Target Robot
          <select name="robot" defaultValue={robot || ""}>
            <option value="">All Robots</option>
            {robots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.canonicalName}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          Text Search
          <input name="q" defaultValue={q || ""} placeholder="e.g. SLAM, study" />
        </label>

        <button type="submit" className="primary submit-btn" style={{ minHeight: "36px" }}>
          Apply
        </button>
      </form>

      {/* Contributions Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title / Contributor</th>
              <th>Type</th>
              <th>Organization</th>
              <th>Target Model</th>
              <th>License</th>
              <th>Status</th>
              <th>Abstract / Description</th>
              <th>Last Updated</th>
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
                  {item.updatedAt.toLocaleDateString()}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td className="empty" colSpan={8}>
                  {queryFailed
                    ? "Unable to load contribution records. Please try again later."
                    : filterError
                    ? "No records shown due to invalid filter parameter."
                    : "No contribution records match the current filter criteria."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
