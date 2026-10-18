process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@sales.test";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_sales_phase4";

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

async function throws(run: () => Promise<unknown>, part = "") {
  try {
    await run();
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return !part || message.includes(part) ? message : `unexpected: ${message}`;
  }
}

const { createHmac } = await import("node:crypto");
const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const { createInquiry, bookLead } = await import("../lib/crm.ts");
const { leadSchema } = await import("../lib/lead.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const {
  acceptProposal,
  approveCatalogPrice,
  handleStripeWebhook,
  publishCatalogPrice,
  savePackage,
  savePricingRule,
  sendQuote,
} = await import("../lib/finance.ts");
const {
  cancelBooking,
  completeBooking,
  confirmBooking,
  getBooking,
  rescheduleBooking,
  setBookingHold,
} = await import("../lib/calendar.ts");
const { getSalesWorkflow } = await import("../lib/sales-workflow.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");

const owner = { email: "owner@sales.test", userId: null as string | null };
const staff = { email: "staff@sales.test", userId: null as string | null };
const futureHold = () => new Date(Date.now() + 3 * 86400000).toISOString();
const pastHold = () => new Date(Date.now() - 3600000).toISOString();

await saveBusinessSettings({
  companyName: "MB Events",
  timezone: "America/New_York",
  requireOwnerConfirm: true,
  requireStaffBeforeConfirm: false,
  depositDueDays: 7,
  actorEmail: owner.email,
});

const inquiry = await createInquiry(leadSchema.parse({
  source: "contact",
  name: "River Client",
  email: "river-sales@example.com",
  phone: "5550202",
  eventType: "Wedding",
  eventDate: "2035-06-20",
  services: [],
}));
const customerId = await ensureCustomer({ name: "River Client", email: "river-sales@example.com", phone: "5550202" });
const booked = await bookLead({
  leadId: inquiry.id,
  actor: owner,
  details: {
    clientNames: "River Client",
    email: "river-sales@example.com",
    phone: "5550202",
    eventType: "Wedding",
    eventDate: "2035-06-20",
    venueName: "Garden Hall",
    guestCount: "120",
  },
});
const eventId = booked.id;
const eventCustomer = await db.prepare("SELECT customer_id FROM events WHERE id = ?").bind(eventId).first<{ customer_id: string }>();
check("inquiry-to-event preserves customer and event ids", !!eventId && eventCustomer?.customer_id === customerId, JSON.stringify({ eventId, eventCustomer, customerId }));

const leadRow = await db.prepare("SELECT stage, converted_event_id FROM leads WHERE id = ?").bind(inquiry.id).first<{ stage: string; converted_event_id: string | null }>();
const bookingRow = await db.prepare("SELECT status FROM bookings WHERE event_id = ?").bind(eventId).first<{ status: string }>();
check("CRM booked stage is independent of booking status", leadRow?.stage === "booked" && (bookingRow?.status === "tentative" || bookingRow?.status === "pending"), JSON.stringify({ lead: leadRow, booking: bookingRow }));

await rescheduleBooking(eventId, owner, {
  eventDate: "2035-06-20",
  startTime: "4:00 PM",
  endTime: "11:00 PM",
  timezone: "America/New_York",
});

let workflow = await getSalesWorkflow(eventId);
check("workflow starts before hold and quote", workflow.steps.find((s) => s.key === "event")?.done === true && !workflow.steps.find((s) => s.key === "hold")?.done && !workflow.steps.find((s) => s.key === "quote")?.done);

await setBookingHold(eventId, staff, futureHold());
const pkg = await savePackage({ name: "Celebration", priceCents: 20000, actorEmail: owner.email });
await approveCatalogPrice({ kind: "package", id: pkg.id, actorEmail: owner.email });
await publishCatalogPrice({ kind: "package", id: pkg.id, actorEmail: owner.email });

