import { requireAdminPage } from "@/lib/admin";
import { AdminCalendar } from "@/components/office/admin-calendar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar | MB Admin", robots: { index: false, follow: false } };

export default async function CalendarPage() {
  await requireAdminPage("/admin/calendar", "events.read");
  return (
    <div className="pl">
      <div className="pl-wrap">
        <AdminCalendar />
      </div>
    </div>
  );
}
