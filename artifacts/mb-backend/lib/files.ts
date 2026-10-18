import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { fileStore } from "@/lib/storage";

const maxBytes = 20_000_000;
const kinds = new Set(["contract", "event_media", "venue_photo", "vendor_photo", "guest_media"]);

function binary(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function saveEventFile(input: {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  kind: string;
  eventId?: string | null;
  venueId?: string | null;
  vendorId?: string | null;
  actorEmail: string;
  userId?: string | null;
  ip?: string;
}) {
  if (!kinds.has(input.kind)) throw new AppError("Choose a contract, event media, guest media, or photo file.", 400);
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > maxBytes) throw new AppError("Files must be between 1 byte and 20 MB.", 400);
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  if (input.eventId) {
    const event = await env.DB.prepare("SELECT id FROM events WHERE id = ?").bind(input.eventId).first<{ id: string }>();
    if (!event) throw new AppError("Event not found.", 404);
  }
  if (input.kind === "venue_photo") {
    if (!input.venueId) throw new AppError("Choose a venue.", 400);
    const venue = await env.DB.prepare("SELECT id FROM venues WHERE id = ?").bind(input.venueId).first<{ id: string }>();
    if (!venue) throw new AppError("Venue not found.", 404);
  }
  if (input.kind === "vendor_photo") {
    if (!input.vendorId) throw new AppError("Choose a partner.", 400);
    const vendor = await env.DB.prepare("SELECT id FROM vendors WHERE id = ?").bind(input.vendorId).first<{ id: string }>();
    if (!vendor) throw new AppError("Partner not found.", 404);
  }
  const id = crypto.randomUUID();
  const key = `${input.kind}/${id}`;
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", binary(input.bytes))), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const filename = input.filename.replace(/[^\w.\- ()]+/g, "").slice(0, 180) || "file";
  await fileStore().put(key, { bytes: input.bytes, contentType: input.contentType.slice(0, 200) || "application/octet-stream" });
  try {
    await env.DB.prepare(
      `INSERT INTO stored_files (id, event_id, venue_id, vendor_id, kind, filename, content_type, byte_size, checksum_sha256, storage_key, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.eventId || null, input.venueId || null, input.vendorId || null, input.kind, filename, input.contentType.slice(0, 200) || "application/octet-stream", input.bytes.byteLength, checksum, key, input.userId ?? null).run();
  } catch (error) {
    await fileStore().delete(key).catch(() => {});
    throw error;
  }
  await audit({
    actorEmail: input.actorEmail,
    userId: input.userId,
    action: "file_stored",
    entity: "stored_files",
    subjectId: id,
    ip: input.ip,
    after: { kind: input.kind, eventId: input.eventId ?? null, filename, byteSize: input.bytes.byteLength },
  });
  return { id, key, checksum };
}

export async function readStoredFile(id: string) {
  if (!env.DB || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("File not found.", 404);
  const row = await env.DB.prepare("SELECT filename, content_type, storage_key FROM stored_files WHERE id = ?").bind(id).first<{ filename: string; content_type: string; storage_key: string }>();
  if (!row) throw new AppError("File not found.", 404);
  const body = await fileStore().get(row.storage_key);
  if (!body) throw new AppError("File not found.", 404);
  return { filename: row.filename, contentType: row.content_type, bytes: body.bytes };
}
