import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "User Profile",
  description: "Account registration, profile details and submission history are unavailable while identity and privacy safeguards are completed.",
  robots: { index: false, follow: false }
};

export default async function Page() {
  const cookieStore = await cookies();
  const thai = cookieStore.get("lang")?.value === "th";
  return (
    <div>
      <h1>{thai ? "โปรไฟล์ผู้ใช้" : "User Profile"}</h1>
      <section className="panel" aria-labelledby="workflow-status" style={{ marginTop: 18 }}>
        <h2 id="workflow-status">{thai ? "ยังไม่เปิดให้ใช้งาน" : "Workflow unavailable"}</h2>
        <p className="muted">{thai ? "การสมัครบัญชี ข้อมูลโปรไฟล์ และประวัติการส่งข้อมูลยังไม่เปิดให้ใช้งานระหว่างพัฒนาการยืนยันตัวตนและการคุ้มครองข้อมูลส่วนบุคคล" : "Account registration, profile details and submission history are unavailable while identity and privacy safeguards are completed."}</p>
        <Link className="button" href="/">{thai ? "กลับหน้าภาพรวม" : "Return to overview"}</Link>
      </section>
    </div>
  );
}
