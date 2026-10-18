import { requireAdminPage } from "@/lib/admin";
import { OfficeOverview } from "@/components/office/overview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview | MB Admin", robots: { index: false, follow: false } };

export default async function AdminHome() {
  await requireAdminPage("/admin");
  return <OfficeOverview />;
}