await sendQuote({ eventId, packageId: pkg.id, actorEmail: owner.email });
const missing = await throws(() => acceptProposal({ eventId, acceptedBy: "River Client", actorEmail: "river-sales@example.com" }), "deposit");
check("missing deposit rule blocks acceptance", missing.includes("deposit") || missing.includes("Catalog"), missing);
workflow = await getSalesWorkflow(eventId);
check("sent quote without deposit rule surfaces config error", !!workflow.depositConfigError && workflow.nextAction.includes("Catalog"), workflow.nextAction);

await savePricingRule({ kind: "deposit", label: "Wedding deposit", amountCents: 5000, percent: null, active: true, actorEmail: owner.email });
const quoted = await sendQuote({ eventId, packageId: pkg.id, actorEmail: owner.email });
check("quote freezes approved deposit amount", quoted.deposit?.amountCents === 5000, JSON.stringify(quoted.deposit));

const firstAccept = await acceptProposal({ eventId, acceptedBy: "River Client", actorEmail: "river-sales@example.com" });
const secondAccept = await acceptProposal({ eventId, acceptedBy: "River Client", actorEmail: "river-sales@example.com" });
const deposits = await db.prepare("SELECT id, status, amount_cents, schedule_key, kind FROM payments WHERE event_id = ?").bind(eventId).all<{ id: string; status: string; amount_cents: number; schedule_key: string; kind: string }>();
check("quote accepted twice creates one deposit due", firstAccept.already === false && secondAccept.already === true && deposits.results.length === 1 && deposits.results[0]?.status === "due" && deposits.results[0]?.kind === "deposit" && deposits.results[0]?.schedule_key === "deposit" && Number(deposits.results[0]?.amount_cents) === 5000, JSON.stringify(deposits.results));
check("acceptance does not confirm booking", (await db.prepare("SELECT status FROM bookings WHERE event_id = ?").bind(eventId).first<{ status: string }>())?.status === "tentative");

const depositId = deposits.results[0]?.id ?? "";
const paidPayload = JSON.stringify({
  id: "evt_sales_pay",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_sales_deposit",
      payment_status: "paid",
      amount_total: 5000,
      payment_intent: "pi_test_sales",
      metadata: { payment_id: depositId, event_id: eventId },
    },
  },
});
const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const ts = Math.floor(Date.now() / 1000);
const sig = createHmac("sha256", secret).update(`${ts}.${paidPayload}`).digest("hex");
await handleStripeWebhook(paidPayload, `t=${ts},v1=${sig}`);
check("deposit payment leaves booking tentative", (await db.prepare("SELECT status FROM bookings WHERE event_id = ?").bind(eventId).first<{ status: string }>())?.status === "tentative");
check("deposit payment marks obligation paid", (await db.prepare("SELECT status FROM payments WHERE id = ?").bind(depositId).first<{ status: string }>())?.status === "paid");

const failedPayload = JSON.stringify({
  id: "evt_sales_fail",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_sales_fail",
      payment_status: "unpaid",
      amount_total: 5000,
      metadata: { payment_id: crypto.randomUUID(), event_id: eventId },
    },
  },
});
const failTs = Math.floor(Date.now() / 1000);
const failSig = createHmac("sha256", secret).update(`${failTs}.${failedPayload}`).digest("hex");
const failResult = await handleStripeWebhook(failedPayload, `t=${failTs},v1=${failSig}`);
check("failed payment webhook does not invent a paid row", failResult.status === 200 && (await db.prepare("SELECT count(*)::int AS n FROM payments WHERE event_id = ? AND status = 'paid'").bind(eventId).first<{ n: number }>())?.n === 1);

const staffConfirm = await throws(() => confirmBooking(eventId, staff), "owner");
check("ordinary staff cannot confirm", staffConfirm.includes("owner"), staffConfirm);

await setBookingHold(eventId, owner, pastHold());
const expired = await throws(() => confirmBooking(eventId, owner), "hold");
check("expired hold before approval is refused", expired.includes("hold"), expired);

await setBookingHold(eventId, owner, futureHold());
const completeEarly = await throws(() => completeBooking(eventId, owner), "Confirm");
check("unconfirmed booking cannot be completed", completeEarly.includes("Confirm"), completeEarly);

