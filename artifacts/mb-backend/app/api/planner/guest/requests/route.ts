import { z } from "zod";
import { limits } from "@/lib/rate-limit";
import { assertWriteOrigin, db, fail, PlannerError, readJson, sessionEvent } from "@/lib/planner-server";

const schema = z.object({
  guestName: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().max(200).default(""),
  note: z.string().trim().max(500).default(""),
});

const MAX_PER_EVENT = 500;

// What a signed-in guest sees: the event headline and their requests so far.
export async function GET(request: Request) {
  try {
    const { row, data, admin } = await sessionEvent(request, "guest");
    const mine = await db()
      .prepare("SELECT title, artist, status FROM planner_guest_requests WHERE event_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(row.id)
      .all();
    return Response.json({
      guestCode: row.guest_code,
      eventType: data.details.eventType,
      clientNames: data.details.clientNames,
      eventDate: data.details.eventDate,
      open: admin.guestRequestsOpen,
      requests: mine.results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.guestRequest(request);
    const { row, admin } = await sessionEvent(request, "guest");
    if (!admin.guestRequestsOpen) throw new PlannerError("Song requests are closed for this event.", 403);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Add your name and a song title.");
    const count = await db().prepare("SELECT CAST(COUNT(*) AS integer) AS n FROM planner_guest_requests WHERE event_id = ?").bind(row.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_PER_EVENT) throw new PlannerError("This event has reached its request limit.", 429);
    const { guestName, title, artist, note } = parsed.data;
    await db()
      .prepare("INSERT INTO planner_guest_requests (id, event_id, created_at, guest_name, title, artist, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')")
      .bind(crypto.randomUUID(), row.id, new Date().toISOString(), guestName, title, artist, note)
      .run();
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
