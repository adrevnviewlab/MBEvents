import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venues | MB Admin", robots: { index: false, follow: false } };

export default async function VenuesAdminPage() {
  await requireAdminPage("/admin/venues", "venues.read");
  redirect("/admin/places?tab=venues");
}
