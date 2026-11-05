import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOperatorPrincipal } from "@/lib/operator-auth/web";
import { logoutUser } from "@/app/actions";

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ collection?: string; selectedId?: string; error?: string }>;

export default async function AdminConsolePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getOperatorPrincipal();
  if (!session.ok && session.code === "UNAUTHENTICATED") redirect("/admin-login");

  const cookieStore = await cookies();
  const thai = cookieStore.get("lang")?.value === "th";
  if (!session.ok) {
    return (
      <section className="panel" aria-labelledby="auth-status">
        <h1 id="auth-status">{thai ? "การยืนยันตัวตนยังไม่พร้อมใช้งาน" : "Authentication unavailable"}</h1>
        <p className="muted">{thai ? "ไม่สามารถตรวจสอบเซสชันได้ในขณะนี้ โปรดลองอีกครั้งภายหลัง" : "Your session cannot be verified right now. Please try again later."}</p>
        <Link className="button" href="/admin">{thai ? "ลองอีกครั้ง" : "Try again"}</Link>
      </section>
    );
  }
  const params = await searchParams;
  return (
    <div className="admin-page">
      <h1>{thai ? "สถานะเซสชันผู้ดูแล" : "Operator session"}</h1>
      {params.error && <p className="notice" role="alert">{thai ? "ออกจากระบบไม่สำเร็จ เซสชันยังไม่ถูกล้าง โปรดลองออกจากระบบอีกครั้ง" : "Sign-out could not be completed. Your session has not been cleared. Please try signing out again."}</p>}
      <section className="panel" aria-labelledby="session-status" style={{ marginTop: 18 }}>
        <h2 id="session-status">{thai ? "เซสชันที่ยืนยันแล้ว" : "Verified session"}</h2>
        <p><strong>{thai ? "อีเมลผู้ดูแล: " : "Operator email: "}</strong>{session.principal.email}</p>
        <form action={logoutUser}>
          <button type="submit" className="primary">{thai ? "ออกจากระบบ" : "Sign out"}</button>
        </form>
      </section>
      <section className="notice" aria-labelledby="workflow-status" style={{ marginTop: 18 }}>
        <h2 id="workflow-status">{thai ? "งานจัดการข้อมูลยังไม่เปิดให้ใช้งาน" : "Data workflows unavailable"}</h2>
        <p>{thai ? "การตรวจดูข้อมูล การแก้ไข การตรวจอนุมัติ การเผยแพร่ และการดึงข้อมูลยังไม่เปิดให้ใช้งาน แม้เข้าสู่ระบบแล้ว หน้านี้แสดงสถานะเซสชันเท่านั้น" : "Inspection, editing, review, publication and ingestion remain unavailable, including for signed-in operators. This page shows session status only."}</p>
      </section>
    </div>
  );
}
