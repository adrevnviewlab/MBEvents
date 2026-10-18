import { requireAdmin } from "@/lib/admin";
import { listCalendar, listUpcoming, todayInNewYork } from "@/lib/calendar";
import { fail } from "@/lib/planner-server";

const day = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    await requireAdmin(request, "events.read");
    const url = new URL(request.url);
    if (url.searchParams.get("upcoming") === "1") {
      return Response.json({ events: await listUpcoming(todayInNewYork()) }, { headers: { "Cache-Control": "no-store" } });
    }
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    if (!day.test(from) || !day.test(to) || from >= to) {
      return Response.json({ error: "Choose a start and end date." }, { status: 400 });
    }
    return Response.json({ events: await listCalendar({ from, to }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
