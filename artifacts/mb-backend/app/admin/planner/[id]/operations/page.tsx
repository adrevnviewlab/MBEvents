import { env } from "@/lib/env";
import { requireAdminPage } from "@/lib/admin";
import { EventOperations } from "@/components/operations/event-operations";
import "../../../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations | MB Admin", robots: { index: false, follow: false } };

export default async function OperationsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/admin/planner", "events.read");
  const { id } = await params;
  // Control Room URLs use planner_events.id; operations APIs need events.id.
  let eventId = id;
  try {
    if (env.DB && /^[0-9a-f-]{36}$/i.test(id)) {
      const row = await env.DB.prepare("SELECT event_id FROM planner_events WHERE id = ?").bind(id).first<{ event_id: string | null }>();
      if (row?.event_id) eventId = row.event_id;
    }
  } catch {
    eventId = id;
  }
  return <EventOperations eventId={eventId} />;
}
