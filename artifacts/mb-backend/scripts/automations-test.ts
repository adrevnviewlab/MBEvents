process.env.DATABASE_URL = "pglite:memory";

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
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const places = await import("../lib/places.ts");
const autos = await import("../lib/automations.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const actor = { email: "office@example.com" };

async function count(sql: string, ...args: unknown[]) {
  const row = await db!.prepare(sql).bind(...args).first<{ count: number }>();
  return Number(row?.count ?? -1);
}

check("no seeded venues", await count("SELECT COUNT(*)::int AS count FROM venues") === 0);
check("no seeded vendors", await count("SELECT COUNT(*)::int AS count FROM vendors") === 0);
check("migration inserts zero templates", await count("SELECT COUNT(*)::int AS count FROM automation_templates") === 0);
check(
  "no seeded venue or vendor names",
  await count("SELECT COUNT(*)::int AS count FROM venues WHERE name IN ('North Shore Photo', 'Lumen Floral', 'Harbor Cake Co.', 'Atelier Decor', 'Kinetic Film', 'Island Cars')") === 0
    && await count("SELECT COUNT(*)::int AS count FROM vendors WHERE name IN ('North Shore Photo', 'Lumen Floral', 'Harbor Cake Co.', 'Atelier Decor', 'Kinetic Film', 'Island Cars')") === 0,
);

check("zero published venues leaves the public list empty", (await places.publicVenues()).length === 0);

const venue = await places.createVenue({
  name: "Room A",
  notes: "dock-code-9",
  description: "A room with a floor",
  capacity: "100",
  address: "1 Main",
  area: "Nassau",
  serviceArea: "Long Island",
}, actor);
check("creating a venue does not publish it", venue.published === false);
check("unpublished venue stays off the public list", (await places.publicVenues()).length === 0);

const other = await places.createVenue({ name: "Room B" }, actor);
const customer = await ensureCustomer({ name: "Ada", email: "ada@example.com", phone: "5550100" });
const opted = await db.prepare("SELECT marketing_opt_in FROM customers WHERE id = ?").bind(customer).first<{ marketing_opt_in: boolean | null }>();
check("a new customer is not opted in", opted?.marketing_opt_in == null);

const eventA = crypto.randomUUID();
const eventB = crypto.randomUUID();
await createEventRecord({ id: eventA, customerId: customer, name: "Ada Night", eventType: "Wedding", eventDate: "2030-06-01" });
await createEventRecord({ id: eventB, customerId: customer, name: "Other Night", eventType: "Birthday", eventDate: "2030-07-01" });
await db.prepare("UPDATE events SET venue_id = ? WHERE id = ?").bind(venue.id, eventA).run();
await db.prepare("UPDATE events SET venue_id = ? WHERE id = ?").bind(other.id, eventB).run();
const past = await places.eventsAtVenue(venue.id);
check("past events are only events linked to that venue", past.length === 1 && past[0]?.id === eventA, JSON.stringify(past));

await places.updateVenue(venue.id, { published: true }, actor);
const visible = await places.publicVenues();
const payload = JSON.stringify(visible);
check(
  "public payload omits internal notes",
  visible.length === 1 && !("notes" in visible[0]!) && !payload.includes("dock-code-9") && visible[0]?.mbProduction === false,
  payload,
);

check("template row exists only after staff insert", await count("SELECT COUNT(*)::int AS count FROM automation_templates") === 0);
const confirmation = await autos.createTemplate({
  kind: "inquiry_confirmation", channel: "email", delayMinutes: 0, subject: "Hello", body: "Hello", active: true,
}, actor);
check("staff insert creates the template", await count("SELECT COUNT(*)::int AS count FROM automation_templates") === 1);
check("creating a template does not send", await count("SELECT COUNT(*)::int AS count FROM message_jobs WHERE template_id IS NOT NULL") === 0);

const leadId = crypto.randomUUID();
await db.prepare(
  "INSERT INTO leads (id, customer_id, source, name, email, phone, event_type) VALUES (?, ?, 'venue', 'Ada', 'ada@example.com', '5550100', 'Wedding')",
).bind(leadId, customer).run();
await places.attachInquiryLinks(leadId, { source: "venue", venueId: venue.id });
const linked = await db.prepare("SELECT venue_id FROM leads WHERE id = ?").bind(leadId).first<{ venue_id: string | null }>();
check("venue inquiry links the venue id", linked?.venue_id === venue.id);

const first = await autos.scheduleAutomation({ templateId: confirmation.id, entityType: "lead", entityId: leadId });
const second = await autos.scheduleAutomation({ templateId: confirmation.id, entityType: "lead", entityId: leadId });
check(
  "scheduling the same automation twice creates one run",
  first.id === second.id && second.created === false && await count("SELECT COUNT(*)::int AS count FROM message_jobs WHERE template_id = ?", confirmation.id) === 1,
);
const inquiry = await db.prepare("SELECT to_address, status FROM message_jobs WHERE id = ?").bind(first.id).first<{ to_address: string; status: string }>();
const stillNull = await db.prepare("SELECT marketing_opt_in FROM customers WHERE id = ?").bind(customer).first<{ marketing_opt_in: boolean | null }>();
check(
  "inquiry confirmation can be scheduled without marketing opt-in",
  stillNull?.marketing_opt_in == null && inquiry?.to_address === "ada@example.com" && inquiry.status === "pending",
);

const held = await autos.deliverRun(first.id);
const heldRow = await db.prepare("SELECT status, attempt_count, sent_at FROM message_jobs WHERE id = ?").bind(first.id).first<{ status: string; attempt_count: number; sent_at: string | null }>();
check("email stays unsent when it is not configured", held.sent === false && heldRow?.status === "pending" && Number(heldRow.attempt_count) === 0 && heldRow.sent_at == null);

process.env.RESEND_API_KEY = "test-key";
process.env.MB_FROM_EMAIL = "office@example.com";
let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  calls += 1;
  return new Response("no", { status: 500 });
};
const cap = Number((await db.prepare("SELECT max_attempts FROM message_jobs WHERE id = ?").bind(first.id).first<{ max_attempts: number }>())?.max_attempts);
for (let attempt = 0; attempt < cap; attempt += 1) await autos.deliverRun(first.id);
const stopped = await db.prepare("SELECT status, attempt_count FROM message_jobs WHERE id = ?").bind(first.id).first<{ status: string; attempt_count: number }>();
const callsAtCap = calls;
await autos.deliverRun(first.id);
check(
  "a failed run retries and then stops at the attempt cap",
  Number(stopped?.attempt_count) === cap && calls === callsAtCap && stopped?.status === "failed" && cap > 0,
  `attempts=${stopped?.attempt_count} cap=${cap} calls=${calls}`,
);

