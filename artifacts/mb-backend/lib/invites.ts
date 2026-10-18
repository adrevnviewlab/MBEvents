// One invitation per event. Guest links are stored as hashes. The raw token is returned
// once by addGuest / rotateGuestLink.

import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/authz";
import { integrationFlags } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { saveEventFile } from "@/lib/files";
import { notifyAccount } from "@/lib/notify";
import { adminDataSchema, guestAccessToken, randomCode, sha256 } from "@/lib/planner";
import { db } from "@/lib/planner-server";
import { qrSvg } from "@/lib/qr";
import { parseInput } from "@/lib/validate";

const MAX_ATTEMPTS = 5;
const reservedSlugs = new Set(["check-in", "rsvp", "media", "gallery"]);

export type GuestListViewer = { kind: "host" | "office" | "staff" | "guest" };
type Actor = { email: string; ip?: string };

export type Invitation = {
  id: string;
  eventId: string;
  slug: string;
  title: string;
  message: string;
  status: string;
  mode: "public" | "private" | "invite_only";
  published: boolean;
  plusOneCap: number;
  rsvpDeadline: string | null;
  theme: { color: string; accent: string; image: string };
  questions: { id: string; label: string }[];
  involvesMinors: boolean;
};

type InvitationRow = {
  id: string;
  event_id: string;
  slug: string;
  title: string;
  message: string;
  status: string;
  mode: string;
  published: boolean | string | number;
  plus_one_cap: number | string;
  rsvp_deadline: string | null;
  theme_color: string;
  theme_accent: string;
  theme_image: string;
  guest_questions: unknown;
  involves_minors: boolean | string | number;
};

type GuestRow = {
  id: string;
  event_id: string;
  name: string;
  email: string;
  phone: string;
  party_size: number | string;
  table_label: string;
  table_id: string | null;
  token_hash: string | null;
  checkin_code_hash: string | null;
  is_minor: boolean | string | number;
  checked_in_at: string | null;
};

type TableRow = {
  id: string;
  event_id: string;
  label: string;
  capacity: number | string;
  sort_order: number | string;
  pos_x: number | string;
  pos_y: number | string;
};

type RsvpRow = {
  id: string;
  guest_id: string;
  status: string;
  note: string;
  plus_ones: number | string;
  answers: unknown;
};

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
  mode: z.enum(["public", "private", "invite_only"]).optional(),
  published: z.boolean().optional(),
  plusOneCap: z.coerce.number().int().min(0).max(49).optional(),
  rsvpDeadline: z.string().max(40).nullable().optional(),
  themeColor: z.string().max(20).optional(),
  themeAccent: z.string().max(20).optional(),
  themeImage: z.string().max(500).optional(),
  questions: z.array(z.object({ id: z.string().max(60).optional(), label: z.string().max(200) })).max(20).optional(),
  involvesMinors: z.boolean().optional(),
  slug: z.string().max(80).optional(),
});

const guestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  partySize: z.coerce.number().int().min(1).max(50).optional().default(1),
  table: z.string().trim().max(80).optional().default(""),
  tableId: z.string().uuid().nullable().optional(),
  isMinor: z.boolean().optional().default(false),
});

const guestPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  partySize: z.coerce.number().int().min(1).max(50).optional(),
  table: z.string().trim().max(80).optional(),
  tableId: z.string().uuid().nullable().optional(),
  isMinor: z.boolean().optional(),
  rsvp: z.enum(["pending", "yes", "no"]).optional(),
  plusOnes: z.coerce.number().int().min(0).max(49).optional(),
  note: z.string().trim().max(500).optional(),
});

const tableSchema = z.object({
  label: z.string().trim().min(1).max(80),
  capacity: z.coerce.number().int().min(1).max(200).optional().default(8),
  posX: z.coerce.number().min(0).max(4000).optional().default(0),
  posY: z.coerce.number().min(0).max(4000).optional().default(0),
});

const tablePatchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  capacity: z.coerce.number().int().min(1).max(200).optional(),
  posX: z.coerce.number().min(0).max(4000).optional(),
  posY: z.coerce.number().min(0).max(4000).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const assignSchema = z.object({
  guestIds: z.array(z.string().uuid()).min(1).max(200),
  tableId: z.string().uuid().nullable(),
});

const rsvpSchema = z.object({
  status: z.enum(["yes", "no"]),
  plusOnes: z.coerce.number().int().min(0).max(49).optional().default(0),
  note: z.string().trim().max(500).optional().default(""),
  answers: z.array(z.object({ questionId: z.string().max(60), value: z.string().max(500) })).max(20).optional().default([]),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
});

const messageSchema = z.object({
  channel: z.enum(["email", "sms"]),
  kind: z.enum(["invite", "reminder"]),
  to: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  nextAttemptAt: z.string().min(4).max(40),
  guestId: z.string().uuid().nullable().optional(),
});

function flag(value: unknown) {
  return value === true || value === 1 || value === "t" || value === "true";
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function isUnique(error: unknown) {
  return /unique|duplicate key/i.test(String(error));
}

function cleanColor(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text)) throw new AppError("Use a hex color such as #112233.", 400);
  return text;
}

function cleanImage(value: string) {
  const text = value.trim().slice(0, 500);
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new AppError("Image must be an https link.", 400);
  }
  if (url.protocol !== "https:") throw new AppError("Image must be an https link.", 400);
  return url.toString();
}

function cleanSlug(value: string) {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 80 || reservedSlugs.has(slug)) {
    throw new AppError("Use a short link with letters, numbers, and dashes.", 400);
  }
  return slug;
}

function cleanQuestions(value: { id?: string; label: string }[]) {
  return value.map((item) => {
    const label = item.label.trim();
    if (!label) throw new AppError("Each question needs a label.", 400);
    const id = item.id && /^[0-9a-f-]{36}$/i.test(item.id) ? item.id : crypto.randomUUID();
    return { id, label: label.slice(0, 200) };
  });
}

