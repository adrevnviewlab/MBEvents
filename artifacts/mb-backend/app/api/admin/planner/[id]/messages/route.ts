import { notifyClient } from "@/lib/notify";
import { db, fail, parseEvent, PlannerError, readJson, type EventRow } from "@/lib/planner-server";
import { requireAdmin } from "@/lib/admin";
import { publicOrigin } from "@/lib/request-origin";

type Params = { params: Promise<{ id: string }> };

// MB reply; also marks the client's messages as read.
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin(request, "events.write");
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new PlannerError("Invalid event.");
    const { body } = (await readJson(request)) as { body?: unknown };
    const text = String(body ?? "").trim();
    if (!text || text.length > 4000) throw new PlannerError("Write a reply up to 4,000 characters.");
    const row = await db().prepare("SELECT * FROM planner_events WHERE id = ?").bind(id).first<EventRow>();
    if (!row) throw new PlannerError("Event not found.", 404);
    const now = new Date().toISOString();
    await db().batch([
      db().prepare("INSERT INTO planner_messages (id, event_id, created_at, sender, body) VALUES (?, ?, ?, 'mb', ?)").bind(crypto.randomUUID(), id, now, text),
      db().prepare("UPDATE planner_messages SET read_at = ? WHERE event_id = ? AND sender = 'client' AND read_at IS NULL").bind(now, id),
    ]);
    const { data } = parseEvent(row);
    await notifyClient(publicOrigin(request), data.details.email, "New message from MB Events", [text], "Messages");
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
