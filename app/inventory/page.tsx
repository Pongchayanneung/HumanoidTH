import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getTranslation, parseLanguage } from "@/lib/translations";
import { sanitizeInventoryForPublic } from "@/lib/public-projection";
import { getOperatorPrincipal } from "@/lib/operator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Robot Inventory & Asset Custody | Thailand Humanoid Atlas",
  description: "Registry of physical humanoid and social robot units managed, operated, or tested under the Thailand Humanoid Atlas project.",
  alternates: { canonical: "/inventory" },
  openGraph: {
    title: "Robot Inventory & Asset Custody | Thailand Humanoid Atlas",
    description: "Registry of physical humanoid and social robot units managed, operated, or tested under the Thailand Humanoid Atlas project.",
    url: "/inventory",
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
    title: "Robot Inventory & Asset Custody | Thailand Humanoid Atlas",
    description: "Registry of physical humanoid and social robot units managed, operated, or tested under the Thailand Humanoid Atlas project.",
    images: ["/logo.png"]
  }
};

type SearchParams = Promise<{ mode?: string }>;

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const cookieStore = await cookies();
  
  // Public data protection (M3 / T03):
  // Reads verified operator principal; anonymous visitors are strictly confined to public-safe mode.
  const session = await getOperatorPrincipal();
  const isOperatorUser = session.ok;
  const isOperator = isOperatorUser && params.mode === "operator";
  const isPublic = !isOperator;
  
  const lang = parseLanguage(cookieStore.get("lang")?.value);
  const t = getTranslation(lang);

  let inventory: any[] = [];
  let unavailable = false;
  try {
    if (isOperator) {
      inventory = await prisma.ownedInventory.findMany({
        include: { robotModel: true },
        orderBy: { updatedAt: "desc" }
      });
    } else {
      const rawInventory = await prisma.ownedInventory.findMany({
        where: { visibility: "public" },
        include: { robotModel: true },
        orderBy: { updatedAt: "desc" }
      });
      inventory = rawInventory.map((item) => sanitizeInventoryForPublic(item));
    }
  } catch (error) {
    console.error("Failed to query inventory in inventory page:", error);
    unavailable = true;
  }

  const localT = {
    en: {
      opMode: "Operator Mode (Private)",
      pubMode: "Public-Safe Mode",
      warnTitle: "Access Warning:",
      warnDesc: "You are currently in Operator Mode. Sensitive internal data (serial numbers, exact locations, and repair logs) are visible on screen. Do not share this view during public presentations or screenshots.",
      safeTitle: "Public-Safe Mode Active:",
      safeDesc: "Serial numbers, exact locations, and private logs are masked or hidden.",
      model: "Robot Model",
      name: "Display Name",
      ownership: "Status / Ownership",
      custodian: "Custodian",
      condition: "Condition",
      location: "Location",
      serial: "Serial Number",
      accs: "Accessories & Docs",
      notes: "Notes / Repair Log",
      updated: "Updated",
      empty: "No inventory records are available in this view.",
      masked: "Masked",
      maskedNotes: "Masked for privacy",
      noLogs: "No logs."
    },
    th: {
      opMode: "โหมดผู้ปฏิบัติงาน (ส่วนตัว)",
      pubMode: "โหมดปลอดภัยสาธารณะ",
      warnTitle: "คำเตือนการเข้าถึง:",
      warnDesc: "คุณกำลังอยู่ในโหมดผู้ปฏิบัติงาน ข้อมูลภายในที่ละเอียดอ่อน (หมายเลขซีเรียล, สถานที่ตั้ง, และบันทึกการซ่อมแซม) จะแสดงบนหน้าจอ กรุณาอย่าแชร์หน้านี้ระหว่างการนำเสนอต่อสาธารณะ",
      safeTitle: "เปิดใช้งานโหมดปลอดภัยสาธารณะ:",
      safeDesc: "หมายเลขซีเรียล สถานที่ตั้ง และบันทึกส่วนตัวถูกปิดบังหรือซ่อนไว้เรียบร้อยแล้ว",
      model: "รุ่นหุ่นยนต์",
      name: "ชื่อที่แสดง",
      ownership: "สถานะ / การครอบครอง",
      custodian: "ผู้ดูแลอุปกรณ์",
      condition: "สภาพการใช้งาน",
      location: "สถานที่ตั้ง",
      serial: "หมายเลขซีเรียล",
      accs: "อุปกรณ์เสริมและคู่มือ",
      notes: "หมายเหตุ / บันทึกการซ่อม",
      updated: "อัปเดตล่าสุด",
      empty: "ไม่พบข้อมูลคลังหุ่นยนต์ในมุมมองนี้",
      masked: "ปิดบังข้อมูล",
      maskedNotes: "ปิดบังข้อมูลส่วนบุคคล",
      noLogs: "ไม่มีบันทึก"
    }
  }[lang];

  return (
    <div className="atlas-workspace">
      <div className="topline">
        <div>
          <h1>{t.inventoryTitle}</h1>
          <p className="muted">{t.inventoryDesc}</p>
        </div>
        <div className="toolbar">
          {isOperatorUser && (
            <Link 
              className={`button ${!isPublic ? "primary" : ""}`} 
              href="/inventory?mode=operator"
            >
              {localT.opMode}
            </Link>
          )}
          <Link 
            className={`button ${isPublic ? "primary" : ""}`} 
            href="/inventory?mode=public"
          >
            {localT.pubMode}
          </Link>
        </div>
      </div>

      {!isPublic ? (
        <div className="notice" style={{ backgroundColor: "#fdf2f2", borderLeftColor: "var(--danger)" }}>
          <strong>{localT.warnTitle}</strong> {localT.warnDesc}
        </div>
      ) : (
        <div className="notice" style={{ backgroundColor: "#f0fdf4", borderLeftColor: "var(--success)" }}>
          <strong>{localT.safeTitle}</strong> {localT.safeDesc}
        </div>
      )}

      {unavailable ? <p className="notice" role="alert">{lang === "th" ? "ขณะนี้ไม่สามารถโหลดข้อมูลคลังได้" : "Live inventory is unavailable."}</p> : <div className="table-wrap">
        <table>
          <caption className="atlas-table-caption">{lang === "th" ? "รายการในคลัง" : "Inventory records"}</caption>
          <thead>
            <tr>
              <th>{localT.model}</th>
              <th>{localT.name}</th>
              <th>{localT.ownership}</th>
              <th>{localT.custodian}</th>
              <th>{localT.condition}</th>
              <th>{localT.location}</th>
              <th>{localT.serial}</th>
              <th>{localT.accs}</th>
              <th>{localT.notes}</th>
              <th>{localT.updated}</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item) => {
              let accs: string[] = [];
              let docs: string[] = [];
              try {
                accs = JSON.parse(item.accessories as string);
                docs = JSON.parse(item.documentationLinks as string);
              } catch (e) {
                // Ignore parse failures
              }

              const displayLocation = isPublic ? `🔒 [${localT.masked}]` : (item.locationLabel ?? "N/A");
              const displaySerial = isPublic 
                ? (item.publicSerialSafe ? item.serialNumber : `🔒 [${localT.masked}]`) 
                : (item.serialNumber ?? "N/A");
              const displayNotes = isPublic ? `🔒 [${localT.maskedNotes}]` : (item.notes ?? localT.noLogs);

              return (
                <tr key={item.id}>
                  <td>
                    <strong>{item.robotModel?.canonicalName ?? "Unknown Model"}</strong>
                    <br />
                    <span className="muted">{item.robotModel?.manufacturer}</span>
                  </td>
                  <td>{item.displayName}</td>
                  <td>
                    <span className="badge">{item.ownershipStatus}</span>
                    <br />
                    <span className={`badge ${item.visibility === "public" ? "ok" : "warn"}`} style={{ marginTop: 4 }}>
                      {item.visibility}
                    </span>
                  </td>
                  <td>{item.custodian ?? "Unassigned"}</td>
                  <td>
                    <span className={`badge ${item.conditionStatus === "excellent" || item.conditionStatus === "good" ? "ok" : "warn"}`}>
                      {item.conditionStatus ?? "unknown"}
                    </span>
                  </td>
                  <td>{displayLocation}</td>
                  <td><code>{displaySerial}</code></td>
                  <td>
                    <div style={{ fontSize: "12px" }}>
                      <strong>Accs:</strong> {accs.length ? accs.join(", ") : "none"}
                    </div>
                    <div style={{ fontSize: "12px", marginTop: 4 }}>
                      <strong>Docs:</strong> {docs.length ? (
                        docs.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer" style={{ marginRight: 6 }}>
                            [Doc {i + 1}]
                          </a>
                        ))
                      ) : "none"}
                    </div>
                  </td>
                  <td style={{ maxWidth: "250px", wordBreak: "break-word" }}>{displayNotes}</td>
                  <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "-"}</td>
                </tr>
              );
            })}
            {!inventory.length && (
              <tr>
                <td className="empty" colSpan={10}>
                  {localT.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>}
    </div>
  );
}
