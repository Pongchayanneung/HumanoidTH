import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { parseLanguage } from "@/lib/translations";
import Link from "next/link";
import {
  publicContributionWhere,
  publicRobotWhere,
  publicSourceRecordWhere,
  publicPerspectiveWhere
} from "@/lib/public-projection";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Robotics Ecosystem Dashboard",
  description: "Aggregate dashboard for Thailand humanoid robotics records, robot types, sources, contributions, perspective themes, and confidence levels.",
  alternates: { canonical: "/dashboard" }
};

type Count = { _count: { _all: number } };
type Group<Key extends string> = Count & Record<Key, string | null>;

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const lang = parseLanguage(cookieStore.get("lang")?.value);
  const thai = lang === "th";

  let data = {
    locations: [] as Group<"countryOfOrigin">[],
    robotTypes: [] as Group<"robotType">[],
    sourceTypes: [] as Group<"sourceType">[],
    embodimentLevels: [] as Group<"embodimentLevel">[],
    contributionTypes: [] as Group<"contributionType">[],
    themes: [] as Group<"perspectiveTheme">[],
    highConfidenceAnn: 0,
    medConfidenceAnn: 0,
    lowConfidenceAnn: 0,
    highConfidenceSrc: 0,
    medConfidenceSrc: 0,
    lowConfidenceSrc: 0,
    dbOffline: false
  };

  try {
    const [
      locations,
      robotTypes,
      sourceTypes,
      embodimentLevels,
      contributionTypes,
      themes,
      highConfidenceAnn,
      medConfidenceAnn,
      lowConfidenceAnn,
      highConfidenceSrc,
      medConfidenceSrc,
      lowConfidenceSrc
    ] = await Promise.all([
      prisma.robotModel.groupBy({ by: ["countryOfOrigin"], where: publicRobotWhere, _count: { _all: true } }),
      prisma.robotModel.groupBy({ by: ["robotType"], where: publicRobotWhere, _count: { _all: true } }),
      prisma.sourceRecord.groupBy({ by: ["sourceType"], where: publicSourceRecordWhere, _count: { _all: true } }),
      prisma.robotModel.groupBy({ by: ["embodimentLevel"], where: publicRobotWhere, _count: { _all: true } }),
      prisma.contribution.groupBy({ by: ["contributionType"], where: publicContributionWhere, _count: { _all: true } }),
      prisma.perspectiveAnnotation.groupBy({ by: ["perspectiveTheme"], where: publicPerspectiveWhere, _count: { _all: true } }),
      // Confidence buckets
      prisma.perspectiveAnnotation.count({ where: { ...publicPerspectiveWhere, confidence: { gte: 0.8 } } }),
      prisma.perspectiveAnnotation.count({ where: { ...publicPerspectiveWhere, confidence: { gte: 0.5, lt: 0.8 } } }),
      prisma.perspectiveAnnotation.count({ where: { ...publicPerspectiveWhere, confidence: { lt: 0.5 } } }),
      prisma.sourceRecord.count({ where: { ...publicSourceRecordWhere, relevanceConfidence: { gte: 0.8 } } }),
      prisma.sourceRecord.count({ where: { ...publicSourceRecordWhere, relevanceConfidence: { gte: 0.5, lt: 0.8 } } }),
      prisma.sourceRecord.count({ where: { ...publicSourceRecordWhere, relevanceConfidence: { lt: 0.5 } } })
    ]);

    data = {
      locations,
      robotTypes,
      sourceTypes,
      embodimentLevels,
      contributionTypes,
      themes,
      highConfidenceAnn,
      medConfidenceAnn,
      lowConfidenceAnn,
      highConfidenceSrc,
      medConfidenceSrc,
      lowConfidenceSrc,
      dbOffline: false
    };
  } catch (error) {
    console.error("Database connection failed in dashboard:", error);
    data = {
      locations: [],
      robotTypes: [],
      sourceTypes: [],
      embodimentLevels: [],
      contributionTypes: [],
      themes: [],
      highConfidenceAnn: 0,
      medConfidenceAnn: 0,
      lowConfidenceAnn: 0,
      highConfidenceSrc: 0,
      medConfidenceSrc: 0,
      lowConfidenceSrc: 0,
      dbOffline: true
    };
  }
  const chart = <Key extends string,>(en: string, th: string, values: Group<Key>[], key: Key) => ({
    title: thai ? th : en,
    rows: values.map(value => ({
      label: (value[key] ?? (thai ? "ไม่ระบุ" : "Unlisted")).replaceAll("_", " "),
      count: value._count._all
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  });
  const confidence = (en: string, th: string, counts: number[]) => ({
    title: thai ? th : en,
    rows: counts.map((count, index) => ({ label: ["≥ 0.8", "0.5–0.79", "< 0.5"][index], count }))
  });
  const coverage = [
    chart("Robot origin", "ประเทศต้นกำเนิดหุ่นยนต์", data.locations, "countryOfOrigin"),
    chart("Robot categories", "ประเภทหุ่นยนต์", data.robotTypes, "robotType"),
    chart("Source types", "ประเภทแหล่งข้อมูล", data.sourceTypes, "sourceType"),
    chart("Embodiment levels", "รูปแบบกายภาพ", data.embodimentLevels, "embodimentLevel"),
    chart("Contribution types", "ประเภทผลงาน", data.contributionTypes, "contributionType"),
    chart("Perspective themes", "หัวข้อมุมมอง", data.themes, "perspectiveTheme"),
    confidence("Perspective confidence", "ความเชื่อมั่นของมุมมอง", [data.highConfidenceAnn, data.medConfidenceAnn, data.lowConfidenceAnn]),
    confidence("Source confidence", "ความเชื่อมั่นของแหล่งข้อมูล", [data.highConfidenceSrc, data.medConfidenceSrc, data.lowConfidenceSrc])
  ];
  return (
    <div className="atlas-workspace">
      <h1>{thai ? "แดชบอร์ดภาพรวมข้อมูล" : "Atlas coverage dashboard"}</h1>
      <p className="muted">{thai ? "Atlas มีข้อมูลสาธารณะประเภทใดบ้าง?" : "What public records does the Atlas cover?"}</p>
      {data.dbOffline ? <p className="notice" role="alert">{thai ? "ขณะนี้ไม่สามารถโหลดภาพรวมข้อมูลได้" : "Live dashboard data is unavailable."}</p> :
        <div className="atlas-coverage-grid">
          {coverage.map(({ title, rows }) => {
            const total = rows.reduce((sum, row) => sum + row.count, 0);
            return (
              <section className="atlas-chart" key={title}>
                <h2>{title}</h2>
                {total ? <table>
                  <caption>{thai ? "จำนวนระเบียนสาธารณะ" : "Public record counts"}</caption>
                  <thead><tr><th scope="col">{thai ? "หมวดหมู่" : "Category"}</th><th scope="col">{thai ? "จำนวน" : "Count"}</th></tr></thead>
                  <tbody>{rows.map(row => (
                    <tr key={row.label}><th scope="row">
                      {row.label}<span className="atlas-bar-track" aria-hidden="true"><span style={{ width: `${row.count / total * 100}%` }} /></span>
                    </th><td>{row.count.toLocaleString(lang)}</td></tr>
                  ))}</tbody>
                </table> : <p className="muted">{thai ? "ยังไม่มีข้อมูลในหมวดหมู่นี้" : "No records in this category."}</p>}
              </section>
            );
          })}
        </div>}
      <p><Link className="atlas-text-link" href="/analytics">{thai ? "ดูการเปลี่ยนแปลงตามเวลา" : "Explore changes over time"}</Link></p>
    </div>
  );
}
