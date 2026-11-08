import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import AdminLoginForm from "./AdminLoginForm";

type SearchParams = Promise<{ error?: string }>;
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Login",
  robots: { index: false, follow: false }
};

export default async function AdminLoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const error = params.error;

  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "th" ? "th" : "en";

  const localT = {
    en: {
      title: "Operator sign-in",
      desc: "Sign in to inspect records by exact ID. Editing, review and publication remain unavailable.",
      email: "Email address", password: "Password", btn: "Sign in", pending: "Signing in…",
      show: "Show password", hide: "Hide password", back: "Return to overview",
      errors: {
        invalid_credentials: "Email or password is incorrect.",
        throttled: "Too many sign-in attempts. Please try again later.",
        unavailable: "Sign-in is unavailable right now. Please try again later.",
        forbidden_origin: "Open the configured site and try signing in again."
      }
    },
    th: {
      title: "เข้าสู่ระบบผู้ดูแล",
      desc: "เข้าสู่ระบบเพื่อตรวจดูระเบียนตามรหัส การแก้ไข การตรวจอนุมัติ และการเผยแพร่ยังไม่เปิดให้ใช้งาน",
      email: "อีเมล", password: "รหัสผ่าน", btn: "เข้าสู่ระบบ", pending: "กำลังเข้าสู่ระบบ…",
      show: "แสดงรหัสผ่าน", hide: "ซ่อนรหัสผ่าน", back: "กลับหน้าภาพรวม",
      errors: {
        invalid_credentials: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
        throttled: "มีการพยายามเข้าสู่ระบบมากเกินไป โปรดลองอีกครั้งภายหลัง",
        unavailable: "การเข้าสู่ระบบยังไม่พร้อมใช้งาน โปรดลองอีกครั้งภายหลัง",
        forbidden_origin: "โปรดเปิดเว็บไซต์ที่กำหนดแล้วลองเข้าสู่ระบบอีกครั้ง"
      }
    }
  }[lang];
  const errorMessage = error
    ? Object.hasOwn(localT.errors, error)
      ? localT.errors[error as keyof typeof localT.errors]
      : localT.errors.unavailable
    : undefined;

  return (
    <div className="atlas-workspace atlas-login admin-login-page">
      <div className="login-card">
        <h1 className="login-title">{localT.title}</h1>
        <p className="login-desc">{localT.desc}</p>

        {errorMessage && (
          <div className="login-error" id="login-error" role="alert">
            {errorMessage}
          </div>
        )}

        <AdminLoginForm emailLabel={localT.email} passwordLabel={localT.password} buttonLabel={localT.btn} pendingLabel={localT.pending} showPasswordLabel={localT.show} hidePasswordLabel={localT.hide} hasError={Boolean(errorMessage)} invalidCredentials={error === "invalid_credentials"} />
        <Link href="/" className="atlas-text-link">{localT.back}</Link>
      </div>
    </div>
  );
}
