import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatInfoBits, qrSvg } from "../lib/qr.ts";
import { sha256 } from "../lib/planner.ts";

process.env.DATABASE_URL = "pglite:memory";
process.env.MB_FILE_STORAGE = "local";
const fileDir = await mkdtemp(join(tmpdir(), "mb-invite-files-"));
process.env.MB_FILE_DIR = fileDir;
delete process.env.RESEND_API_KEY;
delete process.env.MB_FROM_EMAIL;
delete process.env.MB_SMS_ACCOUNT_SID;
delete process.env.MB_SMS_AUTH_TOKEN;
delete process.env.MB_SMS_FROM;

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

async function throws(run: () => Promise<unknown>) {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
}

check("qr format bits", formatInfoBits(0) === 0x77c4, formatInfoBits(0).toString(16));

const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const invites = await import("../lib/invites.ts");
const db = getDatabase();
if (!db) throw new Error("database did not open");

const email = "secret-guest@example.com";
const phone = "555-0100-SECRET";
const customerId = await ensureCustomer({ name: "Ada", email: "ada-invites@example.com", phone: "555" });
const beforeOpt = await db.prepare("SELECT marketing_opt_in FROM customers WHERE id = ?").bind(customerId).first<{ marketing_opt_in: boolean | null }>();
const eventId = crypto.randomUUID();
await createEventRecord({ id: eventId, customerId, name: "Ada Wedding", eventType: "Wedding", eventDate: "2030-06-01" });
const beforeEvents = await db.prepare("SELECT COUNT(*)::int AS count FROM events").first<{ count: number }>();
const invitation = await invites.ensureInvitation(eventId);
await invites.ensureInvitation(eventId);
const afterEvents = await db.prepare("SELECT COUNT(*)::int AS count FROM events").first<{ count: number }>();
const eventRows = await db.prepare("SELECT COUNT(*)::int AS count FROM events WHERE id = ?").bind(eventId).first<{ count: number }>();
const inviteRows = await db.prepare("SELECT COUNT(*)::int AS count FROM invitations WHERE event_id = ?").bind(eventId).first<{ count: number }>();
check(
  "creating an invitation links it to one event and does not create a second event",
  afterEvents?.count === beforeEvents?.count && invitation.eventId === eventId && eventRows?.count === 1 && inviteRows?.count === 1,
  `events ${beforeEvents?.count}->${afterEvents?.count}`,
);

const created = await invites.addGuest(eventId, { name: "Jordan", email, phone, partySize: 2 }, "https://mb.example");
const stored = await db.prepare("SELECT token_hash FROM guests WHERE id = ?").bind(created.id).first<{ token_hash: string }>();
check("guest token is stored only as a hash", stored?.token_hash === (await sha256(created.token)) && stored?.token_hash !== created.token);
const link = created.checkInUrl;
check("check-in url uses the check-in code not the invite token", link.includes(created.checkInCode) && !link.includes(`t=${created.token}`));
check("check-in url has no guest email, phone, or name", !link.includes(email) && !link.includes(phone) && !link.includes("Jordan") && link.includes("/invite/check-in"));
check("qr image does not contain contact details", !qrSvg(link).includes(email) && !qrSvg(link).includes(phone) && qrSvg(link).startsWith("<svg"));

const actor = { email: "host@example.com" };
check("unpublished invite rejects RSVP", await throws(() => invites.rsvp(created.token, { status: "yes", plusOnes: 0 })));
await invites.saveInvitation(eventId, { published: true, plusOneCap: 1, mode: "public" }, actor);
check("RSVP with the wrong token is rejected", await throws(() => invites.rsvp(invites.checkInUrl("", "not-a-guest-token-000000000000000000"), { status: "yes", plusOnes: 0 })) && await throws(() => invites.rsvp("a".repeat(43), { status: "yes", plusOnes: 0 })));
const none = await db.prepare("SELECT COUNT(*)::int AS count FROM rsvps WHERE guest_id = ?").bind(created.id).first<{ count: number }>();
check("wrong token did not write an rsvp", none?.count === 0);
check("plus-one cap is enforced", await throws(() => invites.rsvp(created.token, { status: "yes", plusOnes: 2 })));
await invites.rsvp(created.token, { status: "yes", plusOnes: 1 });
const yes = await db.prepare("SELECT plus_ones FROM rsvps WHERE guest_id = ?").bind(created.id).first<{ plus_ones: number }>();
check("plus-one within the cap is saved", Number(yes?.plus_ones) === 1);
await invites.saveInvitation(eventId, { involvesMinors: true }, actor);
check("minor event does not collect contact", await throws(() => invites.rsvp(created.token, { status: "yes", plusOnes: 1, phone })));
const unchanged = await db.prepare("SELECT phone FROM guests WHERE id = ?").bind(created.id).first<{ phone: string }>();
check("rsvp did not store a phone number", unchanged?.phone === phone);
await invites.saveInvitation(eventId, { involvesMinors: false, rsvpDeadline: new Date(Date.now() - 60_000).toISOString() }, actor);
check("deadline in the past rejects RSVP", await throws(() => invites.rsvp(created.token, { status: "no", plusOnes: 0 })));

