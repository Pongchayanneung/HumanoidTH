import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslation, parseLanguage } from "@/lib/translations";
import { isEligiblePublicRobot, publicRobotWhere } from "@/lib/public-projection";
import Link from "next/link";
import { dinsawSourceForRobot } from "@/lib/atlas-evidence";
import { safeSourceUrl } from "@/app/search/searchClient";

export const dynamic = "force-dynamic";

const ROBOT_LIST_LIMIT = 200;

export const metadata: Metadata = {
  title: "Robot Model Registry | Thailand Humanoid Atlas",
  description: "Comprehensive catalog of humanoid, social, and service robot models deployed, researched, or active in Thailand. Track specifications, developers, and source links.",
  alternates: { canonical: "/robots" },
  openGraph: {
    title: "Robot Model Registry | Thailand Humanoid Atlas",
    description: "Comprehensive catalog of humanoid, social, and service robot models deployed, researched, or active in Thailand. Track specifications, developers, and source links.",
    url: "/robots",
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
    title: "Robot Model Registry | Thailand Humanoid Atlas",
    description: "Comprehensive catalog of humanoid, social, and service robot models deployed, researched, or active in Thailand. Track specifications, developers, and source links.",
    images: ["/logo.png"]
  }
};

type SearchParams = Promise<{ robot?: string | string[] }>;

export default async function RobotsPage({ searchParams }: { searchParams: SearchParams }) {
  const { robot } = await searchParams;
  const lang = parseLanguage((await cookies()).get("lang")?.value);
  const t = getTranslation(lang);
  const thai = lang === "th";
  const selected = robot !== undefined;
  const id = typeof robot === "string" && robot.trim() === robot && robot.length > 0 && robot.length <= 200 ? robot : null;

  const loadRobots = async () => {
    if (selected && !id) return { robots: [], evidence: null };
    const robots = (await prisma.robotModel.findMany({
      where: { ...publicRobotWhere, ...(id ? { id } : {}) },
      orderBy: { canonicalName: "asc" },
      take: selected ? 1 : ROBOT_LIST_LIMIT,
      select: {
        id: true, canonicalName: true, developerOrg: true, manufacturer: true, primaryUseCase: true,
        robotType: true, thailandStatus: true, officialUrl: true
      }
    })).filter(row => isEligiblePublicRobot(row.canonicalName));
    const evidence = selected && robots[0] ? await dinsawSourceForRobot(robots[0].canonicalName) : null;
    return { robots, evidence };
  };
  const result = await loadRobots().catch(error => {
    console.error("Public robot registry unavailable:", error);
    return null;
  });

  return (
    <div className="atlas-workspace">
      {selected && <Link className="atlas-text-link" href="/robots">{thai ? "กลับไปยังทะเบียนหุ่นยนต์" : "Back to robot registry"}</Link>}
      <h1>{selected && result?.robots[0] ? result.robots[0].canonicalName : t.robotsTitle}</h1>
      {!selected && <p className="muted">{t.robotsDesc}</p>}
      {!result && <p className="notice" role="alert">{t.robotsUnavailable}</p>}
      {result && !result.robots.length && (
        <p className="notice">{selected ? (thai ? "ไม่พบระเบียนหุ่นยนต์สาธารณะ" : "No public robot record was found.") : t.robotsEmpty}</p>
      )}
      {result && !selected && <p className="muted">{t.robotsLimitNote.replace("{limit}", String(ROBOT_LIST_LIMIT))}</p>}
      {result?.robots.map(row => {
        const official = safeSourceUrl(row.officialUrl);
        return (
          <article className="atlas-record" key={row.id}>
            <div>
              {!selected && <h2><Link href={{ pathname: "/robots", query: { robot: row.id } }}>{row.canonicalName}</Link></h2>}
              <dl>
                <dt>{thai ? "ผู้พัฒนา" : "Developer"}</dt>
                <dd>{row.developerOrg ?? row.manufacturer ?? (thai ? "ไม่ระบุ" : "Unlisted")}</dd>
                <dt>{thai ? "การใช้งาน" : "Intended use"}</dt>
                <dd>{row.primaryUseCase ?? (thai ? "ไม่ระบุ" : "Unlisted")}</dd>
                <dt>{thai ? "ประเภท" : "Type"}</dt>
                <dd>{row.robotType.replaceAll("_", " ")}</dd>
                <dt>{thai ? "สถานะในประเทศไทย" : "Thailand status"}</dt>
                <dd>{row.thailandStatus.replaceAll("_", " ")}</dd>
              </dl>
            </div>
            {selected && (
              <div>
                <h2>{thai ? "หลักฐานและแหล่งข้อมูล" : "Evidence and sources"}</h2>
                {result.evidence ? (
                  <p><a href={result.evidence.url} target="_blank" rel="noopener noreferrer">{result.evidence.title} ({t.opensInNewTab})</a></p>
                ) : <p className="muted">{thai ? "ระเบียนนี้ยังไม่มีแหล่งอ้างอิงที่ตรวจสอบแล้ว" : "No verified supporting source is attached to this record."}</p>}
                {official && official !== result.evidence?.url && <a href={official} target="_blank" rel="noopener noreferrer">{thai ? "เว็บไซต์ทางการ" : "Official site"} ({t.opensInNewTab})</a>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
