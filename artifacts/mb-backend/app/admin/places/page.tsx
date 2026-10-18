import { requireAdminPage } from "@/lib/admin";
import { PlacesOffice } from "@/components/office/places";

export const dynamic = "force-dynamic";
export const metadata = { title: "Venues & Vendors | MB Admin", robots: { index: false, follow: false } };

export default async function PlacesPage() {
  await requireAdminPage("/admin/places", "venues.read");
  return <PlacesOffice />;
}
