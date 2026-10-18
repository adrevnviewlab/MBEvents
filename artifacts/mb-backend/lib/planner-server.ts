import { assertCan } from "@/lib/authz";
import { devAuthOpen } from "@/lib/config";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { syncEventVendors } from "@/lib/places";
import { eventLedger } from "@/lib/finance";
import { syncEventDetails } from "@/lib/records";
import { RateLimitError } from "@/lib/rate-limit";
import { hasAllowedWriteOrigin } from "@/lib/request-origin";
import { clientVisibleAdmin, omitHiddenFields } from "@/lib/planning-templates";
import { clientVisibleTimeline, mergeClientTimeline, type TimelineItem } from "@/lib/timeline";
import { adminDataSchema, autoCheck, checklistProgress, CLIENT_COOKIE, countdownDays, GUEST_COOKIE, guestAccessToken, guestRequestPath, guestSongId, readCookie, sha256, totals, type AdminData, type PlannerData } from "@/lib/planner";

export type EventRow = {
  id: string;
  created_at: string;
  updated_at: string;
  code: string;
  password_hash: string;
  guest_code: string;
  guest_password: string;
  guest_access_token: string | null;
  lead_id: string | null;
  event_id: string | null;
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

export class PlannerError extends AppError {
  constructor(message: string, status = 400) {
    super(message, status);
  }
}

export function fail(error: unknown) {
  if (error instanceof RateLimitError) return Response.json({ error: error.message }, { status: 429 });
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
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

async function openDevelopmentEvent(request: Request) {
  if (!devAuthOpen()) return null;
  const requested = requestedEventId(request);
  const row = requested
    ? await db().prepare("SELECT * FROM planner_events WHERE id = ? OR event_id = ? ORDER BY created_at DESC LIMIT 1").bind(requested, requested).first<EventRow>()
    : await db().prepare("SELECT * FROM planner_events ORDER BY created_at DESC LIMIT 1").first<EventRow>();
  return row ? parseEvent(row) : null;
}

export async function sessionEvent(request: Request, kind: "client" | "guest") {
  const token = readCookie(request, kind === "client" ? CLIENT_COOKIE : GUEST_COOKIE);
  if (!token) {
    const open = await openDevelopmentEvent(request);
    if (open) return open;
    throw new PlannerError("Please sign in.", 401);
  }
  const row = await db()
    .prepare("SELECT e.* FROM planner_sessions s JOIN planner_events e ON e.id = s.event_id WHERE s.token_hash = ? AND s.kind = ? AND s.expires_at > ?")
    .bind(await sha256(token), kind, new Date().toISOString())
    .first<EventRow>();
  if (!row) {
    const open = await openDevelopmentEvent(request);
    if (open) return open;
    throw new PlannerError("Your session has expired. Please sign in again.", 401);
  }
  assertCan(kind === "client" ? "client" : "guest", kind === "client" ? "portal.client" : "portal.guest");
  const event = parseEvent(row);
  assertOwnEvent(event, requestedEventId(request));
  return event;
}

// Local development accepts an event or guest code with no password.
export async function eventByCode(codeColumn: "code" | "guest_code", code: string) {
  const row = await db().prepare(`SELECT * FROM planner_events WHERE ${codeColumn} = ?`).bind(code).first<EventRow>();
  if (!row) throw new PlannerError("That code doesn't match.", 401);
  return row;
}

export function requestedEventId(request: Request) {
  const url = new URL(request.url);
  for (const key of ["event", "eventId"]) {
    const value = url.searchParams.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

export function assertOwnEvent(event: { row: { id: string; event_id: string | null } }, requested: string | null | undefined) {
  if (!requested) return;
  if (requested !== event.row.id && requested !== event.row.event_id) throw new PlannerError("Event not found.", 404);
}

export function assertBodyEvent(event: { row: { id: string; event_id: string | null } }, body: unknown) {
  if (!body || typeof body !== "object") return;
  const record = body as { eventId?: unknown; event?: unknown };
  const requested = typeof record.eventId === "string" ? record.eventId : typeof record.event === "string" ? record.event : null;
  assertOwnEvent(event, requested);
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

// Fills a guest link token once. A concurrent request that wins the write is kept.
export async function ensureGuestToken(row: EventRow) {
  if (row.guest_access_token) return row.guest_access_token;
  const token = guestAccessToken();
  await db().prepare("UPDATE planner_events SET guest_access_token = ? WHERE id = ? AND guest_access_token IS NULL").bind(token, row.id).run();
  const saved = await db().prepare("SELECT guest_access_token FROM planner_events WHERE id = ?").bind(row.id).first<{ guest_access_token: string | null }>();
  row.guest_access_token = saved?.guest_access_token || token;
  return row.guest_access_token;
}

export function guestAccessFields(row: EventRow) {
  const guestToken = row.guest_access_token ?? "";
  return { guestToken, guestPath: guestToken ? guestRequestPath(guestToken) : "" };
}

export function guestPortalPayload(event: ReturnType<typeof parseEvent>, requests: { title: string; artist: string; status: string }[]) {
  const { row, data, admin } = event;
  return omitHiddenFields({
    guestCode: row.guest_code,
    eventType: data.details.eventType,
    clientNames: data.details.clientNames,
    eventDate: data.details.eventDate,
    open: admin.guestRequestsOpen,
    requests,
  });
}

export type ClientMoney = {
  total: number;
  paid: number;
  balance: number;
  source?: "ledger" | "planner";
  schedule?: { id: string; label: string; amount: number; dueOn: string | null; status: string; method: string }[];
  proposal?: { status: string; title: string } | null;
  pendingKind?: string | null;
};
export type ClientDeadline = { id: string; title: string; dueOn: string | null; done: boolean };

function moneyFromAdmin(admin: AdminData): ClientMoney {
  const t = totals(admin);
  return { total: t.total, paid: t.paid, balance: t.balance, source: "planner" };
}

// Ledger when a quote or payment row exists. Otherwise the planner document.
// JSON payment amounts are not added to ledger payments.
export async function clientMoney(eventId: string | null, admin: AdminData): Promise<ClientMoney> {
  if (!eventId) return moneyFromAdmin(admin);
  const ledger = await eventLedger(eventId);
  if (!ledger.hasLedger) return moneyFromAdmin(admin);
  return {
    total: ledger.invoiceTotalCents / 100,
    paid: ledger.paidCents / 100,
    balance: ledger.balanceCents / 100,
    source: "ledger",
    schedule: ledger.payments.filter((row) => row.status !== "void").map((row) => ({
      id: row.id,
      label: row.label,
      amount: row.amountCents / 100,
      dueOn: row.dueOn,
      status: row.status,
      method: row.method,
    })),
    proposal: ledger.proposal ? { status: ledger.proposal.status, title: ledger.proposal.title } : null,
    pendingKind: ledger.pendingVersion?.kind ?? null,
  };
}

export async function clientDeadlines(eventId: string | null): Promise<ClientDeadline[]> {
  if (!eventId) return [];
  const rows = await db()
    .prepare("SELECT id, title, due_on, done FROM tasks WHERE event_id = ? AND client_visible = true ORDER BY due_on NULLS LAST, title LIMIT 100")
    .bind(eventId)
    .all<{ id: string; title: string; due_on: string | null; done: boolean }>();
  return rows.results.map((row) => ({ id: row.id, title: row.title, dueOn: row.due_on, done: Boolean(row.done) }));
}

// Client-facing view: one event, no internal notes, rates, cost, margin, or guest passwords.
export function clientView(event: ReturnType<typeof parseEvent>, extras: Awaited<ReturnType<typeof eventExtras>>, planning?: { budget?: ClientMoney; deadlines?: ClientDeadline[] }) {
  const { row, data, admin } = event;
  const budget = planning?.budget ?? moneyFromAdmin(admin);
  const clientData = omitHiddenFields({
    ...data,
    timeline: clientVisibleTimeline((data.timeline || []) as TimelineItem[]),
  });
  return omitHiddenFields({
    code: row.code,
    guestCode: row.guest_code,
    // Guest song requests use the revocable link token. Passwords are never returned to the client.
    ...guestAccessFields(row),
    eventId: row.event_id,
    data: clientData,
    admin: clientVisibleAdmin(admin),
    requests: extras.requests,
    messages: extras.messages,
    paymentsOnline: Boolean((env as unknown as { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY),
    progress: checklistProgress(data.checklist ?? []),
    countdown: countdownDays(data.details?.eventDate),
    budget: { ...budget, clientBudget: data.details?.clientBudget ?? "" },
    deadlines: planning?.deadlines ?? [],
  });
}

// Saves the given admin fields and ticks any checklist items they now satisfy.
export async function saveAdminWithAutoCheck(event: ReturnType<typeof parseEvent>, patch: Partial<AdminData>) {
  const ticked = autoCheck(event.data, { ...event.admin, ...patch });
  await saveEvent(event.row.id, { admin: patch, data: ticked ? { checklist: ticked.checklist } : undefined });
}

// Saves one client section; re-applies automatic checklist ticks so a stale tab can't untick them.
export async function saveSection<K extends keyof PlannerData>(event: ReturnType<typeof parseEvent>, section: K, value: PlannerData[K]) {
  let nextValue = value;
  if (section === "timeline") {
    nextValue = mergeClientTimeline(
      (event.data.timeline || []) as TimelineItem[],
      (value as TimelineItem[]),
    ) as PlannerData[K];
  }
  const ticked = autoCheck({ ...event.data, [section]: nextValue }, event.admin);
  if (section === "details" && event.row.event_id) await syncEventDetails(event.row.event_id, nextValue as PlannerData["details"]);
  await saveEvent(event.row.id, { data: { [section]: nextValue, ...(ticked ? { checklist: ticked.checklist } : {}) } });
  if (section === "team" && event.row.event_id) await syncEventVendors(event.row.event_id, nextValue as PlannerData["team"]);
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
