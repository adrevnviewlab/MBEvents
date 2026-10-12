import { requireAdminPage } from "@/lib/admin";
import { AdminPlannerEvent } from "@/components/planner/admin";
import "../../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client Planner | MB Admin", robots: { index: false, follow: false } };

export default async function AdminPlannerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/admin/planner");
  const { id } = await params;
  return <AdminPlannerEvent id={id} />;
}
