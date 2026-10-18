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

const { can } = await import("../lib/authz.ts");
const { guestRanges, leadSchema } = await import("../lib/lead.ts");
const { getDatabase } = await import("../lib/env.ts");
const crm = await import("../lib/crm.ts");

check("sales can follow up", can("sales", "tasks.read") && can("sales", "tasks.write"));
check("invalid lead rejected", !leadSchema.safeParse({ source: "builder", name: "A", email: "", phone: "", eventType: "Wedding" }).success);
check("honeypot rejected", !leadSchema.safeParse({
  source: "contact", name: "Ada Client", email: "ada@example.com", phone: "", eventType: "Other", website: "spam",
}).success);

const db = getDatabase();
if (!db) throw new Error("database did not open");

const actor = { email: "office@example.com", userId: null as string | null };
const userId = crypto.randomUUID();
const staffId = crypto.randomUUID();
await db.prepare("INSERT INTO users (id, email, name, role) VALUES (?, 'sales@example.com', 'Sales Person', 'sales')").bind(userId).run();
await db.prepare("INSERT INTO staff (id, user_id, name, email) VALUES (?, ?, 'Sales Person', 'sales@example.com')").bind(staffId, userId).run();

function inquiry(overrides: Record<string, unknown> = {}) {
  return leadSchema.parse({
    source: "builder",
    name: "Ada Client",
    email: "ada@example.com",
    phone: "5551234567",
    eventType: "Wedding",
    eventDate: "2030-06-01",
    guestCount: guestRanges[2],
    location: "Wantagh",
    venueName: "The Garden",
    services: ["entertainment", "lighting-production"],
    notes: "Evening ceremony",
    ...overrides,
  });
}

const primary = await crm.createInquiry(inquiry());
const row = await db.prepare(
  `SELECT source, email, event_type, event_date::text AS event_date, guest_count, location, venue_name, services, budget_cents, customer_id
   FROM leads WHERE id = ?`,
).bind(primary.id).first<{
  source: string; email: string; event_type: string; event_date: string; guest_count: string; location: string;
  venue_name: string; services: unknown; budget_cents: number | null; customer_id: string;
}>();
check(
  "lead stores submitted fields",
  !!row && row.source === "builder" && row.email === "ada@example.com" && row.event_type === "Wedding"
    && row.event_date.startsWith("2030-06-01") && row.guest_count === guestRanges[2] && row.location === "Wantagh"
    && row.venue_name === "The Garden" && row.budget_cents == null && crm.jsonList(row.services).includes("entertainment"),
  JSON.stringify(row),
);
const customers = await db.prepare("SELECT COUNT(*)::int AS count FROM customers WHERE email = 'ada@example.com'").first<{ count: number }>();
check("lead links one customer", row?.customer_id === primary.customerId && customers?.count === 1, String(customers?.count));

await crm.updateLead(primary.id, { assigneeId: staffId }, actor);
const assigned = await db.prepare("SELECT assignee_id FROM leads WHERE id = ?").bind(primary.id).first<{ assignee_id: string }>();
const assignmentAudit = await db.prepare("SELECT action FROM admin_audit WHERE subject_id = ? AND action = 'lead_assigned'").bind(primary.id).first<{ action: string }>();
check("lead assigned", assigned?.assignee_id === staffId && !!assignmentAudit);

await crm.updateLead(primary.id, { stage: "contacted" }, actor);
const stageActivity = await db.prepare("SELECT kind FROM lead_activities WHERE lead_id = ? AND kind = 'stage'").bind(primary.id).first<{ kind: string }>();
const contacted = await db.prepare("SELECT stage FROM leads WHERE id = ?").bind(primary.id).first<{ stage: string }>();
check("stage change recorded", contacted?.stage === "contacted" && !!stageActivity);

const lost = await crm.createInquiry(inquiry({ name: "Lost Client", email: "lost@example.com", phone: "5550001111" }));
check("lost without a reason rejected", await throws(() => crm.updateLead(lost.id, { stage: "lost", lostReason: " " }, actor)));
const unchanged = await db.prepare("SELECT stage FROM leads WHERE id = ?").bind(lost.id).first<{ stage: string }>();
check("missing reason leaves the stage", unchanged?.stage === "new_lead");
await crm.updateLead(lost.id, { stage: "lost", lostReason: "Went with another company" }, actor);
const lostRow = await db.prepare("SELECT stage, lost_reason FROM leads WHERE id = ?").bind(lost.id).first<{ stage: string; lost_reason: string }>();
check("lost reason saved", lostRow?.stage === "lost" && lostRow.lost_reason === "Went with another company");

