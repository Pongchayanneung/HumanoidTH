import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans_Thai, Inter } from "next/font/google";
import SidebarNav from "./components/SidebarNav";
import LanguageSelector from "./components/LanguageSelector";
import MobileHeader from "./components/MobileHeader";
import MobileTabNav from "./components/MobileTabNav";
import FirstTimeLoader from "./components/FirstTimeLoader";
import { getTranslation } from "@/lib/translations";
import { defaultSeoDescription, getSiteUrl, siteName } from "@/lib/seo";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  variable: "--font-ibm-plex-sans-thai",
  weight: ["100", "200", "300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  applicationName: siteName,
  title: {
    default: siteName,
    template: `%s | ${siteName}`
  },
  description: defaultSeoDescription,
  keywords: [
    "Thailand humanoid robots",
    "humanoid robotics Thailand",
    "social robots Thailand",
    "service robots Thailand",
    "robotics research database",
    "robot model registry",
    "robotics ecosystem map"
  ],
  authors: [{ name: siteName }],
  creator: siteName,
  publisher: siteName,
  alternates: {
    canonical: "/"
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName,
    title: siteName,
    description: defaultSeoDescription,
    locale: "en_US",
    alternateLocale: ["th_TH"],
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 1200,
        alt: `${siteName} logo`
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: siteName,
    description: defaultSeoDescription,
    images: ["/logo.png"]
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false
  },
  icons: {
    icon: [
      { url: "/logo.png", type: "image/png" }
    ],
    shortcut: "/logo.png",
    apple: "/logo.png"
  }
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const lang = (cookieStore.get("lang")?.value || "en") as "en" | "th";
  const t = getTranslation(lang);
  const siteUrl = getSiteUrl();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: siteUrl,
    description: defaultSeoDescription,
    inLanguage: ["en", "th"],
    publisher: {
      "@type": "Organization",
      name: siteName,
      logo: `${siteUrl}/logo.png`
    },
    mainEntity: {
      "@type": "Dataset",
      name: `${siteName} robotics corpus`,
      description: defaultSeoDescription,
      url: siteUrl,
      keywords: [
        "humanoid robotics",
        "Thailand robotics",
        "social robots",
        "service robots",
        "robotics research"
      ],
      inLanguage: ["en", "th"]
    }
  };

  return (
    <html lang={lang} className={`${inter.variable} ${ibmPlexSansThai.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <FirstTimeLoader />
        <div className="app-shell">
          <MobileHeader />
          <aside className="sidebar">
            <div className="brand-logo-container">
              <img src="/logo.png" alt="Thailand Humanoid Atlas" className="brand-logo" />
            </div>
            <div style={{ flex: 1, overflowY: "auto", paddingRight: "4px" }}>
              <SidebarNav currentLang={lang} />
            </div>
            <div style={{ paddingTop: "14px", borderTop: "1px solid #14352a", marginTop: "auto" }}>
              <LanguageSelector currentLang={lang} />
            </div>
          </aside>
          <main className="main motion-page">{children}</main>
          <MobileTabNav currentLang={lang} />
        </div>
      </body>
    </html>
  );
}