const other = await invites.addGuest(eventId, { name: "Riley", email: "other-secret@example.com", phone: "555-0199-HIDDEN" }, "https://mb.example");
const payload = JSON.stringify(await invites.publicInvitation(invitation.slug));
check("public payload contains no guest email or phone", !payload.includes(email) && !payload.includes(phone) && !payload.includes("other-secret@example.com") && !payload.includes("555-0199-HIDDEN") && !payload.includes("Jordan") && !payload.includes("Riley"));
check("guest cannot list other guests", await throws(() => invites.listGuests(eventId, { kind: "guest" })));
await invites.saveInvitation(eventId, { mode: "private" }, actor);
check("private invitation requires a token", await throws(() => invites.publicInvitation(invitation.slug)));
const privateView = JSON.stringify(await invites.publicInvitation(invitation.slug, created.token));
check("private view still has no contact details", !privateView.includes(email) && !privateView.includes(phone));

const first = await invites.checkIn(created.checkInCode);
const second = await invites.checkIn(created.checkInCode);
const guestCount = await db.prepare("SELECT COUNT(*)::int AS count FROM guests WHERE id = ?").bind(created.id).first<{ count: number }>();
check("check-in with a valid code works once and a second check-in does not duplicate", Boolean(first.checkedInAt) && first.checkedInAt === second.checkedInAt && second.repeated === true && guestCount?.count === 1);

const pending = await invites.uploadGuestMedia(created.token, { bytes: new Uint8Array([1, 2, 3]), filename: "one.png", contentType: "image/png" });
const approved = await invites.uploadGuestMedia(created.token, { bytes: new Uint8Array([4, 5, 6]), filename: "two.png", contentType: "image/png" });
const rejected = await invites.uploadGuestMedia(other.token, { bytes: new Uint8Array([7, 8, 9]), filename: "three.png", contentType: "image/png" });
const hidden = await invites.gallery(eventId);
check("unapproved media is absent before review", hidden.length === 0);
await invites.reviewGuestMedia(eventId, approved.id, "approved", actor);
await invites.reviewGuestMedia(eventId, rejected.id, "rejected", actor);
const shown = await invites.gallery(eventId);
check(
  "unapproved media is absent from the gallery; approved media is present",
  shown.some((item) => item.fileId === approved.fileId) && !shown.some((item) => item.fileId === pending.fileId) && !shown.some((item) => item.fileId === rejected.fileId),
  shown.map((item) => item.fileId).join(","),
);

const job = await invites.scheduleMessage(eventId, {
  channel: "email",
  kind: "reminder",
  to: email,
  subject: "See you there",
  body: "The host wrote this.",
  nextAttemptAt: new Date(Date.now() - 60_000).toISOString(),
  guestId: created.id,
});
const sms = await invites.scheduleMessage(eventId, {
  channel: "sms",
  kind: "invite",
  to: phone,
  subject: "Invite",
  body: "The host wrote this too.",
  nextAttemptAt: new Date(Date.now() - 60_000).toISOString(),
});
await invites.runDueMessageJobs(eventId);
const emailJob = await db.prepare("SELECT status, attempt_count, sent_at, last_error FROM message_jobs WHERE id = ?").bind(job.id).first<{ status: string; attempt_count: number; sent_at: string | null; last_error: string }>();
const smsJob = await db.prepare("SELECT status, last_error, sent_at FROM message_jobs WHERE id = ?").bind(sms.id).first<{ status: string; last_error: string; sent_at: string | null }>();
check(
  "message job failure increments attempts and does not mark sent",
  Number(emailJob?.attempt_count) === 1 && emailJob?.status !== "sent" && !emailJob?.sent_at && emailJob?.last_error === "Email is not configured",
  JSON.stringify(emailJob),
);
check("sms job records that sms is not configured", smsJob?.status !== "sent" && !smsJob?.sent_at && smsJob?.last_error === "SMS is not configured", JSON.stringify(smsJob));

