import { redirect } from "next/navigation";
import { isOwner, requireAdminPage } from "@/lib/admin";
import { StaffManager } from "@/components/admin-auth";
import "../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff | MB Admin", robots: { index: false, follow: false } };

export default async function StaffPage() {
  const email = await requireAdminPage("/admin/staff");
  if (!isOwner(email)) redirect("/admin/planner");
  return <StaffManager />;
}
