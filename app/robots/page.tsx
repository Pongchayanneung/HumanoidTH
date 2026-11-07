import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslation } from "@/lib/translations";
import { isEligiblePublicRobot } from "@/lib/public-projection";

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
};type SourceLike = {
  title: string;
  url: string;
  platform: string | null;
  rawMeta: unknown;
};

type RobotLike = {
  canonicalName: string;
  officialUrl: string | null;
  sourceMeta: unknown;
};

const imageMetaKeys = [
  "thumbnail",
  "thumbnailUrl",
  "thumbnail_url",
  "image",
  "imageUrl",
  "image_url",
  "banner",
  "bannerUrl",
  "banner_url",
  "ogImage",
  "og:image",
  "coverImage",
  "cover_image"
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getStringField(meta: unknown, keys: string[]) {
  const record = asRecord(meta);
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractYoutubeVideoId(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "") || null;
    if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).pop() || null;
  } catch {
    return null;
  }
  return null;
}

function getSourceImageUrl(url: string | null, meta: unknown) {
  const explicitImage = getStringField(meta, imageMetaKeys);
  if (explicitImage) return explicitImage;

  const videoId = getStringField(meta, ["videoId", "video_id"]) ?? extractYoutubeVideoId(url);
  if (videoId) return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;

  return null;
}

function findRobotSource(robot: RobotLike, sources: SourceLike[]) {
  const robotName = robot.canonicalName.toLowerCase();
  const officialUrl = robot.officialUrl?.toLowerCase() ?? null;
  const metaTitle = getStringField(robot.sourceMeta, ["title"])?.toLowerCase() ?? null;

  return sources.find((source) => {
    const raw = asRecord(source.rawMeta);
    const canonicalName = typeof raw?.canonicalName === "string" ? raw.canonicalName.toLowerCase() : null;
    const sourceUrl = source.url.toLowerCase();
    const sourceTitle = source.title.toLowerCase();

    return (
      (officialUrl && sourceUrl === officialUrl) ||
      (canonicalName && canonicalName === robotName) ||
      (metaTitle && sourceTitle === metaTitle) ||
      sourceTitle.includes(robotName)
    );
  }) ?? null;
}

function getRobotSourceImage(robot: RobotLike, sources: SourceLike[]) {
  const robotMetaImage = getSourceImageUrl(robot.officialUrl, robot.sourceMeta);
  if (robotMetaImage) return robotMetaImage;

  const source = findRobotSource(robot, sources);
  return getSourceImageUrl(source?.url ?? robot.officialUrl, source?.rawMeta ?? null);
}

export default async function RobotsPage() {
  const cookieStore = await cookies();
  const lang = (cookieStore.get("lang")?.value || "en") as "en" | "th";
  const t = getTranslation(lang);

  let robots: Array<{
    id: string;
    canonicalName: string;
    description: string | null;
    robotType: string;
    thailandStatus: string;
    manufacturer: string | null;
    developerOrg: string | null;
    primaryUseCase: string | null;
    officialUrl: string | null;
    sourceMeta: unknown;
  }> = [];
  let sources: SourceLike[] = [];
  let dbOffline = false;

  try {
    [robots, sources] = await Promise.all([
      prisma.robotModel.findMany({ orderBy: { canonicalName: "asc" }, take: ROBOT_LIST_LIMIT }),
      prisma.sourceRecord.findMany({
        orderBy: [{ relevanceConfidence: "desc" }, { updatedAt: "desc" }],
        select: { title: true, url: true, platform: true, rawMeta: true },
        take: 1000
      })
    ]);
    // Public projection (M3): Exclude placeholders and unverified foreign robots from public registry
    robots = robots.filter((r) => isEligiblePublicRobot(r.canonicalName));
  } catch (error) {
    console.error("Database query failed in robots page:", error);
    dbOffline = true;
    robots = [];
    sources = [];
  }

  return (
    <>
      <h1>{t.robotsTitle}</h1>
      <p className="muted" style={{ marginBottom: "18px" }}>{t.robotsDesc}</p>
      {dbOffline && (
        <div className="notice" style={{ marginBottom: 16 }}>
          {t.robotsUnavailable}
        </div>
      )}
      {!dbOffline && <p className="muted">{t.robotsLimitNote.replace("{limit}", String(ROBOT_LIST_LIMIT))}</p>}
      <div className="cards">
        {robots.map((robot) => {
          const bannerUrl = getRobotSourceImage(robot, sources);
          return (
            <article className="card" key={robot.id}>
              <div className="card-banner">
                {bannerUrl ? (
                  <img src={bannerUrl} alt={robot.canonicalName} loading="lazy" />
                ) : (
                  <div className="source-thumbnail-empty">No source thumbnail</div>
                )}
              </div>
              <h2>{robot.canonicalName}</h2>
              <p className="muted">{robot.description ?? "No description yet."}</p>
              <p><span className="badge">{robot.robotType}</span> <span className="badge">{robot.thailandStatus}</span></p>
              <p><strong>{robot.manufacturer ?? robot.developerOrg ?? "Unknown developer"}</strong><br />{robot.primaryUseCase ?? "Use case unclassified"}</p>
              {robot.officialUrl && <a href={robot.officialUrl} target="_blank" rel="noopener noreferrer" aria-label={`${t.sourceLink}: ${robot.canonicalName} (${t.opensInNewTab})`}>{t.sourceLink}</a>}
            </article>
          );
        })}
        {!dbOffline && !robots.length && <div className="empty">{t.robotsEmpty}</div>}
      </div>
    </>
  );
}