globalThis.fetch = async () => {
  calls += 1;
  return new Response("ok", { status: 200 });
};
const thanks = await autos.createTemplate({ kind: "thank_you", channel: "email", subject: "Thanks", body: "Thanks", active: true }, actor);
const thankRun = await autos.scheduleAutomation({ templateId: thanks.id, entityType: "lead", entityId: leadId });
await autos.cancelRun(thankRun.id, actor);
const callsBefore = calls;
await autos.deliverRun(thankRun.id);
const canceled = await db.prepare("SELECT status, sent_at, attempt_count FROM message_jobs WHERE id = ?").bind(thankRun.id).first<{ status: string; sent_at: string | null; attempt_count: number }>();
check("cancel prevents send", canceled?.status === "canceled" && canceled.sent_at == null && Number(canceled.attempt_count) === 0 && calls === callsBefore);

const review = await autos.createTemplate({ kind: "review_request", channel: "email", subject: "Review", body: "Review", active: true }, actor);
const referral = await autos.createTemplate({ kind: "referral", channel: "email", subject: "Refer", body: "Refer", active: true }, actor);
const reviewRun = await autos.scheduleAutomation({ templateId: review.id, entityType: "lead", entityId: leadId });
await autos.deliverRun(reviewRun.id);
const reviewHeld = await db.prepare("SELECT status, sent_at FROM message_jobs WHERE id = ?").bind(reviewRun.id).first<{ status: string; sent_at: string | null }>();
check("review request does not send when marketing opt-in is null", reviewHeld?.status !== "sent" && reviewHeld?.sent_at == null, reviewHeld?.status);

await db.prepare("UPDATE customers SET marketing_opt_in = false WHERE id = ?").bind(customer).run();
const referralRun = await autos.scheduleAutomation({ templateId: referral.id, entityType: "lead", entityId: leadId });
await autos.deliverRun(referralRun.id);
const referralHeld = await db.prepare("SELECT status, sent_at FROM message_jobs WHERE id = ?").bind(referralRun.id).first<{ status: string; sent_at: string | null }>();
check("referral does not send when marketing opt-in is false", referralHeld?.status !== "sent" && referralHeld?.sent_at == null, referralHeld?.status);

await db.prepare("UPDATE customers SET marketing_opt_in = true WHERE id = ?").bind(customer).run();
await autos.deliverRun(reviewRun.id);
await autos.unsubscribeCustomer(customer, actor);
const reviewAfter = await db.prepare("SELECT status FROM message_jobs WHERE id = ?").bind(reviewRun.id).first<{ status: string }>();
const referralAfter = await db.prepare("SELECT status FROM message_jobs WHERE id = ?").bind(referralRun.id).first<{ status: string }>();
const optOut = await db.prepare("SELECT marketing_opt_in FROM customers WHERE id = ?").bind(customer).first<{ marketing_opt_in: boolean | null }>();
check(
  "unsubscribe cancels unsent marketing and keeps sent history",
  reviewAfter?.status === "sent" && referralAfter?.status === "canceled" && optOut?.marketing_opt_in === false,
  `review=${reviewAfter?.status} referral=${referralAfter?.status} opt=${String(optOut?.marketing_opt_in)}`,
);

const guestId = crypto.randomUUID();
await db.prepare("INSERT INTO guests (id, event_id, name, email) VALUES (?, ?, 'Guest', 'guest@example.com')").bind(guestId, eventA).run();
const rsvp = await autos.createTemplate({ kind: "rsvp_reminder", channel: "email", subject: "RSVP", body: "RSVP", active: true }, actor);
const guestRun = await autos.scheduleAutomation({ templateId: rsvp.id, entityType: "guest", entityId: guestId });
const guestJob = await db.prepare("SELECT to_address FROM message_jobs WHERE id = ?").bind(guestRun.id).first<{ to_address: string }>();
const afterGuest = await db.prepare("SELECT marketing_opt_in FROM customers WHERE id = ?").bind(customer).first<{ marketing_opt_in: boolean | null }>();
check("guest reminder uses that guest and does not opt them in", guestJob?.to_address === "guest@example.com" && afterGuest?.marketing_opt_in === false);
check("an RSVP reminder is not scheduled for the lead", await throws(() => autos.scheduleAutomation({ templateId: rsvp.id, entityType: "lead", entityId: leadId })));

globalThis.fetch = originalFetch;

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
