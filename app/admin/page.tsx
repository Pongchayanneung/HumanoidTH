import type { Metadata } from "next";
import AdminConsolePage, { type AdminSearchParams } from "./AdminConsolePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Review Console",
  robots: { index: false, follow: false }
};

export default function AdminPage({ searchParams }: { searchParams: AdminSearchParams }) {
  return <AdminConsolePage searchParams={searchParams} />;
}
