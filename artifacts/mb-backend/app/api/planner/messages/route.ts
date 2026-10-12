import { notifyMb } from "@/lib/notify";
import { limits } from "@/lib/rate-limit";
import { publicOrigin } from "@/lib/request-origin";
import { assertWriteOrigin, db, fail, PlannerError, readJson, sessionEvent } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.message(request);
    const event = await sessionEvent(request, "client");
    const body = (await readJson(request)) as { body?: unknown };
    const text = String(body.body ?? "").trim();
    if (!text || text.length > 4000) throw new PlannerError("Write a message up to 4,000 characters.");
    const now = new Date().toISOString();
    await db().batch([
      db().prepare("INSERT INTO planner_messages (id, event_id, created_at, sender, body) VALUES (?, ?, ?, 'client', ?)").bind(crypto.randomUUID(), event.row.id, now, text),
      // Opening the thread marks MB's replies as read.
      db().prepare("UPDATE planner_messages SET read_at = ? WHERE event_id = ? AND sender = 'mb' AND read_at IS NULL").bind(now, event.row.id),
    ]);
    await notifyMb(publicOrigin(request), event.row.id, `New message from ${event.data.details.clientNames || "a client"}`, [text]);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertWriteOrigin(request);
    const event = await sessionEvent(request, "client");
    await db().prepare("UPDATE planner_messages SET read_at = ? WHERE event_id = ? AND sender = 'mb' AND read_at IS NULL").bind(new Date().toISOString(), event.row.id).run();
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
