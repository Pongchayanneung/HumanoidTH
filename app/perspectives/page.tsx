import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslation } from "@/lib/translations";
import { PUBLIC_DATASET_SCOPE_LABEL } from "@/lib/public-projection";

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
  const lang = (cookieStore.get("lang")?.value || "en") as "en" | "th";
  const t = getTranslation(lang);

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
      where: {
        source: {
          relevanceStatus: "ACCEPTED"
        }
      },
      include: { source: true },
      orderBy: { createdAt: "desc" },
      take: 200
    });
  } catch (error) {
    console.error("Database query failed in perspectives page:", error);
    dbOffline = true;
    items = [];
  }

  return (
    <>
      <h1>{t.perspectivesTitle}</h1>
      <p className="muted">{t.perspectivesDesc}</p>
      <div className="notice" style={{ background: "rgba(59, 130, 246, 0.08)", borderColor: "var(--accent)", marginBottom: 16 }}>
        <strong>Dataset Scope:</strong> {PUBLIC_DATASET_SCOPE_LABEL}. Perspective records inherit parent source eligibility. Unaccepted sources are omitted.
      </div>
      {dbOffline && (
        <div className="notice" style={{ marginBottom: 16 }}>
          Live perspective annotations are unavailable. No substitute perspective records are being shown.
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Source</th><th>Theme</th><th>Stance</th><th>Sentiment</th><th>Confidence</th><th>Source Excerpt</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><a href={item.source.url}>{item.source.title}</a><br /><span className="muted">{item.source.platform}</span></td>
                <td>{item.perspectiveTheme}</td>
                <td>{item.stance}</td>
                <td>{item.sentiment}</td>
                <td><span className={item.confidence < 0.6 ? "badge warn" : "badge ok"}>{item.confidence.toFixed(2)}</span></td>
                <td>{item.evidenceExcerpt}</td>
              </tr>
            ))}
            {!items.length && <tr><td className="empty" colSpan={6}>No perspective annotations yet. Run an API pull with accepted records.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
