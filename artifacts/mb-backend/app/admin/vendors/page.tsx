import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendors | MB Admin", robots: { index: false, follow: false } };

export default async function VendorsAdminPage() {
  await requireAdminPage("/admin/vendors", "vendors.read");
  redirect("/admin/places?tab=vendors");
}