const duplicate = await crm.createInquiry(inquiry({ name: "Ada Duplicate", email: "Ada@Example.com", phone: "5551239999", notes: "Call after five" }));
check("duplicate email flagged", duplicate.duplicates.some((item) => item.id === primary.id));
check("duplicate reuses the customer", duplicate.customerId === primary.customerId);
await crm.addLeadTask(duplicate.id, { title: "Call back", dueOn: "2030-04-01", assigneeId: staffId }, actor);
await crm.mergeLeads(primary.id, duplicate.id, actor);
const open = await db.prepare("SELECT COUNT(*)::int AS count FROM leads WHERE merged_into_id IS NULL AND lower(email) = 'ada@example.com'").first<{ count: number }>();
const kept = await db.prepare("SELECT notes, customer_id FROM leads WHERE id = ?").bind(primary.id).first<{ notes: string | null; customer_id: string }>();
const folded = await db.prepare("SELECT merged_into_id FROM leads WHERE id = ?").bind(duplicate.id).first<{ merged_into_id: string | null }>();
const task = await db.prepare("SELECT lead_id FROM tasks WHERE title = 'Call back'").first<{ lead_id: string }>();
const stillOne = await db.prepare("SELECT COUNT(*)::int AS count FROM customers WHERE email = 'ada@example.com'").first<{ count: number }>();
check("merge keeps one open lead", open?.count === 1 && folded?.merged_into_id === primary.id, String(open?.count));
check("merge keeps the other note", (kept?.notes ?? "").includes("Call after five") && kept?.customer_id === primary.customerId);
check("merge moves the follow-up", task?.lead_id === primary.id);
check("merge does not create a second customer", stillOne?.count === 1, String(stillOne?.count));

const phoneA = await crm.createInquiry(leadSchema.parse({ source: "contact", name: "Pat Only", email: "", phone: "5559876543", eventType: "Other" }));
const phoneB = await crm.createInquiry(leadSchema.parse({ source: "contact", name: "Pat Two", email: "", phone: "(555) 987-6543", eventType: "Other" }));
check("empty-email phone duplicate flagged", phoneB.duplicates.some((item) => item.id === phoneA.id) && phoneA.customerId !== phoneB.customerId);

const booked = await crm.bookLead({
  leadId: primary.id,
  actor,
  details: {
    clientNames: "Ada Client",
    email: "ada@example.com",
    phone: "5551234567",
    eventType: "Wedding",
    eventDate: "2030-06-01",
    venueName: "The Garden",
    guestCount: guestRanges[2] ?? "",
  },
});
const events = await db.prepare("SELECT id FROM events WHERE lead_id = ?").bind(primary.id).all<{ id: string }>();
const booking = await db.prepare("SELECT status, confirmed_at FROM bookings WHERE event_id = ?").bind(booked.id).first<{ status: string; confirmed_at: string | null }>();
const planner = await db.prepare("SELECT id, event_id, lead_id FROM planner_events WHERE id = ?").bind(booked.id).first<{ id: string; event_id: string; lead_id: string }>();
const payments = await db.prepare("SELECT COUNT(*)::int AS count FROM payments WHERE event_id = ?").bind(booked.id).first<{ count: number }>();
const converted = await db.prepare("SELECT stage, converted_event_id, customer_id FROM leads WHERE id = ?").bind(primary.id).first<{ stage: string; converted_event_id: string | null; customer_id: string }>();
check("conversion creates one event", events.results.length === 1 && events.results[0]?.id === booked.id, String(events.results.length));
check("booking stays unconfirmed", (booking?.status === "pending" || booking?.status === "tentative") && booking.status !== "confirmed" && !booking.confirmed_at, JSON.stringify(booking));
check("planner id is the event id", planner?.id === booked.id && planner.event_id === booked.id && planner.lead_id === primary.id);
check("conversion creates no payment", payments?.count === 0, String(payments?.count));
check("lead is booked once", converted?.stage === "booked" && converted.converted_event_id === booked.id && converted.customer_id === primary.customerId);
check("second conversion rejected", await throws(() => crm.bookLead({
  leadId: primary.id,
  actor,
  details: { clientNames: "Ada Client", email: "ada@example.com", phone: "5551234567", eventType: "Wedding", eventDate: "2030-06-01", venueName: "The Garden", guestCount: "" },
})));
const eventsAfter = await db.prepare("SELECT COUNT(*)::int AS count FROM events WHERE lead_id = ?").bind(primary.id).first<{ count: number }>();
check("conversion does not run twice", eventsAfter?.count === 1, String(eventsAfter?.count));

const listed = await crm.listLeads({ q: "Ada" });
check("search finds the open lead", listed.leads.some((item) => item.id === primary.id) && listed.leads.every((item) => item.id !== duplicate.id));
check("booked count comes from rows", listed.stats.booked >= 1 && listed.stats.byStage.some((stage) => stage.key === "booked" && stage.count >= 1));

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
