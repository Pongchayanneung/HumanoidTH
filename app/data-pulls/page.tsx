import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "API Data Ingestion",
  description: "Data ingestion and pull-job history are unavailable while operator controls and review safeguards are completed.",
  robots: { index: false, follow: false }
};

export default async function Page() {
  const cookieStore = await cookies();
  const thai = cookieStore.get("lang")?.value === "th";
  return (
    <div className="atlas-workspace">
      <h1>{thai ? "การดึงข้อมูลผ่าน API" : "API Data Ingestion"}</h1>
      <section className="atlas-recovery" aria-labelledby="workflow-status">
        <h2 id="workflow-status">{thai ? "ยังไม่เปิดให้ใช้งาน" : "Workflow unavailable"}</h2>
        <p className="muted">{thai ? "การดึงข้อมูลและประวัติงานยังไม่เปิดให้ใช้งานระหว่างพัฒนาการควบคุมสิทธิ์ผู้ดูแลและระบบตรวจสอบ" : "Data ingestion and pull-job history are unavailable while operator controls and review safeguards are completed."}</p>
        <Link className="button" href="/sources">{thai ? "ดูแหล่งข้อมูลสาธารณะ" : "Browse public sources"}</Link>
      </section>
    </div>
  );
}
