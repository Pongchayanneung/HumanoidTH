"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [thai, setThai] = useState(false);
  useEffect(() => {
    console.error("Atlas page failed:", error);
    setThai(document.documentElement.lang === "th");
  }, [error]);

  return (
    <div className="atlas-workspace">
      <h1>{thai ? "โหลดหน้านี้ไม่สำเร็จ" : "This page could not load"}</h1>
      <section className="atlas-recovery">
        <p className="muted">{thai ? "ลองโหลดอีกครั้ง หรือค้นหาจาก Atlas" : "Try loading it again, or continue with Atlas Search."}</p>
        <div className="toolbar">
          <button className="primary" onClick={reset}>{thai ? "ลองอีกครั้ง" : "Try again"}</button>
          <Link className="button" href="/search">{thai ? "ค้นหา" : "Search"}</Link>
        </div>
      </section>
    </div>
  );
}