const plannerId = crypto.randomUUID();
const otherPlanner = crypto.randomUUID();
const otherEvent = crypto.randomUUID();
await createEventRecord({ id: otherEvent, customerId, name: "Other", eventType: "Party", eventDate: "2030-07-01" });
await db.prepare("INSERT INTO planner_events (id, code, password_hash, guest_code, guest_password, event_id, data, admin_data) VALUES (?, ?, 'x', ?, 'SHARE', ?, '{}', '{}')").bind(plannerId, `MB${plannerId.slice(0, 8)}`, `G${plannerId.slice(0, 8)}`, eventId).run();
await db.prepare("INSERT INTO planner_events (id, code, password_hash, guest_code, guest_password, event_id, data, admin_data) VALUES (?, ?, 'x', ?, 'SHARE', ?, '{}', '{}')").bind(otherPlanner, `MB${otherPlanner.slice(0, 8)}`, `G${otherPlanner.slice(0, 8)}`, otherEvent).run();
await invites.storeInviteSongRequest(created.token, { title: "September", artist: "Earth, Wind & Fire", note: "" });
const songs = await db.prepare("SELECT event_id, invite_guest_id FROM planner_guest_requests WHERE invite_guest_id = ?").bind(created.id).all<{ event_id: string; invite_guest_id: string }>();
const leaked = await db.prepare("SELECT COUNT(*)::int AS count FROM planner_guest_requests WHERE event_id = ?").bind(otherPlanner).first<{ count: number }>();
check("song request from a guest token stays on that event", songs.results.length === 1 && songs.results[0]?.event_id === plannerId && leaked?.count === 0);

const tableA = await invites.createTable(eventId, { label: "Table 1", capacity: 3 });
const tableB = await invites.createTable(eventId, { label: "Table 2", capacity: 10 });
check("tables store capacity", tableA.capacity === 3 && tableB.capacity === 10);
const listed = await invites.listGuests(eventId, { kind: "office" });
check("host list includes answers and check-in fields", listed.some((guest) => guest.id === created.id && guest.plusOnes === 1 && Array.isArray(guest.answers) && "checkedInAt" in guest));
await invites.assignGuestsToTable(eventId, { guestIds: [created.id], tableId: tableA.id });
const seated = await invites.listGuests(eventId, { kind: "office" });
check("assign links guest to table", seated.find((guest) => guest.id === created.id)?.tableId === tableA.id);
// party 2 + plus 1 = 3 seats fills table A; second guest of 1 seat must not overfill
const extra = await invites.addGuest(eventId, { name: "Overflow", partySize: 1 }, "https://mb.example");
check("over-capacity assign rejected", await throws(() => invites.assignGuestsToTable(eventId, { guestIds: [extra.id], tableId: tableA.id })));
await invites.assignGuestsToTable(eventId, { guestIds: [extra.id], tableId: tableB.id });
await invites.assignGuestsToTable(eventId, { guestIds: [created.id], tableId: tableB.id });
const moved = await invites.listGuests(eventId, { kind: "office" });
check("guests can move between tables", moved.find((guest) => guest.id === created.id)?.tableId === tableB.id);
await invites.assignGuestsToTable(eventId, { guestIds: [created.id, extra.id], tableId: null });
const cleared = await invites.listGuests(eventId, { kind: "office" });
check("unassign clears table", cleared.every((guest) => !guest.tableId || (guest.id !== created.id && guest.id !== extra.id)) || cleared.filter((g) => [created.id, extra.id].includes(g.id)).every((g) => !g.tableId));
const view = await invites.invitationView(eventId, { kind: "office" });
check("invitation view includes tables", (view.tables?.length ?? 0) >= 2);
const staffView = await invites.listGuests(eventId, { kind: "staff" });
check("staff guest list hides emails", staffView.every((guest) => !guest.email));
const publicPage = await invites.publicInvitation(invitation.slug, created.token);
check("public invite does not list other guests", !("guests" in publicPage) && !JSON.stringify(publicPage).includes(email));

const afterOpt = await db.prepare("SELECT marketing_opt_in FROM customers WHERE id = ?").bind(customerId).first<{ marketing_opt_in: boolean | null }>();
const sources = [
  "lib/invites.ts",
  "lib/invite-http.ts",
  "lib/qr.ts",
  "components/planner/invite-host.tsx",
  "components/planner/invite-public.tsx",
  "db/migrations/0010_invites.sql",
  "app/api/planner/guest/requests/route.ts",
].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).join("\n");
check("no code path sets marketing opt-in", beforeOpt?.marketing_opt_in == null && afterOpt?.marketing_opt_in == null && !sources.includes("marketing_opt_in"));

await rm(fileDir, { recursive: true, force: true });
const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
