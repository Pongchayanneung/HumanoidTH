import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ecosystem Contribution Map",
  description: "The map is unavailable while public-data access and location accuracy are reviewed. No analysis or map generation runs from this page.",
  robots: { index: false, follow: false }
};

export default async function Page() {
  const cookieStore = await cookies();
  const thai = cookieStore.get("lang")?.value === "th";
  return (
    <div>
      <h1>{thai ? "แผนที่ผลงานในระบบนิเวศ" : "Ecosystem Contribution Map"}</h1>
      <section className="panel" aria-labelledby="workflow-status" style={{ marginTop: 18 }}>
        <h2 id="workflow-status">{thai ? "ยังไม่เปิดให้ใช้งาน" : "Workflow unavailable"}</h2>
        <p className="muted">{thai ? "แผนที่ยังไม่เปิดให้ใช้งานระหว่างตรวจสอบการเข้าถึงข้อมูลสาธารณะและความถูกต้องของตำแหน่ง หน้านี้ไม่เรียกการวิเคราะห์หรือสร้างแผนที่" : "The map is unavailable while public-data access and location accuracy are reviewed. No analysis or map generation runs from this page."}</p>
        <Link className="button" href="/">{thai ? "กลับหน้าภาพรวม" : "Return to overview"}</Link>
      </section>
    </div>
  );
}
