import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { cookies } from "next/headers";
import { getTranslation } from "@/lib/translations";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ecosystem Contribution Map | Thailand Humanoid Atlas",
  description: "Ecosystem contribution map for humanoid robotics in Thailand",
  alternates: { canonical: "/map" },
  robots: { index: false, follow: false },
  openGraph: {
    title: "Ecosystem Contribution Map | Thailand Humanoid Atlas",
    description: "Ecosystem contribution map for humanoid robotics in Thailand",
    url: "/map",
    siteName: "Thailand Humanoid Atlas",
    images: [{ url: "/logo.png", width: 512, height: 512, alt: "Thailand Humanoid Atlas Logo" }],
    locale: "en_US",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Ecosystem Contribution Map | Thailand Humanoid Atlas",
    description: "Ecosystem contribution map for humanoid robotics in Thailand",
    images: ["/logo.png"]
  }
};

// assumed: copy pending Neung review
const localT = {
  en: {
    title: "Map analysis is unavailable in this release.",
    body: "No validated public map result is available, so nothing is shown here."
  },
  th: {
    title: "การวิเคราะห์แผนที่ยังไม่เปิดให้ใช้งานในรุ่นนี้",
    body: "ยังไม่มีผลแผนที่สาธารณะที่ผ่านการตรวจสอบ จึงไม่แสดงข้อมูลบนหน้านี้"
  }
};

export default async function Page() {
  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "th" ? "th" : "en";
  const t = getTranslation(lang);
  const copy = localT[lang];

  return (
    <>
      <div className="topline"><h1>{t.mapTitle}</h1></div>
      <section className="panel" aria-labelledby="map-unavailable" data-map-state="unavailable"
        style={{ minHeight: 520, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <MapPin size={34} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <h2 id="map-unavailable" style={{ marginTop: 10 }}>{copy.title}</h2>
          <p className="muted" style={{ maxWidth: 520, margin: "8px auto" }}>{copy.body}</p>
        </div>
      </section>
    </>
  );
}
