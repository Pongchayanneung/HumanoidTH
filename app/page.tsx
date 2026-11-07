import Link from "next/link";
import { cookies } from "next/headers";
import { loadDinsawExample } from "@/lib/atlas-evidence";

async function FeaturedRobot({ lang }: { lang: "en" | "th" }) {
  const example = await loadDinsawExample();
  if (!example) return null;
  const thai = lang === "th";
  return (
    <section className="atlas-home-inner atlas-example" aria-labelledby="atlas-example">
      <h2 id="atlas-example">{thai ? "ตัวอย่างข้อมูล" : "Example record"}</h2>
      <article className="atlas-record">
        <div>
          <p className="muted">{thai ? "หุ่นยนต์" : "Robot"}</p>
          <h3><Link href={{ pathname: "/robots", query: { robot: example.robotId } }}>{example.name}</Link></h3>
          <dl>
            <dt>{thai ? "ผู้พัฒนา" : "Developer"}</dt>
            <dd>CT Asia Robotics</dd>
            <dt>{thai ? "การใช้งานตามที่ NIA ระบุ" : "Intended use, as described by NIA"}</dt>
            <dd>{thai ? "ดูแลผู้สูงอายุที่บ้าน" : "Care for older adults at home"}</dd>
          </dl>
        </div>
        <div>
          <h3>{thai ? "แหล่งอ้างอิง" : "Supporting source"}</h3>
          <a href={example.url} target="_blank" rel="noopener noreferrer">
            {thai ? "อ่านบทความ NIA (เปิดในแท็บใหม่)" : "Read the NIA article (Thai, opens in a new tab)"}
          </a>
          <p className="muted">{thai ? "สำนักงานนวัตกรรมแห่งชาติ" : "National Innovation Agency"} · <time dateTime="2025-04-13">{thai ? "13 เมษายน 2568" : "13 April 2025"}</time></p>
        </div>
      </article>
    </section>
  );
}

export default async function HomePage() {
  const lang = (await cookies()).get("lang")?.value === "th" ? "th" : "en";
  const thai = lang === "th";
  return (
    <div className="atlas-home">
      <section className="atlas-search-hero" aria-labelledby="atlas-home-title">
        <div className="atlas-home-inner">
          <h1 id="atlas-home-title">{thai ? "ค้นหาใน Atlas" : "Atlas Search"}</h1>
          <p>{thai ? "ค้นหาหุ่นยนต์และงานวิจัยที่เกี่ยวข้องกับประเทศไทย แล้วตรวจสอบข้อมูลจากแหล่งเผยแพร่สาธารณะ" : "Find robots and research connected to Thailand and check the public sources behind them."}</p>
          <form method="get" action="/search" role="search" aria-labelledby="atlas-home-title">
            <label htmlFor="home-search">{thai ? "ค้นหาจากชื่อหุ่นยนต์ ผู้พัฒนา หรือการใช้งาน" : "Search by robot, developer, or use"}</label>
            <div className="atlas-search-line">
              <input id="home-search" name="query" type="search" required maxLength={300} placeholder={thai ? "เช่น ดูแลผู้สูงอายุ" : "e.g. home care"} />
              <button type="submit">{thai ? "ค้นหา" : "Search"}</button>
            </div>
          </form>
        </div>
      </section>
      <FeaturedRobot lang={lang} />
      <nav className="atlas-home-inner atlas-browse" aria-label={thai ? "สำรวจ Atlas" : "Browse the Atlas"}>
        <Link href="/robots">{thai ? "หุ่นยนต์" : "Robots"}</Link>
        <Link href="/contributions">{thai ? "ผลงานวิจัย" : "Research contributions"}</Link>
        <Link href="/sources">{thai ? "แหล่งข้อมูล" : "Sources"}</Link>
      </nav>
    </div>
  );
}