function present(row: InvitationRow): Invitation {
  const mode = row.mode === "public" || row.mode === "private" || row.mode === "invite_only" ? row.mode : "invite_only";
  return {
    id: row.id,
    eventId: row.event_id,
    slug: row.slug,
    title: row.title,
    message: row.message,
    status: row.status,
    mode,
    published: flag(row.published),
    plusOneCap: Number(row.plus_one_cap) || 0,
    rsvpDeadline: row.rsvp_deadline,
    theme: { color: row.theme_color, accent: row.theme_accent, image: row.theme_image },
    questions: jsonValue<{ id: string; label: string }[]>(row.guest_questions, []),
    involvesMinors: flag(row.involves_minors),
  };
}

async function loadByEvent(eventId: string) {
  const row = await db().prepare("SELECT * FROM invitations WHERE event_id = ?").bind(eventId).first<InvitationRow>();
  return row ? present(row) : null;
}

async function loadBySlug(slug: string) {
  const row = await db().prepare("SELECT * FROM invitations WHERE slug = ?").bind(slug).first<InvitationRow>();
  return row ? present(row) : null;
}

export async function centralEventId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("Event not found.", 404);
  const event = await db().prepare("SELECT id FROM events WHERE id = ?").bind(id).first<{ id: string }>();
  if (event) return event.id;
  const planner = await db().prepare("SELECT event_id FROM planner_events WHERE id = ?").bind(id).first<{ event_id: string }>();
  if (planner?.event_id) return planner.event_id;
  throw new AppError("Event not found.", 404);
}

export async function staffAssigned(userId: string | null, eventId: string) {
  if (!userId) return false;
  const row = await db()
    .prepare("SELECT 1 AS ok FROM assignments a JOIN staff s ON s.id = a.staff_id WHERE a.event_id = ? AND s.user_id = ?")
    .bind(eventId, userId)
    .first<{ ok: number }>();
  return Boolean(row);
}

export function canManageInvites(role: Parameters<typeof can>[0]) {
  return can(role, "office.access") && can(role, "invitations.write") && can(role, "events.read");
}

// Links the invitation to an existing event. Does not insert an events row.
export async function ensureInvitation(eventId: string) {
  const event = await db().prepare("SELECT id, name FROM events WHERE id = ?").bind(eventId).first<{ id: string; name: string }>();
  if (!event) throw new AppError("Event not found.", 404);
  const existing = await loadByEvent(eventId);
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID();
    const slug = `e-${randomCode(8).toLowerCase()}`;
    try {
      await db().prepare("INSERT INTO invitations (id, event_id, slug, title) VALUES (?, ?, ?, ?)").bind(id, eventId, slug, event.name.slice(0, 200)).run();
      const created = await loadByEvent(eventId);
      if (created) return created;
    } catch (error) {
      if (!isUnique(error)) throw error;
      const winner = await loadByEvent(eventId);
      if (winner) return winner;
    }
  }
  throw new AppError("Could not save the invitation.", 500);
}

export async function saveInvitation(eventId: string, input: unknown, actor: Actor) {
  const patch = parseInput(patchSchema, input);
  const current = await ensureInvitation(eventId);
  const sets = ["updated_at = now()"];
  const values: unknown[] = [];
  const add = (column: string, value: unknown, jsonb = false) => {
    sets.push(`${column} = ${jsonb ? "?::jsonb" : "?"}`);
    values.push(value);
  };
  if (patch.title !== undefined) add("title", patch.title.trim().slice(0, 200));
  if (patch.message !== undefined) add("message", patch.message.slice(0, 4000));
  if (patch.mode !== undefined) add("mode", patch.mode);
  if (patch.plusOneCap !== undefined) add("plus_one_cap", patch.plusOneCap);
  if (patch.rsvpDeadline !== undefined) {
    if (!patch.rsvpDeadline) add("rsvp_deadline", null);
    else if (Number.isNaN(Date.parse(patch.rsvpDeadline))) throw new AppError("Check the RSVP deadline.", 400);
    else add("rsvp_deadline", new Date(patch.rsvpDeadline).toISOString());
  }
  if (patch.themeColor !== undefined) add("theme_color", cleanColor(patch.themeColor));
  if (patch.themeAccent !== undefined) add("theme_accent", cleanColor(patch.themeAccent));
  if (patch.themeImage !== undefined) add("theme_image", cleanImage(patch.themeImage));
  if (patch.questions !== undefined) add("guest_questions", JSON.stringify(cleanQuestions(patch.questions)), true);
  if (patch.involvesMinors !== undefined) add("involves_minors", patch.involvesMinors);
  if (patch.slug !== undefined) add("slug", cleanSlug(patch.slug));
  let publishChange: boolean | undefined;
  if (patch.published !== undefined && patch.published !== current.published) {
    publishChange = patch.published;
    add("published", patch.published);
    add("status", patch.published ? "open" : "draft");
  }
  if (values.length) {
    try {
      await db().prepare(`UPDATE invitations SET ${sets.join(", ")} WHERE id = ?`).bind(...values, current.id).run();
    } catch (error) {
      if (isUnique(error)) throw new AppError("That link is already in use.", 400);
      throw error;
    }
  }
  if (publishChange !== undefined) {
    await audit({
      actorEmail: actor.email,
      action: publishChange ? "invitation_published" : "invitation_unpublished",
      entity: "invitations",
      subjectId: current.id,
      ip: actor.ip,
      before: { published: current.published },
      after: { published: publishChange, eventId },
    });
  }
  const saved = await loadByEvent(eventId);
  if (!saved) throw new AppError("Could not save the invitation.", 500);
  return saved;
}

