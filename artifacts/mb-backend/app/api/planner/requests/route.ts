import { z } from "zod";
import { assertWriteOrigin, db, fail, PlannerError, readJson, sessionEvent, syncGuestSong } from "@/lib/planner-server";

const update = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "declined"]).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  artist: z.string().trim().max(200).optional(),
});

// Client reviews guest requests: approve, decline, or correct the title.
export async function PATCH(request: Request) {
  try {
    assertWriteOrigin(request);
    const event = await sessionEvent(request, "client");
    const parsed = update.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Invalid request.");
    const { id, status, title, artist } = parsed.data;
    await db()
      .prepare("UPDATE planner_guest_requests SET status = COALESCE(?, status), title = COALESCE(?, title), artist = COALESCE(?, artist) WHERE id = ? AND event_id = ?")
      .bind(status ?? null, title ?? null, artist ?? null, id, event.row.id)
      .run();
    await syncGuestSong(event.row.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertWriteOrigin(request);
    const event = await sessionEvent(request, "client");
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!z.string().uuid().safeParse(id).success) throw new PlannerError("Invalid request.");
    await db().prepare("DELETE FROM planner_guest_requests WHERE id = ? AND event_id = ?").bind(id, event.row.id).run();
    await syncGuestSong(event.row.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
