import { requireEventsPage } from "@/lib/admin";
import { StaffHome } from "@/components/operations/staff-home";
import "../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "My events | MB Events", robots: { index: false, follow: false } };

export default async function StaffHomePage() {
  const actor = await requireEventsPage("/staff");
  return <StaffHome office={actor.role !== "staff"} />;
}
