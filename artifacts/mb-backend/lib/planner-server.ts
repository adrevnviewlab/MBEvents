import { env } from "@/lib/env";
import { RateLimitError } from "@/lib/rate-limit";
import { hasAllowedWriteOrigin } from "@/lib/request-origin";
import { adminDataSchema, autoCheck, CLIENT_COOKIE, GUEST_COOKIE, guestSongId, readCookie, sha256, type AdminData, type PlannerData } from "@/lib/planner";

export type EventRow = {
  id: string;
  created_at: string;
  updated_at: string;
  code: string;
  password_hash: string;
  guest_code: string;
  guest_password: string;
  lead_id: string | null;
  data: string;
  admin_data: string;
  failed_logins: number;
  locked_until: string | null;
};

export const SESSION_DAYS = { client: 30, guest: 2 } as const;

export function db() {
  if (!env.DB) throw new PlannerError("The planner database is not configured.", 503);
  return env.DB;
}

export class PlannerError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function fail(error: unknown) {
  if (error instanceof RateLimitError) return Response.json({ error: error.message }, { status: 429 });
  if (error instanceof PlannerError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Planner request failed", error);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export function assertWriteOrigin(request: Request) {
  if (!hasAllowedWriteOrigin(request)) throw new PlannerError("Invalid request origin.", 403);
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new PlannerError("Invalid request.");
  }
}

export function parseEvent(row: EventRow) {
  return {
    row,
    data: JSON.parse(row.data) as PlannerData,
    admin: adminDataSchema.parse(JSON.parse(row.admin_data)) as AdminData,
  };
}

export async function createSession(eventId: string, kind: "client" | "guest") {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "").slice(0, 48);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS[kind] * 864e5);
  await db()
    .prepare("INSERT INTO planner_sessions (token_hash, event_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), eventId, kind, now.toISOString(), expires.toISOString())
    .run();
  return { token, maxAge: SESSION_DAYS[kind] * 86400 };
}

export async function sessionEvent(request: Request, kind: "client" | "guest") {
  const token = readCookie(request, kind === "client" ? CLIENT_COOKIE : GUEST_COOKIE);
  if (!token) throw new PlannerError("Please sign in.", 401);
  const row = await db()
    .prepare("SELECT e.* FROM planner_sessions s JOIN planner_events e ON e.id = s.event_id WHERE s.token_hash = ? AND s.kind = ? AND s.expires_at > ?")
    .bind(await sha256(token), kind, new Date().toISOString())
    .first<EventRow>();
  if (!row) throw new PlannerError("Your session has expired. Please sign in again.", 401);
  return parseEvent(row);
}

