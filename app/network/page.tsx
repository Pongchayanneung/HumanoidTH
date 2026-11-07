import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getTranslation, parseLanguage } from "@/lib/translations";
import NetworkGraphClient from "./NetworkGraphClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ecosystem Relationship Graph | Thailand Humanoid Atlas",
  description: "Interactive connection graph mapping relationships between Thai research labs, robot models, developers, and public media records.",
  alternates: { canonical: "/network" },
  openGraph: {
    title: "Ecosystem Relationship Graph | Thailand Humanoid Atlas",
    description: "Interactive connection graph mapping relationships between Thai research labs, robot models, developers, and public media records.",
    url: "/network",
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
    title: "Ecosystem Relationship Graph | Thailand Humanoid Atlas",
    description: "Interactive connection graph mapping relationships between Thai research labs, robot models, developers, and public media records.",
    images: ["/logo.png"]
  }
};export default async function NetworkPage() {
  const cookieStore = await cookies();
  const lang = parseLanguage(cookieStore.get("lang")?.value);
  const t = getTranslation(lang);

  return (
    <>
      <div className="topline" style={{ display: "block", marginBottom: "16px" }}>
        <div>
          <h1>{t.networkTitle}</h1>
          <p className="muted">{t.networkDesc}</p>
        </div>
        <p className="muted" style={{ fontSize: "13px", marginTop: "8px", maxWidth: "800px", lineHeight: "1.5" }}>
          {lang === "th" 
            ? "กราฟโครงข่ายความสัมพันธ์ระบบนิเวศหุ่นยนต์แสดงการเชื่อมโยงระหว่างหน่วยงานวิจัย (เช่น สถาบันวิทยาการหุ่นยนต์ภาคสนาม FIBO KMUTT, LIRA Lab จุฬาลงกรณ์มหาวิทยาลัย, VISTEC), บริษัทภาคเอกชน, รุ่นหุ่นยนต์ (เช่น NAO, Pepper, Dinsaw) และแหล่งข้อมูลอ้างอิง โหนดในแผนภาพแสดงถึงผู้พัฒนา สถาบัน และรุ่นหุ่นยนต์ โดยมีเส้นเชื่อมระบุประเภทผลงานวิจัย คลังอุปกรณ์ หรือการครอบครองจริงในไทย"
            : "This interactive network graph maps relations between humanoid robotics research labs (e.g., KMUTT FIBO, Chulalongkorn LIRA, VISTEC), commercial enterprises, robot models (e.g., NAO, Pepper, Dinsaw), and academic publications. Nodes represent developer entities, institutions, and robot specifications, while edges visualize contributions, ownership, and media discussion links."}
        </p>
      </div>
      <NetworkGraphClient lang={lang} />
    </>
  );
}
