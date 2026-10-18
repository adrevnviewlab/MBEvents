import { Suspense } from "react";
import { requireAdminPage } from "@/lib/admin";
import { OfficeEquipment } from "@/components/office/equipment";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment | MB Admin", robots: { index: false, follow: false } };

export default async function EquipmentPage() {
  await requireAdminPage("/admin/equipment", "equipment.read");
  return (
    <Suspense fallback={<p className="pl-empty">Loading…</p>}>
      <OfficeEquipment />
    </Suspense>
  );
}
