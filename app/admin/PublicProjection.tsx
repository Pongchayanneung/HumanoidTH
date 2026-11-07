import type { InspectionRecord } from "@/lib/admin-inspection/contracts";
import { isEligiblePublicRobot, publicContributionWhere, publicRobotWhere, publicSourceRecordWhere } from "@/lib/public-projection";
import { safeSourceUrl } from "@/app/search/searchClient";

async function readPublicFields({ id, collection }: InspectionRecord) {
  if (collection === "submitted-data") return null;
  const { prisma } = await import("@/lib/prisma");
  switch (collection) {
    case "source-records":
      return prisma.sourceRecord.findFirst({ where: { id, ...publicSourceRecordWhere }, select: { title: true, url: true } });
    case "contributions": {
      const row = await prisma.contribution.findFirst({ where: { id, ...publicContributionWhere }, select: { title: true, sourceUrl: true } });
      return row ? { title: row.title, url: row.sourceUrl } : null;
    }
    case "robot-models": {
      const row = await prisma.robotModel.findFirst({ where: { id, ...publicRobotWhere }, select: { canonicalName: true, officialUrl: true } });
      return row && isEligiblePublicRobot(row.canonicalName) ? { title: row.canonicalName, url: row.officialUrl } : null;
    }
  }
}

export default async function PublicProjection({ record, thai }: { record: InspectionRecord; thai: boolean }) {
  const projection = await readPublicFields(record).catch(error => {
    console.error("Inspector public projection unavailable:", error);
    return undefined;
  });
  const url = safeSourceUrl(projection?.url ?? null);
  return (
    <section className="atlas-recovery" aria-labelledby="public-projection-heading">
      <h2 id="public-projection-heading">{thai ? "ข้อมูลที่แสดงต่อสาธารณะ" : "Public projection"}</h2>
      {projection ? <><p><strong>{projection.title}</strong></p>
        {url && <a className="atlas-text-link" href={url} target="_blank" rel="noopener noreferrer">
          {thai ? "เปิดแหล่งข้อมูล (แท็บใหม่)" : "Open source (new tab)"}
        </a>}</> : projection === null ?
        <p className="muted">{thai ? "ระเบียนนี้ไม่มีข้อมูลที่เผยแพร่ต่อสาธารณะ" : "This record has no public projection."}</p> :
        <p role="alert">{thai ? "ขณะนี้ไม่สามารถตรวจสอบข้อมูลสาธารณะได้" : "The public projection could not be checked."}</p>}
    </section>
  );
}