function tokenShape(token: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

async function guestByHash(hash: string) {
  return db()
    .prepare("SELECT * FROM guests WHERE token_hash = ? OR checkin_code_hash = ?")
    .bind(hash, hash)
    .first<GuestRow>();
}

async function guestByToken(token: string) {
  if (!tokenShape(token)) return null;
  const hash = await sha256(token);
  return db().prepare("SELECT * FROM guests WHERE token_hash = ?").bind(hash).first<GuestRow>();
}

export function checkInUrl(origin: string, token: string) {
  const path = `/invite/check-in?t=${encodeURIComponent(token)}`;
  if (!origin) return path;
  return new URL(path, origin.endsWith("/") ? origin : `${origin}/`).toString();
}

export function inviteUrl(origin: string, slug: string, token: string) {
  const path = `/invite/${encodeURIComponent(slug)}?t=${encodeURIComponent(token)}`;
  if (!origin) return path;
  return new URL(path, origin.endsWith("/") ? origin : `${origin}/`).toString();
}

function safeQr(url: string) {
  try {
    return qrSvg(url);
  } catch {
    return "";
  }
}

function issuedLink(slug: string, token: string, checkInCode: string, origin: string) {
  // Invite link uses the RSVP/gallery token. Check-in QR uses a separate revocable code.
  const checkIn = checkInUrl(origin, checkInCode);
  return { token, checkInCode, inviteUrl: inviteUrl(origin, slug, token), checkInUrl: checkIn, qrSvg: safeQr(checkIn) };
}

function seatsFor(partySize: number, rsvp: string, plusOnes: number) {
  return partySize + (rsvp === "yes" ? plusOnes : 0);
}

async function tableById(eventId: string, tableId: string) {
  return db()
    .prepare("SELECT id, event_id, label, capacity, sort_order, pos_x, pos_y FROM event_tables WHERE id = ? AND event_id = ?")
    .bind(tableId, eventId)
    .first<TableRow>();
}

async function occupiedSeats(eventId: string, tableId: string, exceptGuestIds: string[] = []) {
  const guests = await listGuests(eventId, { kind: "office" });
  return guests
    .filter((guest) => guest.tableId === tableId && !exceptGuestIds.includes(guest.id))
    .reduce((sum, guest) => sum + seatsFor(guest.partySize, guest.rsvp, guest.plusOnes), 0);
}

async function assertTableCapacity(eventId: string, tableId: string, needed: number, exceptGuestIds: string[] = []) {
  const table = await tableById(eventId, tableId);
  if (!table) throw new AppError("Table not found.", 404);
  const used = await occupiedSeats(eventId, tableId, exceptGuestIds);
  const capacity = Number(table.capacity);
  if (used + needed > capacity) {
    throw new AppError(`Table ${table.label} only has ${Math.max(0, capacity - used)} seat${capacity - used === 1 ? "" : "s"} left.`, 409);
  }
  return table;
}

export async function addGuest(eventId: string, input: unknown, origin = "") {
  const invitation = await ensureInvitation(eventId);
  const guest = parseInput(guestSchema, input);
  const id = crypto.randomUUID();
  const token = guestAccessToken();
  const checkInCode = guestAccessToken();
  let tableId: string | null = guest.tableId ?? null;
  let tableLabel = guest.table;
  const partySize = guest.partySize ?? 1;
  if (tableId) {
    const table = await assertTableCapacity(eventId, tableId, partySize);
    tableLabel = table.label;
  }
  await db()
    .prepare(
      `INSERT INTO guests (id, event_id, name, email, phone, party_size, table_label, table_id, token_hash, checkin_code_hash, is_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, eventId, guest.name, guest.email, guest.phone, partySize, tableLabel, tableId, await sha256(token), await sha256(checkInCode), guest.isMinor)
    .run();
  if (guest.email?.includes("@")) {
    const { scheduleRsvpReminder } = await import("@/lib/communications");
    await scheduleRsvpReminder({ guestId: id, eventId }).catch(() => undefined);
  }
  return { id, ...issuedLink(invitation.slug, token, checkInCode, origin) };
}

export async function rotateGuestLink(eventId: string, guestId: string, origin = "") {
  const invitation = await ensureInvitation(eventId);
  const guest = await db().prepare("SELECT id FROM guests WHERE id = ? AND event_id = ?").bind(guestId, eventId).first<{ id: string }>();
  if (!guest) throw new AppError("Guest not found.", 404);
  const token = guestAccessToken();
  const checkInCode = guestAccessToken();
  await db()
    .prepare("UPDATE guests SET token_hash = ?, checkin_code_hash = ? WHERE id = ?")
    .bind(await sha256(token), await sha256(checkInCode), guestId)
    .run();
  return { id: guestId, ...issuedLink(invitation.slug, token, checkInCode, origin) };
}

export async function updateGuest(eventId: string, guestId: string, input: unknown) {
  const patch = parseInput(guestPatchSchema, input);
  const guest = await db()
    .prepare("SELECT id, party_size, table_id FROM guests WHERE id = ? AND event_id = ?")
    .bind(guestId, eventId)
    .first<{ id: string; party_size: number | string; table_id: string | null }>();
  if (!guest) throw new AppError("Guest not found.", 404);
  const currentRsvp = await db().prepare("SELECT status, plus_ones FROM rsvps WHERE guest_id = ?").bind(guestId).first<{ status: string; plus_ones: number | string }>();
  const nextParty = patch.partySize ?? (Number(guest.party_size) || 1);
  const nextRsvp = patch.rsvp ?? currentRsvp?.status ?? "pending";
  const nextPlus = patch.plusOnes !== undefined ? patch.plusOnes : Number(currentRsvp?.plus_ones ?? 0);
  const nextTableId = patch.tableId !== undefined ? patch.tableId : guest.table_id;

  if (nextTableId) {
    await assertTableCapacity(eventId, nextTableId, seatsFor(nextParty, nextRsvp, nextPlus), [guestId]);
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    values.push(patch.name);
  }
  if (patch.email !== undefined) {
    sets.push("email = ?");
    values.push(patch.email);
  }
  if (patch.phone !== undefined) {
    sets.push("phone = ?");
    values.push(patch.phone);
  }
  if (patch.partySize !== undefined) {
    sets.push("party_size = ?");
    values.push(patch.partySize);
  }
  if (patch.tableId !== undefined) {
    sets.push("table_id = ?");
    values.push(patch.tableId);
    if (patch.tableId) {
      const table = await tableById(eventId, patch.tableId);
      sets.push("table_label = ?");
      values.push(table?.label ?? "");
    } else if (patch.table === undefined) {
      sets.push("table_label = ?");
      values.push("");
    }
  }
  if (patch.table !== undefined && patch.tableId === undefined) {
    sets.push("table_label = ?");
    values.push(patch.table);
  }
  if (patch.isMinor !== undefined) {
    sets.push("is_minor = ?");
    values.push(patch.isMinor);
  }
  if (sets.length) await db().prepare(`UPDATE guests SET ${sets.join(", ")} WHERE id = ? AND event_id = ?`).bind(...values, guestId, eventId).run();
  if (patch.rsvp) await hostSetRsvp(eventId, guestId, patch.rsvp);
  if (patch.plusOnes !== undefined || patch.note !== undefined) {
    await hostPatchRsvpDetails(eventId, guestId, { plusOnes: patch.plusOnes, note: patch.note });
  }
  return { id: guestId };
}

async function hostSetRsvp(eventId: string, guestId: string, status: "pending" | "yes" | "no") {
  const invitation = await ensureInvitation(eventId);
  const existing = await db().prepare("SELECT id FROM rsvps WHERE guest_id = ?").bind(guestId).first<{ id: string }>();
  if (existing) {
    await db().prepare("UPDATE rsvps SET status = ?, responded_at = CASE WHEN ? = 'pending' THEN responded_at ELSE now() END WHERE guest_id = ?").bind(status, status, guestId).run();
    return;
  }
  await db()
    .prepare("INSERT INTO rsvps (id, guest_id, invitation_id, status, responded_at) VALUES (?, ?, ?, ?, CASE WHEN ? = 'pending' THEN NULL ELSE now() END)")
    .bind(crypto.randomUUID(), guestId, invitation.id, status, status)
    .run();
}

async function hostPatchRsvpDetails(eventId: string, guestId: string, patch: { plusOnes?: number; note?: string }) {
  const invitation = await ensureInvitation(eventId);
  const existing = await db().prepare("SELECT id, plus_ones, note FROM rsvps WHERE guest_id = ?").bind(guestId).first<{ id: string; plus_ones: number | string; note: string }>();
  if (existing) {
    await db()
      .prepare("UPDATE rsvps SET plus_ones = ?, note = ? WHERE guest_id = ?")
      .bind(patch.plusOnes !== undefined ? patch.plusOnes : Number(existing.plus_ones), patch.note !== undefined ? patch.note : existing.note, guestId)
      .run();
    return;
  }
  await db()
    .prepare("INSERT INTO rsvps (id, guest_id, invitation_id, status, plus_ones, note) VALUES (?, ?, ?, 'pending', ?, ?)")
    .bind(crypto.randomUUID(), guestId, invitation.id, patch.plusOnes ?? 0, patch.note ?? "")
    .run();
}

export async function deleteGuest(eventId: string, guestId: string, actor: Actor) {
  const guest = await db().prepare("SELECT id, name FROM guests WHERE id = ? AND event_id = ?").bind(guestId, eventId).first<{ id: string; name: string }>();
  if (!guest) throw new AppError("Guest not found.", 404);
  await audit({
    actorEmail: actor.email,
    action: "guest_deleted",
    entity: "guests",
    subjectId: guestId,
    ip: actor.ip,
    before: { eventId, name: guest.name },
  });
  await db().prepare("DELETE FROM guests WHERE id = ? AND event_id = ?").bind(guestId, eventId).run();
}

function presentGuest(row: GuestRow, rsvp: RsvpRow | undefined, viewer: GuestListViewer) {
  const rsvpStatus = rsvp?.status ?? "pending";
  const plusOnes = Number(rsvp?.plus_ones ?? 0);
  const partySize = Number(row.party_size) || 1;
  const answers = jsonValue<{ questionId: string; value: string }[]>(rsvp?.answers, []);
  const base = {
    id: row.id,
    name: row.name,
    partySize,
    table: row.table_label || "",
    tableId: row.table_id,
    seats: seatsFor(partySize, rsvpStatus, plusOnes),
    isMinor: flag(row.is_minor),
    rsvp: rsvpStatus,
    plusOnes,
    note: rsvp?.note ?? "",
    checkedInAt: row.checked_in_at,
    answers: viewer.kind === "guest" ? [] : answers,
  };
  // Staff day-of view gets names/RSVP/notes/seating — not guest emails/phones.
  if (viewer.kind === "staff") {
    return { ...base, email: "", phone: "" };
  }
  if (viewer.kind === "guest") return { ...base, email: "", phone: "" };
  return { ...base, email: row.email, phone: row.phone, tokenIssued: Boolean(row.token_hash) };
}

export async function listGuests(eventId: string, viewer: GuestListViewer) {
  if (viewer.kind === "guest") throw new AppError("You don't have access to that.", 403);
  const guests = await db()
    .prepare(
      `SELECT id, event_id, name, email, phone, party_size, table_label, table_id, token_hash, checkin_code_hash, is_minor, checked_in_at
       FROM guests WHERE event_id = ? ORDER BY created_at ASC LIMIT 2000`,
    )
    .bind(eventId)
    .all<GuestRow>();
  const rsvps = await db()
    .prepare(
      `SELECT r.id, r.guest_id, r.status, r.note, r.plus_ones, r.answers
       FROM rsvps r JOIN guests g ON g.id = r.guest_id WHERE g.event_id = ?`,
    )
    .bind(eventId)
    .all<RsvpRow>();
  const byGuest = new Map(rsvps.results.map((row) => [row.guest_id, row]));
  return guests.results.map((row) => presentGuest(row, byGuest.get(row.id), viewer));
}

export async function invitationView(eventId: string, viewer: GuestListViewer) {
  const guests = await listGuests(eventId, viewer);
  const tables = await listTables(eventId);
  if (viewer.kind === "staff") return { guests, tables };
  const invitation = await ensureInvitation(eventId);
  const media = await db()
    .prepare(
      `SELECT m.id, m.status, m.file_id, f.filename, f.content_type, m.created_at
       FROM guest_media m JOIN stored_files f ON f.id = m.file_id
       WHERE m.event_id = ? ORDER BY m.created_at DESC LIMIT 200`,
    )
    .bind(eventId)
    .all();
  const jobs = await db()
    .prepare(
      `SELECT id, channel, kind, status, attempt_count, next_attempt_at, last_error, subject, to_address, sent_at
       FROM message_jobs WHERE event_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(eventId)
    .all();
  const shareUrl = invitation.published ? `/invite/${invitation.slug}` : "";
  return { invitation, guests, tables, media: media.results, jobs: jobs.results, shareUrl };
}

async function eventPublic(eventId: string) {
  return db()
    .prepare("SELECT name, event_type, event_date::text AS event_date, start_time, end_time FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ name: string; event_type: string; event_date: string | null; start_time: string; end_time: string }>();
}

export async function publicInvitation(slug: string, token = "") {
  const invitation = await loadBySlug(slug);
  if (!invitation || !invitation.published) throw new AppError("This invitation is not available.", 404);
  const guest = token ? await guestByToken(token) : null;
  if (token && (!guest || guest.event_id !== invitation.eventId)) throw new AppError("That invitation link is not valid.", 401);
  if (invitation.mode !== "public" && !guest) throw new AppError("This invitation needs your personal link.", 401);
  const event = await eventPublic(invitation.eventId);
  let own: { rsvp: string; plusOnes: number; answers: { questionId: string; value: string }[] } | null = null;
  if (guest) {
    const rsvp = await db().prepare("SELECT status, plus_ones, answers FROM rsvps WHERE guest_id = ?").bind(guest.id).first<RsvpRow>();
    own = {
      rsvp: rsvp?.status ?? "pending",
      plusOnes: Number(rsvp?.plus_ones ?? 0),
      answers: jsonValue(rsvp?.answers, []),
    };
  }
  return {
    slug: invitation.slug,
    title: invitation.title,
    message: invitation.message,
    mode: invitation.mode,
    published: true,
    plusOneCap: invitation.plusOneCap,
    rsvpDeadline: invitation.rsvpDeadline,
    involvesMinors: invitation.involvesMinors,
    theme: invitation.theme,
    questions: invitation.questions.map((question) => ({ id: question.id, label: question.label })),
    event: {
      name: event?.name ?? "",
      eventType: event?.event_type ?? "",
      eventDate: event?.event_date ?? "",
      startTime: event?.start_time ?? "",
      endTime: event?.end_time ?? "",
    },
    guest: own,
  };
}

export async function rsvp(token: string, input: unknown) {
  const body = parseInput(rsvpSchema, input);
  const guest = await guestByToken(token);
  if (!guest) throw new AppError("That invitation link is not valid.", 401);
  const invitation = await loadByEvent(guest.event_id);
  if (!invitation || !invitation.published) throw new AppError("This invitation is not published.", 403);
  if (invitation.rsvpDeadline && Date.parse(invitation.rsvpDeadline) < Date.now()) throw new AppError("The RSVP deadline has passed.", 400);
  const plusOnes = body.plusOnes ?? 0;
  const submittedAnswers = body.answers ?? [];
  if (plusOnes > invitation.plusOneCap) throw new AppError("That party is over the plus-one limit.", 400);
  const email = body.email?.trim() ?? "";
  const phone = body.phone?.trim() ?? "";
  if ((invitation.involvesMinors || flag(guest.is_minor)) && (email || phone)) {
    throw new AppError("Contact details are not collected for this invitation.", 400);
  }
  const known = new Set(invitation.questions.map((question) => question.id));
  const answers = submittedAnswers.map((answer) => {
    if (!known.has(answer.questionId)) throw new AppError("That question is not on this invitation.", 400);
    return { questionId: answer.questionId, value: answer.value.trim().slice(0, 500) };
  });
  const existing = await db().prepare("SELECT id FROM rsvps WHERE guest_id = ?").bind(guest.id).first<{ id: string }>();
  if (existing) {
    await db()
      .prepare("UPDATE rsvps SET status = ?, note = ?, plus_ones = ?, answers = ?::jsonb, responded_at = now() WHERE guest_id = ?")
      .bind(body.status, body.note, plusOnes, JSON.stringify(answers), guest.id)
      .run();
  } else {
    await db()
      .prepare("INSERT INTO rsvps (id, guest_id, invitation_id, status, note, plus_ones, answers, responded_at) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, now())")
      .bind(crypto.randomUUID(), guest.id, invitation.id, body.status, body.note, plusOnes, JSON.stringify(answers))
      .run();
  }
  return { ok: true };
}

export async function checkIn(secret: string, actor: Actor = { email: "guest-check-in" }) {
  if (!tokenShape(secret)) throw new AppError("That check-in link is not valid.", 401);
  const guest = await guestByHash(await sha256(secret));
  if (!guest) throw new AppError("That check-in link is not valid.", 401);
  const already = guest.checked_in_at;
  const row = await db()
    .prepare("UPDATE guests SET checked_in_at = COALESCE(checked_in_at, now()) WHERE id = ? RETURNING checked_in_at")
    .bind(guest.id)
    .first<{ checked_in_at: string }>();
  if (!row?.checked_in_at) throw new AppError("That check-in link is not valid.", 401);
  if (!already) {
    await audit({
      actorEmail: actor.email || "guest-check-in",
      action: "guest_checked_in",
      entity: "guests",
      subjectId: guest.id,
      ip: actor.ip,
      after: { eventId: guest.event_id, checkedInAt: row.checked_in_at },
    });
  }
  return { checkedInAt: row.checked_in_at, repeated: Boolean(already) };
}

export async function uploadGuestMedia(token: string, file: { bytes: Uint8Array; filename: string; contentType: string }) {
  const guest = await guestByToken(token);
  if (!guest) throw new AppError("That invitation link is not valid.", 401);
  const type = file.contentType.toLowerCase();
  if (type === "image/svg+xml" || (!type.startsWith("image/") && !type.startsWith("video/"))) throw new AppError("Upload a photo or video.", 400);
  const saved = await saveEventFile({
    bytes: file.bytes,
    filename: file.filename,
    contentType: type,
    kind: "guest_media",
    eventId: guest.event_id,
    actorEmail: "guest",
  });
  const id = crypto.randomUUID();
  await db().prepare("INSERT INTO guest_media (id, event_id, file_id, guest_id, status) VALUES (?, ?, ?, ?, 'pending')").bind(id, guest.event_id, saved.id, guest.id).run();
  return { id, fileId: saved.id, status: "pending" as const };
}

export async function reviewGuestMedia(eventId: string, mediaId: string, status: "approved" | "rejected", actor: Actor) {
  const row = await db().prepare("SELECT id, status FROM guest_media WHERE id = ? AND event_id = ?").bind(mediaId, eventId).first<{ id: string; status: string }>();
  if (!row) throw new AppError("Photo not found.", 404);
  await db().prepare("UPDATE guest_media SET status = ?, reviewed_at = now() WHERE id = ?").bind(status, mediaId).run();
  await audit({
    actorEmail: actor.email,
    action: status === "approved" ? "guest_media_approved" : "guest_media_rejected",
    entity: "guest_media",
    subjectId: mediaId,
    ip: actor.ip,
    before: { status: row.status },
    after: { eventId, status },
  });
  return { id: mediaId, status };
}

export async function gallery(eventId: string) {
  const rows = await db()
    .prepare(
      `SELECT m.id AS media_id, f.id AS file_id, f.filename, f.content_type
       FROM guest_media m JOIN stored_files f ON f.id = m.file_id
       WHERE m.event_id = ? AND m.status = 'approved'
       ORDER BY m.created_at ASC`,
    )
    .bind(eventId)
    .all<{ media_id: string; file_id: string; filename: string; content_type: string }>();
  return rows.results.map((row) => ({ mediaId: row.media_id, fileId: row.file_id, filename: row.filename, contentType: row.content_type }));
}

export async function publicGallery(slug: string, token = "") {
  const invitation = await loadBySlug(slug);
  if (!invitation || !invitation.published) throw new AppError("This invitation is not available.", 404);
  if (invitation.mode !== "public") {
    const guest = await guestByToken(token);
    if (!guest || guest.event_id !== invitation.eventId) throw new AppError("This invitation needs your personal link.", 401);
  }
  return gallery(invitation.eventId);
}

export async function readHostMedia(eventId: string, fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new AppError("File not found.", 404);
  const row = await db()
    .prepare(
      `SELECT f.filename, f.content_type, f.storage_key
       FROM guest_media m JOIN stored_files f ON f.id = m.file_id
       WHERE m.event_id = ? AND f.id = ? AND f.kind = 'guest_media'`,
    )
    .bind(eventId, fileId)
    .first<{ filename: string; content_type: string; storage_key: string }>();
  if (!row) throw new AppError("File not found.", 404);
  const { fileStore } = await import("@/lib/storage");
  const body = await fileStore().get(row.storage_key);
  if (!body) throw new AppError("File not found.", 404);
  return { filename: row.filename, contentType: row.content_type, bytes: body.bytes };
}

export async function readApprovedMedia(slug: string, fileId: string, token = "") {
  await publicGallery(slug, token);
  const row = await db()
    .prepare(
      `SELECT f.filename, f.content_type, f.storage_key
       FROM guest_media m
       JOIN stored_files f ON f.id = m.file_id
       JOIN invitations i ON i.event_id = m.event_id
       WHERE i.slug = ? AND f.id = ? AND m.status = 'approved' AND i.published = true`,
    )
    .bind(slug, fileId)
    .first<{ filename: string; content_type: string; storage_key: string }>();
  if (!row) throw new AppError("File not found.", 404);
  const { fileStore } = await import("@/lib/storage");
  const body = await fileStore().get(row.storage_key);
  if (!body) throw new AppError("File not found.", 404);
  return { filename: row.filename, contentType: row.content_type, bytes: body.bytes };
}

export async function scheduleMessage(eventId: string, input: unknown) {
  const body = parseInput(messageSchema, input);
  if (Number.isNaN(Date.parse(body.nextAttemptAt))) throw new AppError("Choose when to send this.", 400);
  await ensureInvitation(eventId);
  if (body.guestId) {
    const guest = await db().prepare("SELECT id FROM guests WHERE id = ? AND event_id = ?").bind(body.guestId, eventId).first<{ id: string }>();
    if (!guest) throw new AppError("Guest not found.", 404);
  }
  const id = crypto.randomUUID();
  await db()
    .prepare(
      `INSERT INTO message_jobs (id, event_id, guest_id, channel, kind, status, attempt_count, next_attempt_at, to_address, subject, body)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    )
    .bind(id, eventId, body.guestId ?? null, body.channel, body.kind, new Date(body.nextAttemptAt).toISOString(), body.to, body.subject, body.body)
    .run();
  return { id };
}

function smsConfigured() {
  return Boolean(process.env.MB_SMS_ACCOUNT_SID?.trim() && process.env.MB_SMS_AUTH_TOKEN?.trim() && process.env.MB_SMS_FROM?.trim());
}

function smsApprovedEnv() {
  return (process.env.MB_SMS_ENABLED ?? "").trim().toLowerCase() === "true" && smsConfigured();
}

async function sendSms(to: string, body: string) {
  if (!smsApprovedEnv()) return { ok: false, error: "SMS is not configured" };
  const sid = process.env.MB_SMS_ACCOUNT_SID!.trim();
  const auth = process.env.MB_SMS_AUTH_TOKEN!.trim();
  const from = process.env.MB_SMS_FROM!.trim();
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${sid}:${auth}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: "SMS send failed" };
    return { ok: true, error: "" };
  } catch {
    return { ok: false, error: "SMS send failed" };
  }
}

async function deliver(job: { id: string; channel: string; to_address: string; subject: string; body: string; event_id?: string }) {
  if (job.channel === "sms") {
    if (!smsApprovedEnv()) return { ok: false, error: "SMS is not configured" };
    return sendSms(job.to_address, job.body);
  }
  if (!integrationFlags().email) return { ok: false, error: "Email is not configured" };
  if (!job.to_address.includes("@")) return { ok: false, error: "Email send failed" };
  const { notifyInviteDelivery } = await import("@/lib/communications");
  const result = await notifyInviteDelivery({
    eventId: job.event_id || "",
    email: job.to_address,
    subject: job.subject,
    body: job.body,
    jobId: job.id,
    origin: process.env.MB_PUBLIC_ORIGIN ?? "",
  });
  return result.sent ? { ok: true, error: "" } : { ok: false, error: "Email send failed" };
}

export async function runDueMessageJobs(eventId?: string) {
  const due = eventId
    ? await db().prepare("SELECT id FROM message_jobs WHERE status = 'pending' AND next_attempt_at <= now() AND event_id = ? ORDER BY next_attempt_at ASC LIMIT 25").bind(eventId).all<{ id: string }>()
    : await db().prepare("SELECT id FROM message_jobs WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at ASC LIMIT 25").all<{ id: string }>();
  const results: { id: string; status: string; attemptCount: number; lastError: string; sentAt: string | null }[] = [];
  for (const job of due.results) {
    const claimed = await db()
      .prepare(
        `UPDATE message_jobs
         SET attempt_count = attempt_count + 1, next_attempt_at = now() + interval '5 minutes'
         WHERE id = ? AND status = 'pending' AND next_attempt_at <= now()
         RETURNING id, attempt_count, channel, to_address, subject, body, event_id`,
      )
      .bind(job.id)
      .first<{ id: string; attempt_count: number; channel: string; to_address: string; subject: string; body: string; event_id: string }>();
    if (!claimed) continue;
    let result: { ok: boolean; error: string };
    try {
      result = await deliver(claimed);
    } catch {
      result = { ok: false, error: claimed.channel === "sms" ? "SMS is not configured" : "Email send failed" };
    }
    if (result.ok) {
      await db().prepare("UPDATE message_jobs SET status = 'sent', sent_at = now(), last_error = '' WHERE id = ? AND status = 'pending'").bind(job.id).run();
    } else {
      const delayMin = Math.min(360, 5 * 2 ** (Number(claimed.attempt_count) - 1));
      const status = Number(claimed.attempt_count) >= MAX_ATTEMPTS ? "failed" : "pending";
      await db()
        .prepare("UPDATE message_jobs SET status = ?, last_error = ?, next_attempt_at = now() + make_interval(mins => ?), sent_at = NULL WHERE id = ? AND status <> 'sent'")
        .bind(status, result.error, delayMin, job.id)
        .run();
    }
    const saved = await db()
      .prepare("SELECT status, attempt_count, last_error, sent_at FROM message_jobs WHERE id = ?")
      .bind(job.id)
      .first<{ status: string; attempt_count: number; last_error: string; sent_at: string | null }>();
    if (saved) results.push({ id: job.id, status: saved.status, attemptCount: Number(saved.attempt_count), lastError: saved.last_error, sentAt: saved.sent_at });
  }
  return { results };
}

export async function storeInviteSongRequest(token: string, input: { title: string; artist: string; note: string }) {
  const guest = await guestByToken(token);
  if (!guest) throw new AppError("That guest link is not valid.", 401);
  const planner = await db()
    .prepare("SELECT id, admin_data FROM planner_events WHERE event_id = ?")
    .bind(guest.event_id)
    .first<{ id: string; admin_data: unknown }>();
  if (!planner) throw new AppError("Song requests are not open for this event.", 404);
  const admin = adminDataSchema.parse(jsonValue(planner.admin_data, {}));
  if (!admin.guestRequestsOpen) throw new AppError("Song requests are closed for this event.", 403);
  const count = await db().prepare("SELECT CAST(COUNT(*) AS integer) AS n FROM planner_guest_requests WHERE event_id = ?").bind(planner.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 500) throw new AppError("This event has reached its request limit.", 429);
  await db()
    .prepare("INSERT INTO planner_guest_requests (id, event_id, created_at, guest_name, title, artist, note, status, invite_guest_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
    .bind(crypto.randomUUID(), planner.id, new Date().toISOString(), guest.name, input.title, input.artist, input.note, guest.id)
    .run();
  return { eventId: guest.event_id, plannerId: planner.id };
}

export async function inviteSongView(token: string) {
  const guest = await guestByToken(token);
  if (!guest) throw new AppError("That guest link is not valid.", 401);
  const planner = await db()
    .prepare("SELECT id, data, admin_data FROM planner_events WHERE event_id = ?")
    .bind(guest.event_id)
    .first<{ id: string; data: unknown; admin_data: unknown }>();
  const event = await eventPublic(guest.event_id);
  const data = jsonValue<{ details?: { eventType?: string; clientNames?: string; eventDate?: string } }>(planner?.data, {});
  const admin = adminDataSchema.parse(jsonValue(planner?.admin_data, {}));
  const requests = planner
    ? await db()
        .prepare("SELECT title, artist, status FROM planner_guest_requests WHERE event_id = ? AND invite_guest_id = ? ORDER BY created_at DESC LIMIT 100")
        .bind(planner.id, guest.id)
        .all<{ title: string; artist: string; status: string }>()
    : { results: [] };
  return {
    guestCode: "",
    eventType: data.details?.eventType || event?.event_type || "",
    clientNames: data.details?.clientNames || event?.name || "",
    eventDate: data.details?.eventDate || event?.event_date || "",
    open: Boolean(planner) && admin.guestRequestsOpen,
    requests: requests.results,
  };
}

function presentTable(row: TableRow, seated: number) {
  const capacity = Number(row.capacity);
  return {
    id: row.id,
    label: row.label,
    capacity,
    seated,
    remaining: Math.max(0, capacity - seated),
    sortOrder: Number(row.sort_order),
    posX: Number(row.pos_x),
    posY: Number(row.pos_y),
  };
}

export async function listTables(eventId: string) {
  const rows = await db()
    .prepare("SELECT id, event_id, label, capacity, sort_order, pos_x, pos_y FROM event_tables WHERE event_id = ? ORDER BY sort_order, label")
    .bind(eventId)
    .all<TableRow>();
  const guests = await db()
    .prepare(
      `SELECT g.id, g.table_id, g.party_size, COALESCE(r.status, 'pending') AS rsvp, COALESCE(r.plus_ones, 0) AS plus_ones
       FROM guests g LEFT JOIN rsvps r ON r.guest_id = g.id
       WHERE g.event_id = ?`,
    )
    .bind(eventId)
    .all<{ id: string; table_id: string | null; party_size: number | string; rsvp: string; plus_ones: number | string }>();
  const seatedByTable = new Map<string, number>();
  for (const guest of guests.results) {
    if (!guest.table_id) continue;
    const seats = seatsFor(Number(guest.party_size) || 1, guest.rsvp, Number(guest.plus_ones) || 0);
    seatedByTable.set(guest.table_id, (seatedByTable.get(guest.table_id) ?? 0) + seats);
  }
  return rows.results.map((row) => presentTable(row, seatedByTable.get(row.id) ?? 0));
}

export async function createTable(eventId: string, input: unknown) {
  await ensureInvitation(eventId);
  const body = parseInput(tableSchema, input);
  const count = await db().prepare("SELECT count(*)::int AS n FROM event_tables WHERE event_id = ?").bind(eventId).first<{ n: number }>();
  const id = crypto.randomUUID();
  const sortOrder = Number(count?.n ?? 0);
  const capacity = body.capacity ?? 8;
  const posX = body.posX || (sortOrder % 4) * 180;
  const posY = body.posY || Math.floor(sortOrder / 4) * 140;
  try {
    await db()
      .prepare(
        `INSERT INTO event_tables (id, event_id, label, capacity, sort_order, pos_x, pos_y)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, eventId, body.label, capacity, sortOrder, posX, posY)
      .run();
  } catch (error) {
    if (isUnique(error)) throw new AppError("A table with that name already exists.", 409);
    throw error;
  }
  return presentTable({ id, event_id: eventId, label: body.label, capacity, sort_order: sortOrder, pos_x: posX, pos_y: posY }, 0);
}

export async function updateTable(eventId: string, tableId: string, input: unknown) {
  const patch = parseInput(tablePatchSchema, input);
  const table = await tableById(eventId, tableId);
  if (!table) throw new AppError("Table not found.", 404);
  const capacity = patch.capacity ?? Number(table.capacity);
  const seated = await occupiedSeats(eventId, tableId);
  if (capacity < seated) throw new AppError(`Capacity cannot be below the ${seated} seats already assigned.`, 409);
  const label = patch.label ?? table.label;
  const sets = ["label = ?", "capacity = ?", "pos_x = ?", "pos_y = ?", "sort_order = ?"];
  const values = [
    label,
    capacity,
    patch.posX ?? Number(table.pos_x),
    patch.posY ?? Number(table.pos_y),
    patch.sortOrder ?? Number(table.sort_order),
  ];
  try {
    await db().prepare(`UPDATE event_tables SET ${sets.join(", ")} WHERE id = ? AND event_id = ?`).bind(...values, tableId, eventId).run();
  } catch (error) {
    if (isUnique(error)) throw new AppError("A table with that name already exists.", 409);
    throw error;
  }
  await db().prepare("UPDATE guests SET table_label = ? WHERE table_id = ? AND event_id = ?").bind(label, tableId, eventId).run();
  return presentTable({
    id: tableId,
    event_id: eventId,
    label,
    capacity,
    sort_order: patch.sortOrder ?? Number(table.sort_order),
    pos_x: patch.posX ?? Number(table.pos_x),
    pos_y: patch.posY ?? Number(table.pos_y),
  }, seated);
}

export async function deleteTable(eventId: string, tableId: string) {
  const table = await tableById(eventId, tableId);
  if (!table) throw new AppError("Table not found.", 404);
  await db().batch([
    db().prepare("UPDATE guests SET table_id = NULL, table_label = '' WHERE table_id = ? AND event_id = ?").bind(tableId, eventId),
    db().prepare("DELETE FROM event_tables WHERE id = ? AND event_id = ?").bind(tableId, eventId),
  ]);
  return { ok: true };
}

export async function assignGuestsToTable(eventId: string, input: unknown) {
  const body = parseInput(assignSchema, input);
  const guests = await listGuests(eventId, { kind: "office" });
  const selected = guests.filter((guest) => body.guestIds.includes(guest.id));
  if (selected.length !== body.guestIds.length) throw new AppError("One or more guests were not found.", 404);
  if (body.tableId) {
    const needed = selected.reduce((sum, guest) => sum + seatsFor(guest.partySize, guest.rsvp, guest.plusOnes), 0);
    await assertTableCapacity(eventId, body.tableId, needed, body.guestIds);
    const table = await tableById(eventId, body.tableId);
    if (!table) throw new AppError("Table not found.", 404);
    for (const guest of selected) {
      await db()
        .prepare("UPDATE guests SET table_id = ?, table_label = ? WHERE id = ? AND event_id = ?")
        .bind(body.tableId, table.label, guest.id, eventId)
        .run();
    }
  } else {
    for (const guest of selected) {
      await db()
        .prepare("UPDATE guests SET table_id = NULL, table_label = '' WHERE id = ? AND event_id = ?")
        .bind(guest.id, eventId)
        .run();
    }
  }
  return { ok: true, tables: await listTables(eventId), guests: await listGuests(eventId, { kind: "office" }) };
}