export async function endSession(request: Request, kind: "client" | "guest") {
  const token = readCookie(request, kind === "client" ? CLIENT_COOKIE : GUEST_COOKIE);
  if (token) await db().prepare("DELETE FROM planner_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

// Merges only the given top-level keys (`jsonb || patch`) in one statement, so concurrent
// saves of different sections (or admin fields) never overwrite each other.
export async function saveEvent(id: string, fields: { data?: Partial<PlannerData>; admin?: Partial<AdminData> }) {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const add = (column: "data" | "admin_data", patch: object | undefined) => {
    if (!patch || !Object.keys(patch).length) return;
    const json = JSON.stringify(patch);
    if (json.length > MAX_DOC_BYTES) throw new PlannerError("That is too much to save at once.", 413);
    sets.push(`${column} = ${column} || ?::jsonb`);
    values.push(json);
  };
  add("data", fields.data);
  add("admin_data", fields.admin);
  try {
    await db().prepare(`UPDATE planner_events SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id).run();
  } catch (error) {
    // planner_events_size_check: the stored document would exceed the database limit.
    if (String(error).includes("size_check")) throw new PlannerError("Your planner is too large to save.", 413);
    throw error;
  }
}

const MAX_DOC_BYTES = 900_000;

export async function eventExtras(eventId: string) {
  const [requests, messages] = await Promise.all([
    db().prepare("SELECT id, created_at, guest_name, title, artist, note, status FROM planner_guest_requests WHERE event_id = ? ORDER BY created_at DESC LIMIT 500").bind(eventId).all(),
    db().prepare("SELECT id, created_at, sender, body, read_at FROM planner_messages WHERE event_id = ? ORDER BY created_at ASC LIMIT 500").bind(eventId).all(),
  ]);
  return { requests: requests.results, messages: messages.results };
}

const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

// Checks a code/password pair with per-account lockout after repeated failures.
export async function checkLogin(codeColumn: "code" | "guest_code", code: string, verify: (row: EventRow) => Promise<boolean>) {
  const row = await db().prepare(`SELECT * FROM planner_events WHERE ${codeColumn} = ?`).bind(code).first<EventRow>();
  const invalid = new PlannerError("That code and password don't match.", 401);
  if (!row) throw invalid;
  if (row.locked_until && row.locked_until > new Date().toISOString()) throw new PlannerError("Too many attempts. Try again in 15 minutes.", 429);
  if (!(await verify(row))) {
    const failures = row.failed_logins + 1;
    const lock = failures >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await db().prepare("UPDATE planner_events SET failed_logins = ?, locked_until = ? WHERE id = ?").bind(lock ? 0 : failures, lock, row.id).run();
    throw invalid;
  }
  if (row.failed_logins || row.locked_until) await db().prepare("UPDATE planner_events SET failed_logins = 0, locked_until = NULL WHERE id = ?").bind(row.id).run();
  return row;
}

// Client-facing view: strips credentials and unsent documents.
export function clientView(event: ReturnType<typeof parseEvent>, extras: Awaited<ReturnType<typeof eventExtras>>) {
  const { row, data, admin } = event;
  return {
    code: row.code,
    guestCode: row.guest_code,
    guestPassword: row.guest_password,
    data,
    admin: { ...admin, documents: admin.documents.filter((d) => d.status !== "draft") },
    requests: extras.requests,
    messages: extras.messages,
    paymentsOnline: Boolean((env as unknown as { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY),
  };
}

// Saves the given admin fields and ticks any checklist items they now satisfy.
export async function saveAdminWithAutoCheck(event: ReturnType<typeof parseEvent>, patch: Partial<AdminData>) {
  const ticked = autoCheck(event.data, { ...event.admin, ...patch });
  await saveEvent(event.row.id, { admin: patch, data: ticked ? { checklist: ticked.checklist } : undefined });
}

// Saves one client section; re-applies automatic checklist ticks so a stale tab can't untick them.
export async function saveSection<K extends keyof PlannerData>(event: ReturnType<typeof parseEvent>, section: K, value: PlannerData[K]) {
  const ticked = autoCheck({ ...event.data, [section]: value }, event.admin);
  await saveEvent(event.row.id, { data: { [section]: value, ...(ticked ? { checklist: ticked.checklist } : {}) } });
}

type RequestRow = { id: string; guest_name: string; title: string; artist: string; status: string };

// Keeps the music list in step with a guest request's status.
export async function syncGuestSong(eventId: string, requestId: string) {
  const row = await db().prepare("SELECT * FROM planner_events WHERE id = ?").bind(eventId).first<EventRow>();
  const request = await db().prepare("SELECT id, guest_name, title, artist, status FROM planner_guest_requests WHERE id = ? AND event_id = ?").bind(requestId, eventId).first<RequestRow>();
  if (!row) return;
  const event = parseEvent(row);
  const id = guestSongId(requestId);
  const without = event.data.songs.filter((s) => s.id !== id);
  const songs = request?.status === "approved"
    ? [...without, event.data.songs.find((s) => s.id === id) ?? { id, title: request.title, artist: request.artist, kind: "Play if possible" as const, moment: "", note: `Guest request from ${request.guest_name}` }]
    : without;
  if (songs.length !== event.data.songs.length || songs.some((s, i) => s.id !== event.data.songs[i]?.id)) {
    await saveEvent(eventId, { data: { songs } });
  }
}

// A client's music save from a stale tab must not drop songs that came from approved guest requests.
export async function keepApprovedGuestSongs(eventId: string, current: PlannerData["songs"], incoming: PlannerData["songs"]) {
  const missing = current.filter((s) => s.id.startsWith("guest-") && !incoming.some((i) => i.id === s.id));
  if (!missing.length) return incoming;
  const approved = await db().prepare("SELECT id FROM planner_guest_requests WHERE event_id = ? AND status = 'approved'").bind(eventId).all<{ id: string }>();
  const keep = new Set(approved.results.map((r) => guestSongId(r.id)));
  return [...incoming, ...missing.filter((s) => keep.has(s.id))];
}
