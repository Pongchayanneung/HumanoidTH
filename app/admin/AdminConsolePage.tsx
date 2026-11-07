import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOperatorPrincipal } from "@/lib/operator-auth/web";
import { inspectCmsRecord } from "@/lib/admin-inspection";
import type { CmsCollection } from "@/lib/admin-inspection/contracts";
import { logoutUser } from "@/app/actions";
import ReadOnlyRecordView from "./ReadOnlyRecordView";
import PublicProjection from "./PublicProjection";

export type AdminSearchParams = Promise<{
  collection?: string | string[];
  selectedId?: string | string[];
  error?: string | string[];
}>;

const collectionLabels: Record<CmsCollection, { en: string; th: string }> = {
  "source-records": { en: "Source records", th: "ระเบียนแหล่งข้อมูล" },
  "robot-models": { en: "Robot models", th: "รุ่นหุ่นยนต์" },
  contributions: { en: "Contributions", th: "ข้อมูลที่ผู้ใช้ร่วมเพิ่ม" },
  "submitted-data": { en: "Submitted data", th: "ข้อมูลที่ส่งเข้ามา" },
};

const inspectionFeedback = {
  INVALID_SELECTION: {
    en: "Invalid selection. Choose a collection and enter one valid record ID.",
    th: "การเลือกไม่ถูกต้อง โปรดเลือกชุดข้อมูลและระบุรหัสระเบียนที่ถูกต้องหนึ่งรายการ",
  },
  NOT_FOUND: {
    en: "Record not found. No record in this collection matches that exact ID.",
    th: "ไม่พบระเบียนในชุดข้อมูลนี้ที่มีรหัสตรงกับที่ระบุ",
  },
  UNAVAILABLE: {
    en: "Inspection unavailable. Please try again later.",
    th: "การตรวจดูข้อมูลยังไม่พร้อมใช้งาน โปรดลองอีกครั้งภายหลัง",
  },
};

export default async function AdminConsolePage({ searchParams, path = "/admin" }: {
  searchParams: AdminSearchParams;
  path?: "/admin" | "/admin/cms" | "/admin/submitted-data";
}) {
  const session = await getOperatorPrincipal();
  if (!session.ok && session.code === "UNAUTHENTICATED") redirect("/admin-login");

  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "th" ? "th" : "en";
  const thai = lang === "th";
  if (!session.ok) {
    return (
      <section className="panel" aria-labelledby="auth-status">
        <h1 id="auth-status">{thai ? "การยืนยันตัวตนยังไม่พร้อมใช้งาน" : "Authentication unavailable"}</h1>
        <p className="muted">{thai ? "ไม่สามารถตรวจสอบเซสชันได้ในขณะนี้ โปรดลองอีกครั้งภายหลัง" : "Your session cannot be verified right now. Please try again later."}</p>
        <Link className="button" href={path} prefetch={false}>{thai ? "ลองอีกครั้ง" : "Try again"}</Link>
      </section>
    );
  }

  const { collection, selectedId, error } = await searchParams;
  const submittedOnly = path === "/admin/submitted-data";
  // An explicit collection outside this alias's scope is invalid, even
  // when it could identify a real record on one of the general routes.
  let requestedCollection = collection;
  if (submittedOnly) {
    if (collection === undefined) requestedCollection = "submitted-data";
    else if (collection !== "submitted-data") requestedCollection = undefined;
  }
  const result = collection !== undefined || selectedId !== undefined
    ? await inspectCmsRecord({ collection: requestedCollection, selectedId })
    : undefined;

  const failure = result?.ok === false ? result.code : undefined;
  if (failure === "UNAUTHENTICATED") redirect("/admin-login");
  const invalidSelection = failure === "INVALID_SELECTION";
  return (
    <div className="admin-page atlas-workspace atlas-operator">
      <h1>{thai ? "สถานะเซสชันผู้ดูแล" : "Operator session"}</h1>
      {error && <p className="notice" role="alert">{thai ? "ออกจากระบบไม่สำเร็จ เซสชันยังไม่ถูกล้าง โปรดลองออกจากระบบอีกครั้ง" : "Sign-out could not be completed. Your session has not been cleared. Please try signing out again."}</p>}
      <section className="panel" aria-labelledby="session-status" style={{ marginTop: 18 }}>
        <h2 id="session-status">{thai ? "เซสชันที่ยืนยันแล้ว" : "Verified session"}</h2>
        <p><strong>{thai ? "อีเมลผู้ดูแล: " : "Operator email: "}</strong>{session.principal.email}</p>
        <form action={logoutUser}>
          <button type="submit" className="primary">{thai ? "ออกจากระบบ" : "Sign out"}</button>
        </form>
      </section>
      <section className="panel" aria-labelledby="inspection-heading" style={{ marginTop: 18 }}>
        <h2 id="inspection-heading">{thai ? "ตรวจดูระเบียนแบบอ่านอย่างเดียว" : "Read-only record inspection"}</h2>
        <p id="inspection-instructions">{thai ? "ระบุรหัสระเบียนให้ตรงกับต้นฉบับ รวมถึงตัวพิมพ์เล็กและตัวพิมพ์ใหญ่" : "Enter the exact record ID, including letter case."}</p>
        <form method="get" action={path} className="form">
          {submittedOnly ? (
            <p><strong>{thai ? "ชุดข้อมูล: " : "Collection: "}</strong>{collectionLabels["submitted-data"][lang]}</p>
          ) : (
            <>
              <label htmlFor="inspection-collection">{thai ? "ชุดข้อมูล" : "Collection"}</label>
              <select
                id="inspection-collection"
                name="collection"
                defaultValue=""
                required
                aria-invalid={invalidSelection || undefined}
                aria-describedby={invalidSelection ? "inspection-error" : undefined}
              >
                <option value="" disabled>{thai ? "เลือกชุดข้อมูล" : "Choose a collection"}</option>
                {Object.entries(collectionLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label[lang]}</option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="inspection-id">{thai ? "รหัสระเบียน" : "Record ID"}</label>
          <input
            id="inspection-id"
            name="selectedId"
            type="text"
            required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={invalidSelection || undefined}
            aria-describedby={invalidSelection ? "inspection-instructions inspection-error" : "inspection-instructions"}
          />
          <button type="submit" className="primary">{thai ? "ตรวจดูระเบียน" : "Inspect record"}</button>
        </form>
        {failure && <p id="inspection-error" className="notice" role="alert">{inspectionFeedback[failure][lang]}</p>}
      </section>
      {result?.ok && <>
        <PublicProjection record={result.record} thai={thai} />
        <ReadOnlyRecordView record={result.record} thai={thai} />
      </>}
      <section className="atlas-recovery" aria-labelledby="workflow-status">
        <h2 id="workflow-status">{thai ? "งานจัดการข้อมูลยังไม่เปิดให้ใช้งาน" : "Data workflows unavailable"}</h2>
        <p>{thai ? "การแก้ไข การตรวจอนุมัติ การเผยแพร่ และการดึงข้อมูลยังไม่เปิดให้ใช้งาน แม้เข้าสู่ระบบแล้ว" : "Editing, review, publication and ingestion remain unavailable, including for signed-in operators."}</p>
      </section>
    </div>
  );
}
