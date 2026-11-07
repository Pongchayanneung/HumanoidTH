import type { InspectionRecord } from "@/lib/admin-inspection/contracts";

const MAX_CONTENT_CODE_POINTS = 4096;

function Content({ text, thai }: { text: string | null; thai: boolean }) {
  if (text === null) return <span className="muted">{thai ? "ไม่มีข้อมูล" : "Not provided"}</span>;
  let end = 0;
  let length = 0;
  for (const codePoint of text) {
    if (length === MAX_CONTENT_CODE_POINTS) {
      return (
        <>
          {text.slice(0, end)}
          <p className="muted">{thai ? "ตัดข้อความที่แสดงหลัง 4,096 จุดรหัสยูนิโค้ด" : "Display truncated after 4,096 Unicode code points."}</p>
        </>
      );
    }
    end += codePoint.length;
    length++;
  }
  return <>{text}</>;
}

export default function ReadOnlyRecordView({ record, thai }: { record: InspectionRecord; thai: boolean }) {
  return (
    <section className="panel" aria-labelledby="record-heading" style={{ marginTop: 18 }}>
      <h2 id="record-heading">{thai ? "ระเบียนที่เลือก" : "Selected record"}</h2>
      <dl style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
        <dt><strong>{thai ? "ชุดข้อมูล" : "Collection"}</strong></dt>
        <dd>{record.collection}</dd>
        <dt><strong>{thai ? "รหัสระเบียน" : "Record ID"}</strong></dt>
        <dd>{record.id}</dd>
        <dt><strong>{thai ? "ชื่อ" : "Name"}</strong></dt>
        <dd><Content text={record.displayName} thai={thai} /></dd>
        <dt><strong>{thai ? "สรุป" : "Summary"}</strong></dt>
        <dd><Content text={record.summary} thai={thai} /></dd>
        <dt><strong>{thai ? "สถานะ" : "Status"}</strong></dt>
        <dd><Content text={record.status} thai={thai} /></dd>
        <dt><strong>URL</strong></dt>
        <dd><Content text={record.url} thai={thai} /></dd>
        <dt><strong>{thai ? "สร้างเมื่อ" : "Created"}</strong></dt>
        <dd><time dateTime={record.createdAt}>{record.createdAt}</time></dd>
        <dt><strong>{thai ? "อัปเดตเมื่อ" : "Updated"}</strong></dt>
        <dd><time dateTime={record.updatedAt}>{record.updatedAt}</time></dd>
      </dl>
    </section>
  );
}
