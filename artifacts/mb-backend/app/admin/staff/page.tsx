import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getActor, requireAdminPage } from "@/lib/admin";
import { can } from "@/lib/authz";
import { StaffHub } from "@/components/office/staff-hub";
import "../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff | MB Admin", robots: { index: false, follow: false } };

export default async function StaffPage() {
  await requireAdminPage("/admin/staff", "office.access");
  const actor = await getActor();
  const canRoster = !!actor && can(actor.role, "staff.read");
  const canManageLogins = !!actor && can(actor.role, "users.manage");
  if (!canRoster && !canManageLogins) redirect("/admin/login?reason=role");
  return (
    <Suspense fallback={<p className="pl-empty">Loading…</p>}>
      <StaffHub canRoster={canRoster} canManageLogins={canManageLogins} />
    </Suspense>
  );
}
