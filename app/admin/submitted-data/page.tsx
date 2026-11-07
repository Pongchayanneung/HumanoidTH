import type { Metadata } from "next";
import AdminConsolePage, { type AdminSearchParams } from "../AdminConsolePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Submitted Data Review",
  robots: { index: false, follow: false }
};

export default function AdminSubmittedDataPage({ searchParams }: { searchParams: AdminSearchParams }) {
  return <AdminConsolePage path="/admin/submitted-data" searchParams={searchParams} />;
}
