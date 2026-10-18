import { requireActor } from "@/lib/admin";
import { env } from "@/lib/env";
import { saveEventFile } from "@/lib/files";
import { AppError } from "@/lib/errors";
import { clientIp } from "@/lib/request-origin";
import { fail } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "files.write");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a file.", 400);
    const saved = await saveEventFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      kind: String(form.get("kind") ?? ""),
      eventId: String(form.get("eventId") ?? "") || null,
      actorEmail: actor.email,
      userId: actor.userId,
      ip: clientIp(request),
    });
    return Response.json(saved, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  try {
    await requireActor(request, "files.read");
    if (!env.DB) throw new AppError("The database is not configured.", 503);
    const eventId = new URL(request.url).searchParams.get("eventId");
    const rows = eventId
      ? await env.DB.prepare("SELECT id, event_id, kind, filename, content_type, byte_size, created_at FROM stored_files WHERE event_id = ? ORDER BY created_at DESC LIMIT 100").bind(eventId).all()
      : await env.DB.prepare("SELECT id, event_id, kind, filename, content_type, byte_size, created_at FROM stored_files ORDER BY created_at DESC LIMIT 100").all();
    return Response.json({ files: rows.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
