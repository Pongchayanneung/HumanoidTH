import Link from "next/link";
import { cookies } from "next/headers";

export default async function NotFound() {
  const thai = (await cookies()).get("lang")?.value === "th";
  return (
    <div className="atlas-workspace">
      <h1>{thai ? "ไม่พบหน้านี้" : "Page not found"}</h1>
      <section className="atlas-recovery">
        <p className="muted">{thai ? "ลิงก์อาจเปลี่ยนไป ลองค้นหาหุ่นยนต์ งานวิจัย หรือแหล่งข้อมูลสาธารณะ" : "The link may have changed. Search for a robot, research project, or public source."}</p>
        <Link className="button primary" href="/search">{thai ? "ค้นหาใน Atlas" : "Search the Atlas"}</Link>
      </section>
    </div>
  );
}
