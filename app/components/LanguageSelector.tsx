"use client";

import { useTransition } from "react";
import { setLanguage } from "../actions";

interface LanguageSelectorProps {
  currentLang: "en" | "th";
}

export default function LanguageSelector({ currentLang }: LanguageSelectorProps) {
  const [isPending, startTransition] = useTransition();

  const handleLangChange = (lang: "en" | "th") => {
    if (isPending || lang === currentLang) return;
    startTransition(async () => {
      await setLanguage(lang);
    });
  };

  return (
    <div className={`lang-selector ${isPending ? "loading" : ""}`}>
      <button
        onClick={() => handleLangChange("en")}
        className={currentLang === "en" ? "active" : ""}
        aria-label="English"
        aria-disabled={isPending}
        aria-pressed={currentLang === "en"}
      >
        <span className="flag" aria-hidden="true">🇬🇧</span>
        <span className="lang-text">EN</span>
      </button>
      <button
        onClick={() => handleLangChange("th")}
        className={currentLang === "th" ? "active" : ""}
        aria-label="ภาษาไทย"
        aria-disabled={isPending}
        aria-pressed={currentLang === "th"}
      >
        <span className="flag" aria-hidden="true">🇹🇭</span>
        <span className="lang-text">TH</span>
      </button>
    </div>
  );
}
