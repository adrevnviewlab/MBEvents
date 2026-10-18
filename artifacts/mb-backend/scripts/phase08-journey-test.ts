/**
 * Phase 08: customer planner + invitations journey (shared event record + security).
 * No real email/SMS. No browser required — exercises the same APIs the UI calls.
 */
process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@phase08.test";
delete process.env.RESEND_API_KEY;

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

const { getDatabase } = await import("../lib/env.ts");
const { createInquiry, bookLead } = await import("../lib/crm.ts");
const { leadSchema } = await import("../lib/lead.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const { clientView, eventExtras, parseEvent, ensureGuestToken } = await import("../lib/planner-server.ts");
const { newAdminData, newPlannerData, guestRequestPath } = await import("../lib/planner.ts");
const invites = await import("../lib/invites.ts");
const { createAssignment, staffBrief } = await import("../lib/operations.ts");
const { syncEventDetails } = await import("../lib/records.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const owner = { email: "owner@phase08.test", userId: null as string | null };
await saveBusinessSettings({ companyName: "MB Events", timezone: "America/New_York", actorEmail: owner.email });

const lead = await createInquiry(leadSchema.parse({
  source: "contact",
  name: "Ava Planner",
  email: "ava-phase08@example.com",
  phone: "5550808",
  eventType: "Wedding",
  eventDate: "2039-09-09",
  services: [],
}));

const booked = await bookLead({
  leadId: lead.id,
  actor: owner,
  details: {
    clientNames: "Ava Planner",
    email: "ava-phase08@example.com",
    phone: "5550808",
    eventType: "Wedding",
    eventDate: "2039-09-09",
    venueName: "Harbor Hall",
    guestCount: "120",
  },
});

const planner = await db.prepare("SELECT * FROM planner_events WHERE id = ?").bind(booked.id).first();
const eventRow = await db.prepare("SELECT id, customer_id, lead_id, name, event_date::text AS event_date FROM events WHERE id = ?").bind(booked.id).first<{ id: string; customer_id: string; lead_id: string; name: string; event_date: string }>();
check("planner and central event share one id", !!planner && eventRow?.id === booked.id && (planner as { event_id: string }).event_id === booked.id);
check("CRM lead points at the same event", eventRow?.lead_id === lead.id);

await syncEventDetails(booked.id, {
  clientNames: "Ava & Jordan",
  email: "ava-phase08@example.com",
  phone: "5550808",
  eventType: "Wedding",
  eventDate: "2039-09-09",
  venueName: "Harbor Hall Renamed",
  guestCount: "120",
});
const synced = await db.prepare("SELECT name, location FROM events WHERE id = ?").bind(booked.id).first<{ name: string; location: string }>();
check("customer detail edits sync to the office event", synced?.name === "Ava & Jordan" && synced?.location === "Harbor Hall Renamed", JSON.stringify(synced));

const row = await db.prepare("SELECT * FROM planner_events WHERE id = ?").bind(booked.id).first();
const parsed = parseEvent(row as never);
await ensureGuestToken(parsed.row);
const extras = await eventExtras(parsed.row.id);
const view = clientView(parsed, extras);
check("client view exposes eventId for the shared record", view.eventId === booked.id);
check("client view does not expose guest password", !("guestPassword" in view) || !(view as { guestPassword?: string }).guestPassword);
check("client view includes countdown and progress", typeof view.countdown === "number" && !!view.progress && typeof view.progress.total === "number");
check("guest link has token and no password query", !!view.guestPath && view.guestPath.startsWith("/planner/guest?t=") && !view.guestPath.includes("pw=") && !view.guestPath.includes("password"));

const other = await createInquiry(leadSchema.parse({
  source: "contact",
  name: "Other Client",
  email: "other-phase08@example.com",
  phone: "5550909",
  eventType: "Birthday",
  eventDate: "2039-10-10",
  services: [],
}));
const otherBooked = await bookLead({
  leadId: other.id,
  actor: owner,
  details: {
    clientNames: "Other Client",
    email: "other-phase08@example.com",
    phone: "5550909",
    eventType: "Birthday",
    eventDate: "2039-10-10",
    venueName: "Elsewhere",
    guestCount: "40",
  },
});

const invitation = await invites.ensureInvitation(booked.id);
await invites.saveInvitation(booked.id, {
  published: true,
  mode: "private",
  plusOneCap: 1,
  title: "Ava & Jordan",
  message: "Join us",
  involvesMinors: false,
  questions: [{ id: "q1", label: "Meal choice?" }],
  rsvpDeadline: new Date(Date.now() + 86400000).toISOString(),
}, owner);

const guest = await invites.addGuest(booked.id, {
  name: "Guest Ava",
  email: "guest-phase08@example.com",
  phone: "5550111",
  partySize: 1,
  isMinor: false,
}, "https://example.test");

check("invite and guest belong to the booked event", invitation.eventId === booked.id);
const inviteView = await invites.invitationView(booked.id, { kind: "office", role: "admin" });
const questionId = inviteView.invitation?.questions?.[0]?.id || "";
check("custom question saved on invitation", !!questionId, JSON.stringify(inviteView.invitation?.questions));
await invites.rsvp(guest.token, { status: "yes", plusOnes: 1, answers: questionId ? [{ questionId, value: "Chicken" }] : [] });
const publicView = JSON.stringify(await invites.publicInvitation(invitation.slug, guest.token));
check("private invite with token shows no other guest PII", !publicView.includes("5550111") && !publicView.includes("guest-phase08@example.com"));

const minor = await invites.addGuest(booked.id, { name: "Kid", partySize: 1, isMinor: true }, "https://example.test");
await invites.saveInvitation(booked.id, { involvesMinors: true }, owner);
check("minor guest cannot submit contact on RSVP", await throws(() => invites.rsvp(minor.token, { status: "yes", plusOnes: 0, email: "kid@example.com" })));

const checkIn = await invites.checkIn(guest.checkInCode);
check("QR check-in uses check-in code", Boolean(checkIn.checkedInAt));
check("check-in URL uses check-in code", guest.checkInUrl.includes(guest.checkInCode) && guest.checkInUrl.includes("/invite/check-in"));

await invites.saveInvitation(booked.id, { involvesMinors: false }, owner);
const media = await invites.uploadGuestMedia(guest.token, { bytes: new Uint8Array([9, 9, 9]), filename: "party.png", contentType: "image/png" });
check("unapproved gallery is empty", (await invites.publicGallery(invitation.slug, guest.token)).length === 0);
await invites.reviewGuestMedia(booked.id, media.id, "approved", owner);
check("approved gallery is visible with guest token", (await invites.publicGallery(invitation.slug, guest.token)).length === 1);
check("gallery for wrong event token is rejected", await throws(() => invites.publicGallery(invitation.slug, "x".repeat(43))));

const userId = crypto.randomUUID();
const staffId = crypto.randomUUID();
await db.prepare("INSERT INTO users (id, email, name, role) VALUES (?, 'dj@phase08.test', 'DJ', 'staff')").bind(userId).run();
await db.prepare("INSERT INTO staff (id, user_id, name, email, profile_type) VALUES (?, ?, 'DJ', 'dj@phase08.test', 'dj')").bind(staffId, userId).run();
await createAssignment({ actorRole: "admin", eventId: booked.id, staffId, roleLabel: "DJ" });

await db.prepare(
  `UPDATE planner_events SET data = jsonb_set(
     jsonb_set(coalesce(data, '{}'::jsonb), '{timeline}', ?::jsonb, true),
     '{songs}', ?::jsonb, true)
   WHERE event_id = ?`,
).bind(
  JSON.stringify([{ id: "1", time: "6:00 PM", what: "Cocktail hour", song: "", who: "" }]),
  JSON.stringify([{ id: "2", title: "First Dance", artist: "Band", kind: "Special moment", moment: "First dance", note: "" }]),
  booked.id,
).run();

const brief = await staffBrief(userId);
const assigned = brief.events.find((event) => event.id === booked.id);
check("staff brief is limited to assigned event", brief.events.length === 1 && !!assigned);
check("staff sees client run-of-show on the same event", !!assigned?.runOfShow.timeline.some((item) => item.what === "Cocktail hour"));
check("staff brief omits other customer event", !brief.events.some((event) => event.id === otherBooked.id));

const rotated = await invites.rotateGuestLink(booked.id, guest.id, "https://example.test");
check("rotated invite token revokes the old one", await throws(() => invites.rsvp(guest.token, { status: "no", plusOnes: 0 })));
check("new invite token works", !(await throws(() => invites.rsvp(rotated.token, { status: "no", plusOnes: 0 }))));

const failed = results.filter((result) => !result.pass);
for (const result of results) {
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
