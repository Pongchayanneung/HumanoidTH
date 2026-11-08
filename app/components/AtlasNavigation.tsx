"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import LanguageSelector from "./LanguageSelector";
import styles from "./AtlasNavigation.module.css";

const publicGroups = [
  { title: ["Explore", "สำรวจ"], links: [
    ["/", "Home", "หน้าหลัก"],
    ["/search", "Search", "ค้นหา"],
    ["/robots", "Robots", "หุ่นยนต์"],
    ["/sources", "Sources", "แหล่งข้อมูล"],
    ["/map", "Map", "แผนที่"],
    ["/inventory", "Inventory", "คลังรายการ"]
  ] },
  { title: ["Research", "งานวิจัย"], links: [
    ["/contributions", "Research contributions", "ผลงานวิจัย"],
    ["/perspectives", "Perspectives", "มุมมอง"],
    ["/dashboard", "Dashboard", "แดชบอร์ด"],
    ["/analytics", "Analytics", "การวิเคราะห์"],
    ["/network", "Network", "เครือข่าย"]
  ] },
  { title: ["Participation", "การมีส่วนร่วม"], links: [
    ["/submit-data", "Submit data", "ส่งข้อมูล"],
    ["/profile", "Profile", "โปรไฟล์"],
    ["/admin-login", "Operator sign-in", "เข้าสู่ระบบผู้ดูแล"]
  ] }
];

const operatorGroups = [
  { title: ["Operator", "ผู้ดูแล"], links: [
    ["/admin", "Inspection", "ตรวจระเบียน"],
    ["/admin/cms", "CMS", "จัดการข้อมูล"],
    ["/admin/submitted-data", "Submitted data", "ข้อมูลที่ส่ง"],
    ["/data-pulls", "Data pulls", "ดึงข้อมูล"],
    ["/database", "Database", "ฐานข้อมูล"]
  ] },
  { title: ["Public Atlas", "คลังข้อมูลสาธารณะ"], links: [["/", "Home", "หน้าหลัก"], ["/search", "Search", "ค้นหา"]] }
];

export default function AtlasNavigation({ lang }: { lang: "en" | "th" }) {
  const pathname = usePathname() ?? "/";
  const thai = lang === "th";
  const operator = pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/data-pulls" || pathname === "/database";
  const groups = operator ? operatorGroups : publicGroups;
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => { dialog.current?.close(); }, [pathname]);

  return (
    <>
      <header className={styles.header}>
        <button ref={trigger} type="button" className={styles.icon}
          aria-label={thai ? "เปิดเมนู" : "Open navigation"} aria-expanded={open} aria-controls="atlas-navigation"
          onClick={() => { dialog.current?.showModal(); setOpen(true); }}>
          <Menu size={24} aria-hidden="true" />
        </button>
        <Link href="/" className={styles.brand}>
          {thai ? "คลังข้อมูลหุ่นยนต์มนุษย์ประเทศไทย" : "Thailand Humanoid Atlas"}
        </Link>
        <LanguageSelector currentLang={lang} />
      </header>
      <dialog ref={dialog} id="atlas-navigation" className={styles.drawer} aria-labelledby="atlas-navigation-title"
        onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}
        onPointerDown={event => { backdropPress.current = event.target === event.currentTarget; }}
        onClick={event => {
          if (backdropPress.current && event.target === event.currentTarget) dialog.current?.close();
          backdropPress.current = false;
        }}>
        <div className={styles.panel}>
          <div className={styles.drawerHeading}>
            <button type="button" className={styles.icon} autoFocus
              aria-label={thai ? "ปิดเมนู" : "Close navigation"} onClick={() => dialog.current?.close()}>
              <X size={24} aria-hidden="true" />
            </button>
            <h2 id="atlas-navigation-title">{thai ? "เมนู Atlas" : "Atlas navigation"}</h2>
          </div>
          <nav aria-labelledby="atlas-navigation-title">
            {groups.map(group => (
              <div className={styles.group} key={group.title[0]}>
                <p>{group.title[thai ? 1 : 0]}</p>
                <ul>
                  {group.links.map(([href, en, th]) => (
                    <li key={href}>
                      <Link href={href} prefetch={false} aria-current={href === pathname ? "page" : undefined}
                        onClick={event => {
                          if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) dialog.current?.close();
                        }}>{thai ? th : en}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </dialog>
    </>
  );
}
