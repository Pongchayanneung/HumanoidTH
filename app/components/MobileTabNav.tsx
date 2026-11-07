"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  LayoutDashboard,
  Network,
  Bot,
  UsersRound
} from "lucide-react";
import { getTranslation } from "@/lib/translations";

interface MobileTabNavProps {
  currentLang?: "en" | "th";
}

export default function MobileTabNav({ currentLang = "en" }: MobileTabNavProps) {
  const pathname = usePathname() || "/";
  const t = getTranslation(currentLang);
  const tabs = [
    { href: "/", label: t.overview, icon: Home },
    { href: "/dashboard", label: t.dashboard, icon: LayoutDashboard },
    { href: "/network", label: t.network, icon: Network },
    { href: "/robots", label: t.robots, icon: Bot },
    { href: "/contributions", label: t.contributors, icon: UsersRound }
  ];

  return (
    <nav className="mobile-tab-nav" aria-label="Primary mobile navigation">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isExact = pathname === tab.href;
        const isPrefix = tab.href !== "/" && pathname.startsWith(`${tab.href}/`);
        const isAdminSection = tab.href === "/admin" && pathname.startsWith("/admin");
        const isActive = isExact || isPrefix;

        return (
          <Link 
            key={`${tab.href}-${tab.label}`} 
            href={tab.href} 
            className={`tab-item ${isActive || isAdminSection ? "active" : ""}`}
            aria-current={isActive || isAdminSection ? "page" : undefined}
          >
            <Icon size={20} className="tab-icon" aria-hidden="true" />
            <span className="tab-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
