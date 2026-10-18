import { z } from "zod";
import { inviteSongView, storeInviteSongRequest } from "@/lib/invites";
import { limits } from "@/lib/rate-limit";
import { assertWriteOrigin, db, fail, guestPortalPayload, PlannerError, readJson, sessionEvent } from "@/lib/planner-server";

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
    const gt = new URL(request.url).searchParams.get("gt")?.trim() ?? "";
    if (gt) return Response.json(await inviteSongView(gt), { headers: { "Cache-Control": "no-store" } });
    const event = await sessionEvent(request, "guest");
    const mine = await db()
      .prepare("SELECT title, artist, status FROM planner_guest_requests WHERE event_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(event.row.id)
      .all<{ title: string; artist: string; status: string }>();
    return Response.json(guestPortalPayload(event, mine.results), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.guestRequest(request);
    const body = await readJson(request);
    const inviteToken = typeof (body as { inviteToken?: unknown }).inviteToken === "string" ? (body as { inviteToken: string }).inviteToken.trim() : "";
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new PlannerError("Add your name and a song title.");
    const { title, artist, note } = parsed.data;
    if (inviteToken) {
      await storeInviteSongRequest(inviteToken, { title, artist, note });
      return Response.json({ ok: true }, { status: 201 });
    }
    const { row, admin } = await sessionEvent(request, "guest");
    if (!admin.guestRequestsOpen) throw new PlannerError("Song requests are closed for this event.", 403);
    const count = await db().prepare("SELECT CAST(COUNT(*) AS integer) AS n FROM planner_guest_requests WHERE event_id = ?").bind(row.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_PER_EVENT) throw new PlannerError("This event has reached its request limit.", 429);
    await db()
      .prepare("INSERT INTO planner_guest_requests (id, event_id, created_at, guest_name, title, artist, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')")
      .bind(crypto.randomUUID(), row.id, new Date().toISOString(), parsed.data.guestName, title, artist, note)
      .run();
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