type Lite = {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  transaction: <T>(fn: (tx: Lite) => Promise<T>) => Promise<T>;
};
const cache = (globalThis as unknown as { __mbPglite?: Map<string, Promise<Lite>> }).__mbPglite;
const lite = await cache?.get("memory");
if (!lite) throw new Error("pglite cache missing");

const race = await Promise.allSettled([
  confirmBooking(eventId, owner, "race-a"),
  confirmBooking(eventId, owner, "race-b"),
]);
const confirmed = await db.prepare("SELECT status, confirmed_at FROM bookings WHERE event_id = ?").bind(eventId).first<{ status: string; confirmed_at: string | null }>();
const historyConfirms = await db.prepare("SELECT count(*)::int AS n FROM booking_history WHERE event_id = ? AND action = 'confirm'").bind(eventId).first<{ n: number }>();
check("two simultaneous confirmation attempts leave one confirmed booking", confirmed?.status === "confirmed" && !!confirmed.confirmed_at && Number(historyConfirms?.n) === 1, JSON.stringify({ race: race.map((r) => r.status), confirmed, history: historyConfirms?.n }));

const auditConfirm = await db.prepare("SELECT action FROM admin_audit WHERE subject_id = ? AND action = 'booking_confirmed' ORDER BY created_at DESC LIMIT 1").bind(eventId).first<{ action: string }>();
check("owner confirmation writes an audit record", auditConfirm?.action === "booking_confirmed");

workflow = await getSalesWorkflow(eventId);
check(
  "workflow shows confirmed booking and next staff action",
  workflow.bookingStatus === "confirmed" && workflow.steps.find((s) => s.key === "confirmed")?.done === true && /staff|complete/i.test(workflow.nextAction),
  workflow.nextAction,
);

const detail = await getBooking(eventId);
check("event page payload includes workflow next action", !!detail.workflow?.nextAction && detail.workflow.bookingStatus === "confirmed");

const otherDate = "2035-06-21";
const blocker = crypto.randomUUID();
const otherCustomer = await ensureCustomer({ name: "Blocker", email: "blocker-sales@example.com", phone: "" });
await createEventRecord({ id: blocker, customerId: otherCustomer, name: "Blocker", eventType: "Wedding", eventDate: otherDate, startTime: "16:00", endTime: "20:00" });
await setBookingHold(blocker, owner, futureHold());
await confirmBooking(blocker, owner);

const rescheduleBlocked = await throws(() => rescheduleBooking(eventId, owner, {
  eventDate: otherDate,
  startTime: "4:00 PM",
  endTime: "11:00 PM",
  timezone: "America/New_York",
}), "already reserved");
check("reschedule into a blocked date is refused", rescheduleBlocked.includes("already reserved"), rescheduleBlocked);

const openDate = "2035-06-22";
await rescheduleBooking(eventId, owner, {
  eventDate: openDate,
  startTime: "4:00 PM",
  endTime: "11:00 PM",
  timezone: "America/New_York",
  note: "moved after confirm",
});
const afterMove = await db.prepare("SELECT event_date::text AS event_date FROM events WHERE id = ?").bind(eventId).first<{ event_date: string }>();
check("confirmed booking can reschedule to an open date", afterMove?.event_date === openDate, afterMove?.event_date);

await cancelBooking(eventId, owner, "client withdrew");
const canceled = await db.prepare("SELECT status, hold_until FROM bookings WHERE event_id = ?").bind(eventId).first<{ status: string; hold_until: string | null }>();
const cancelHistory = await db.prepare("SELECT count(*)::int AS n FROM booking_history WHERE event_id = ? AND action = 'cancel'").bind(eventId).first<{ n: number }>();
check("cancellation preserves history and releases the hold", canceled?.status === "canceled" && canceled.hold_until == null && Number(cancelHistory?.n) >= 1, JSON.stringify(canceled));
workflow = await getSalesWorkflow(eventId);
check("canceled workflow keeps ids and explains release", workflow.eventId === eventId && workflow.customerId === customerId && workflow.nextAction.toLowerCase().includes("cancel"), workflow.nextAction);

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
