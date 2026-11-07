"use client";

import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { ContributionMapPoint } from "./actions";

declare global {
  interface Window {
    google?: any;
  }
}

type Props = {
  apiKey: string;
  points: ContributionMapPoint[];
  lang?: "en" | "th";
};

const localT = {
  en: {
    apiKeyRequired: "Google Maps API key required",
    apiKeyMuted: "Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to the environment to render the live Google Map. AI-mapped contribution clusters are still listed below.",
    selectedCluster: "Selected Cluster",
    ecosystemSummary: "Ecosystem Summary",
    connectedProjects: "Connected Projects",
    emptyState: "No location cluster selected. Click a map marker to explore humanoid contributions."
  },
  th: {
    apiKeyRequired: "จำเป็นต้องระบุคีย์ Google Maps API",
    apiKeyMuted: "โปรดเพิ่ม NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ในการตั้งค่า Environment เพื่อแสดงผลแผนที่แบบสด โดยรายละเอียดคลัสเตอร์ที่วิเคราะห์โดย AI จะยังแสดงอยู่ด้านล่าง",
    selectedCluster: "คลัสเตอร์ที่เลือก",
    ecosystemSummary: "สรุปภาพรวมระบบนิเวศ",
    connectedProjects: "โครงการและผลงานที่เชื่อมโยง",
    emptyState: "ยังไม่ได้เลือกคลัสเตอร์ คลิกที่หมุดบนแผนที่เพื่อดูข้อมูลผลงานพัฒนาและคลังหุ่นยนต์"
  }
};

function centerFor(points: ContributionMapPoint[]) {
  if (!points.length) return { lat: 13.7563, lng: 100.5018 }; // Bangkok default center
  return {
    lat: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.longitude, 0) / points.length
  };
}

export default function GoogleMapClient({ apiKey, points, lang = "en" }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [activePoint, setActivePoint] = useState<ContributionMapPoint | null>(points[0] ?? null);
  const mapCenter = useMemo(() => centerFor(points), [points]);

  useEffect(() => {
    if (!scriptReady || !mapRef.current || !window.google) return;

    const map = new window.google.maps.Map(mapRef.current, {
      center: mapCenter,
      zoom: 6, // Focused zoom level for Thailand
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true
    });

    const bounds = new window.google.maps.LatLngBounds();
    const infoWindow = new window.google.maps.InfoWindow();

    points.forEach((point) => {
      const position = { lat: point.latitude, lng: point.longitude };
      bounds.extend(position);

      const marker = new window.google.maps.Marker({
        map,
        position,
        title: point.title
      });

      marker.addListener("click", () => {
        setActivePoint(point);
        infoWindow.setContent(`
          <div style="max-width:260px; font-family:var(--font-sans); color:var(--text-primary); padding:2px;">
            <strong style="font-size:13px; display:block; margin-bottom:2px;">${point.title.replace(/[<>&"]/g, "")}</strong>
            <span style="font-size:11px; font-weight:700; color:var(--accent-strong); text-transform:uppercase;">${point.contributorType}</span>
            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${point.locationLabel}</div>
            <div style="margin-top:6px; font-size:11px; line-height:1.45; border-top:1px solid #eee; padding-top:4px;">${point.summary.replace(/[<>&"]/g, "")}</div>
          </div>
        `);
        infoWindow.open({ anchor: marker, map });
      });
    });

    if (points.length > 1) {
      map.fitBounds(bounds, 48);
    }
  }, [mapCenter, points, scriptReady]);

  if (!apiKey) {
    return (
      <div className="panel" style={{ minHeight: 520, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <MapPin size={34} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <h2 style={{ marginTop: 10 }}>{localT[lang].apiKeyRequired}</h2>
          <p className="muted" style={{ maxWidth: 520, margin: "8px auto" }}>
            {localT[lang].apiKeyMuted}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <div className="map-layout">
        <div ref={mapRef} className="panel" style={{ minHeight: 520, padding: 0, overflow: "hidden" }} />
        <aside className="panel" style={{ minHeight: 520, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2>{localT[lang].selectedCluster}</h2>
          {activePoint ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <strong style={{ fontSize: 16, display: "block" }}>{activePoint.title}</strong>
                <span className="badge" style={{ marginTop: 6, display: "inline-block", background: "rgba(74, 124, 89, 0.1)", color: "var(--accent-strong)", borderColor: "rgba(74, 124, 89, 0.2)" }}>{activePoint.contributorType}</span>
              </div>
              <div className="muted" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                <span>📍</span> {activePoint.locationLabel}
              </div>
              
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
                <strong style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: 0.5 }}>{localT[lang].ecosystemSummary}</strong>
                <p style={{ margin: "6px 0 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--text-primary)" }}>{activePoint.summary}</p>
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
                <strong style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: 0.5 }}>{localT[lang].connectedProjects} ({activePoint.contributionCount})</strong>
                <ul style={{ margin: "8px 0 0 0", paddingLeft: 16, fontSize: 13, display: "grid", gap: 6 }}>
                  {activePoint.detailsList.map((item, idx) => (
                    <li key={idx} style={{ lineHeight: 1.4 }}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="empty">{localT[lang].emptyState}</div>
          )}
        </aside>
      </div>
    </>
  );
}
