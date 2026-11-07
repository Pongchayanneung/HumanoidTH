import Link from "next/link";
import { CircleUserRound } from "lucide-react";
import LanguageSelector from "./LanguageSelector";
import { getTranslation } from "@/lib/translations";

export default function MobileHeader({ currentLang = "en" }: { currentLang?: "en" | "th" }) {
  return (
    <header className="mobile-header">
      <Link href="/" className="mobile-brand">
        <img src="/logo.png" alt="Thailand Humanoid Atlas Logo" className="mobile-logo-img" />
        <span className="mobile-title">THAILAND HUMANOID ATLAS</span>
      </Link>
      <div className="mobile-header-actions">
        <LanguageSelector currentLang={currentLang} />
        <Link href="/profile" className="mobile-profile" aria-label={getTranslation(currentLang).profile}>
          <CircleUserRound size={22} className="profile-icon" aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
