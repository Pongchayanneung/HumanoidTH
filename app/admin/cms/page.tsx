import type { Metadata } from "next";
import AdminConsolePage, { type AdminSearchParams } from "../AdminConsolePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin CMS",
  robots: { index: false, follow: false }
};

export default function AdminCmsPage({ searchParams }: { searchParams: AdminSearchParams }) {
  return <AdminConsolePage path="/admin/cms" searchParams={searchParams} />;
}
