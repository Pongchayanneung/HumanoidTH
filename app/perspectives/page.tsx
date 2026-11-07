import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslation, parseLanguage } from "@/lib/translations";
import { publicPerspectiveWhere } from "@/lib/public-projection";
import { safeSourceUrl } from "@/app/search/searchClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public & Media Perspectives | Thailand Humanoid Atlas",
  description: "Analyze public opinion and media stance on humanoid robots in Thailand. Explore stance and sentiment analysis on safety, healthcare trust, and employment impact.",
  alternates: { canonical: "/perspectives" },
  openGraph: {
    title: "Public & Media Perspectives | Thailand Humanoid Atlas",
    description: "Analyze public opinion and media stance on humanoid robots in Thailand. Explore stance and sentiment analysis on safety, healthcare trust, and employment impact.",
    url: "/perspectives",
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
    title: "Public & Media Perspectives | Thailand Humanoid Atlas",
    description: "Analyze public opinion and media stance on humanoid robots in Thailand. Explore stance and sentiment analysis on safety, healthcare trust, and employment impact.",
    images: ["/logo.png"]
  }
};export default async function PerspectivesPage() {
  const cookieStore = await cookies();
  const lang = parseLanguage(cookieStore.get("lang")?.value);
  const t = getTranslation(lang);
  const thai = lang === "th";

  let items: Array<{
    id: string;
    perspectiveTheme: string;
    stance: string;
    sentiment: string;
    confidence: number;
    evidenceExcerpt: string;
    source: { title: string; url: string; platform: string | null };
  }> = [];
  let dbOffline = false;

  try {
    items = await prisma.perspectiveAnnotation.findMany({
      where: publicPerspectiveWhere,
      select: { id: true, perspectiveTheme: true, stance: true, sentiment: true, confidence: true, evidenceExcerpt: true,
        source: { select: { title: true, url: true, platform: true } } },
      orderBy: { createdAt: "desc" },
      take: 200
    });
  } catch (error) {
    console.error("Database query failed in perspectives page:", error);
    dbOffline = true;
    items = [];
  }

  return (
    <div className="atlas-workspace">
      <h1>{t.perspectivesTitle}</h1>
      <p className="muted">{t.perspectivesDesc}</p>
      {dbOffline ? <p className="notice" role="alert">{thai ? "ขณะนี้ไม่สามารถโหลดข้อมูลมุมมองได้" : "Live perspective records are unavailable."}</p> :
        !items.length ? <div className="atlas-recovery">
          <p>{thai ? "ยังไม่มีมุมมองจากแหล่งข้อมูลที่เผยแพร่" : "There are no published perspective records yet."}</p>
          <Link className="atlas-text-link" href="/sources">{thai ? "ดูแหล่งข้อมูลสาธารณะ" : "Browse public sources"}</Link>
        </div> : items.map(item => {
          const url = safeSourceUrl(item.source.url);
          return <article className="atlas-record" key={item.id}>
            <div>
              <p className="muted">{thai ? "การจัดหมวดหมู่ของ Atlas" : "Atlas annotation"}</p>
              <h2>{item.perspectiveTheme.replaceAll("_", " ")}</h2>
              <p>{item.stance} · {item.sentiment} · {thai ? "ความเชื่อมั่น" : "Confidence"} {item.confidence.toFixed(2)}</p>
              {item.evidenceExcerpt && <p>{thai ? "ข้อความจากแหล่งข้อมูล" : "Source excerpt"}<br />{item.evidenceExcerpt}</p>}
            </div>
            <div>
              <h3>{thai ? "แหล่งข้อมูล" : "Source"}</h3>
              {url ? <a href={url}>{item.source.title}</a> : <p>{item.source.title}</p>}
              <p className="muted">{item.source.platform}</p>
            </div>
          </article>;
        })}
    </div>
  );
}
