import { env } from "@/lib/env";
import { requireAdminPage } from "@/lib/admin";
import { AdminPlannerList } from "@/components/planner/admin";
import "../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client Planners | MB Admin", robots: { index: false, follow: false } };

type Lead = { id: string; name: string; email: string; phone: string; event_type: string; event_date: string | null; guest_count: string | null; location: string | null; venue_name: string | null };

export default async function AdminPlanners() {
  await requireAdminPage("/admin/planner");
  let leads: Lead[] = [];
  try {
    if (env.DB) leads = (await env.DB.prepare("SELECT id, name, email, phone, event_type, event_date, guest_count, location, venue_name FROM leads WHERE merged_into_id IS NULL AND converted_event_id IS NULL ORDER BY created_at DESC LIMIT 100").all<Lead>()).results;
  } catch (error) {
    console.error("Lead lookup failed", error);
  }
  return <AdminPlannerList leads={leads} />;
}
