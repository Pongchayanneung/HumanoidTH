import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Contribute Data & Sightings",
  description: "Community submissions and submission history are unavailable while the review and identity workflows are completed. No submission is collected on this page.",
  robots: { index: false, follow: false }
};

export default async function Page() {
  const cookieStore = await cookies();
  const thai = cookieStore.get("lang")?.value === "th";
  return (
    <div className="atlas-workspace">
      <h1>{thai ? "ส่งข้อมูลและรายงานการพบเห็น" : "Contribute Data & Sightings"}</h1>
      <section className="atlas-recovery" aria-labelledby="workflow-status">
        <h2 id="workflow-status">{thai ? "ยังไม่เปิดให้ใช้งาน" : "Workflow unavailable"}</h2>
        <p className="muted">{thai ? "การส่งข้อมูลและประวัติการส่งยังไม่เปิดให้ใช้งานระหว่างพัฒนาระบบตรวจสอบและยืนยันตัวตน หน้านี้ไม่เก็บข้อมูลที่ส่ง" : "Community submissions and submission history are unavailable while the review and identity workflows are completed. No submission is collected on this page."}</p>
        <Link className="button" href="/contributions">{thai ? "ดูผลงานที่เผยแพร่แล้ว" : "Browse published contributions"}</Link>
      </section>
    </div>
  );
}
