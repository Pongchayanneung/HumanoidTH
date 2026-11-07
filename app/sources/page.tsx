import Link from "next/link";
import { cookies } from "next/headers";
import { buildExportSourcesQuery } from "@/lib/csv-export";
import { readBoundedTextParam } from "@/lib/contribution-filters";
import { safeSourceUrl } from "@/app/search/searchClient";

export const metadata = { title: "Public sources" };

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const thai = (await cookies()).get("lang")?.value === "th";
  const search = readBoundedTextParam((await searchParams).q);
  const q = search.value ?? "";
  const query = buildExportSourcesQuery(q);
  const sources = search.invalid ? [] : await (async () => {
    const { prisma } = await import("@/lib/prisma");
    return prisma.sourceRecord.findMany({
      ...query,
      select: { id: true, title: true, url: true, platform: true, publishedAt: true, sourceType: true }
    });
  })().catch(error => {
    console.error("Public sources unavailable:", error);
    return null;
  });
  const formatDate = new Intl.DateTimeFormat(thai ? "th-TH" : "en-GB", { dateStyle: "long", timeZone: "UTC" });

  return (
    <div className="atlas-workspace">
      <h1>{thai ? "แหล่งข้อมูลสาธารณะ" : "Public sources"}</h1>
      <p className="muted">{thai ? "ค้นหาจากชื่อเรื่อง ผู้เผยแพร่ หรือข้อความในแหล่งข้อมูลที่ผ่านการคัดเลือก" : "Search accepted sources by title, publisher or source text."}</p>
      <form className="atlas-source-filter form" action="/sources" method="get" role="search">
        <label htmlFor="source-query">{thai ? "ค้นหาในแหล่งข้อมูล" : "Search public sources"}</label>
        <div className="atlas-search-line">
          <input id="source-query" name="q" type="search" maxLength={200} defaultValue={q} />
          <button type="submit">{thai ? "ค้นหา" : "Search"}</button>
        </div>
        {q && <Link className="atlas-text-link" href="/sources">{thai ? "ล้างคำค้น" : "Clear search"}</Link>}
      </form>
      {search.invalid ? <p role="alert" className="notice">{thai ? "โปรดใช้คำค้นไม่เกิน 200 อักขระ" : "Enter a valid search term of up to 200 characters."}</p> :
        !sources ? <p role="alert" className="notice">{thai ? "แหล่งข้อมูลยังไม่พร้อมใช้งาน โปรดลองอีกครั้ง" : "Sources are unavailable. Try again."}</p> :
        !sources.length ? <p className="notice">{thai ? "ไม่พบแหล่งข้อมูลที่ตรงกัน" : "No public sources match."}</p> :
        sources.map(source => {
          const url = safeSourceUrl(source.url);
          return (
            <article className="atlas-record" key={source.id}>
              <div>
                <p className="muted">{source.sourceType}</p>
                <h2>{source.title}</h2>
                <p className="muted">{source.platform}{source.platform && source.publishedAt ? " · " : ""}
                  {source.publishedAt && <time dateTime={source.publishedAt.toISOString()}>{formatDate.format(source.publishedAt)}</time>}
                </p>
              </div>
              <div>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{thai ? "อ่านต้นฉบับ (เปิดในแท็บใหม่)" : "Read original (opens in a new tab)"}</a> :
                <p className="muted">{thai ? "ไม่มีลิงก์ต้นฉบับ" : "Original link unavailable."}</p>}</div>
            </article>
          );
        })}
    </div>
  );
}
