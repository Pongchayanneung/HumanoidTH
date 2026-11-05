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
      desc: "Sign in to verify your operator session. Data inspection and management workflows remain unavailable.",
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
      desc: "เข้าสู่ระบบเพื่อยืนยันเซสชันผู้ดูแล การตรวจดูและจัดการข้อมูลยังไม่เปิดให้ใช้งาน",
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
  const errorMessage = error ? localT.errors[error as keyof typeof localT.errors] || localT.errors.unavailable : undefined;

  return (
    <div className="login-wrapper admin-login-page">
      <style dangerouslySetInnerHTML={{ __html: `
        .login-wrapper {
          min-height: 100dvh;
          width: 100%;
          background: #eae9df;
          background-image: radial-gradient(#cbd5e1 1.5px, transparent 1.5px);
          background-size: 24px 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 28px 20px;
          position: relative;
          top: 0;
          left: 0;
          z-index: 1;
          font-family: var(--font-sans);
        }

        .login-stack {
          align-items: center;
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-width: 0;
          width: min(100%, 430px);
        }

        .login-logo {
          width: clamp(92px, 8vw, 128px);
          height: clamp(92px, 8vw, 128px);
          object-fit: contain;
          border-radius: 18px;
          filter: drop-shadow(0 18px 24px rgba(5, 13, 10, 0.22));
          position: relative;
          z-index: 3;
        }

        .login-card {
          background: #08130f;
          border: 1px solid #11261f;
          border-radius: 16px;
          padding: 28px 34px 32px;
          width: 100%;
          box-shadow: 0 20px 50px rgba(5, 13, 10, 0.45);
          position: relative;
          overflow: hidden;
        }

        .login-card::before {
          content: "";
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, transparent 60%);
          pointer-events: none;
        }

        .login-title {
          font-size: 21px;
          font-weight: 800;
          color: #ffffff;
          margin: 0 0 6px 0;
          letter-spacing: -0.5px;
          position: relative;
          z-index: 2;
        }

        .login-desc {
          font-size: 13px;
          color: #78998c;
          line-height: 1.4;
          margin: 0 0 20px 0;
          position: relative;
          z-index: 2;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
          position: relative;
          z-index: 2;
        }

        .login-label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #a3c2b5;
          font-weight: 600;
        }

        .login-input {
          background: rgba(20, 53, 42, 0.45);
          border: 1px solid rgba(20, 53, 42, 0.8);
          border-radius: 8px;
          color: #ffffff;
          padding: 10px 14px;
          font-size: 14px;
          outline-offset: 2px;
          transition: all 0.2s ease;
        }

        .login-input:focus {
          border-color: #10B981;
          background: rgba(20, 53, 42, 0.65);
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
        }

        .password-input-wrap {
          display: grid;
          position: relative;
        }

        .password-input {
          padding-right: 48px;
          width: 100%;
        }

        .password-toggle {
          align-items: center;
          background: transparent;
          border: 0;
          border-radius: 6px;
          color: #a3c2b5;
          cursor: pointer;
          display: inline-flex;
          height: 34px;
          justify-content: center;
          min-height: 34px;
          overflow: visible;
          padding: 0;
          position: absolute;
          right: 7px;
          top: 50%;
          transform: translateY(-50%);
          width: 34px;
        }

        .password-toggle::after {
          display: none;
        }

        .password-toggle:hover {
          background: rgba(16, 185, 129, 0.12);
          box-shadow: none;
          color: #ffffff;
          transform: translateY(-50%);
        }

        .password-toggle:active {
          transform: translateY(-50%) scale(0.96);
        }

        .password-toggle:focus-visible {
          outline: 2px solid #10B981;
          outline-offset: 2px;
        }

        .login-btn {
          background: #10B981;
          color: #050e0a;
          border: none;
          border-radius: 8px;
          padding: 12px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          margin-top: 10px;
        }

        .login-btn:focus-visible { outline: 2px solid #ffffff; outline-offset: 3px; }
        .login-btn:disabled { cursor: wait; opacity: 0.75; }
        .login-form [role="status"] { color: #a3c2b5; font-size: 13px; }

        .login-btn:hover {
          background: #34d399;
          transform: translateY(-1px);
        }

        .login-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          padding: 10px 14px;
          color: #fca5a5;
          font-size: 12.5px;
          line-height: 1.4;
          margin-bottom: 16px;
          position: relative;
          z-index: 2;
        }

        @media (min-width: 960px) and (max-height: 760px) {
          .login-wrapper {
            align-items: flex-start;
            padding-top: 22px;
          }

          .login-stack {
            gap: 10px;
          }

          .login-logo {
            width: 88px;
            height: 88px;
          }

          .login-card {
            padding: 24px 32px 28px;
          }
        }

        @media (max-width: 520px) {
          .login-wrapper {
            padding: 20px 14px;
          }

          .login-stack {
            gap: 12px;
          }

          .login-card {
            padding: 24px 22px 28px;
          }
        }
      `}} />

      <div className="login-stack">
        <div className="login-card">
          <h1 className="login-title">{localT.title}</h1>
          <p className="login-desc">{localT.desc}</p>

          {errorMessage && (
            <div className="login-error" id="login-error" role="alert">
              {errorMessage}
            </div>
          )}

          <AdminLoginForm emailLabel={localT.email} passwordLabel={localT.password} buttonLabel={localT.btn} pendingLabel={localT.pending} showPasswordLabel={localT.show} hidePasswordLabel={localT.hide} hasError={Boolean(errorMessage)} invalidCredentials={error === "invalid_credentials"} />
          <Link href="/" style={{ color: "#a3c2b5", display: "inline-block", marginTop: 18 }}>{localT.back}</Link>
        </div>
      </div>
    </div>
  );
}
