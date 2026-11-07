import type { Metadata } from "next";
import Link from "next/link";
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
    <div className="atlas-workspace">
      <div className="topline"><h1>{t.mapTitle}</h1></div>
      <section className="atlas-recovery" aria-labelledby="map-unavailable" data-map-state="unavailable">
        <h2 id="map-unavailable">{copy.title}</h2>
        <p className="muted">{copy.body}</p>
        <Link className="button" href="/network">{lang === "th" ? "ดูเครือข่ายหุ่นยนต์" : "Explore the robotics network"}</Link>
      </section>
    </div>
  );
}
