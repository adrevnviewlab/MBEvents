process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@comms.test";
process.env.MB_NOTIFY_EMAIL = "office@comms.test";
process.env.MB_PUBLIC_ORIGIN = "https://example.test";
delete process.env.RESEND_API_KEY;
delete process.env.MB_FROM_EMAIL;
delete process.env.MB_SMS_ACCOUNT_SID;
delete process.env.MB_SMS_AUTH_TOKEN;
delete process.env.MB_SMS_FROM;
delete process.env.MB_SMS_ENABLED;
delete process.env.MB_EMAIL_SANDBOX;
delete process.env.MB_EMAIL_MODE;

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

const { getDatabase } = await import("../lib/env.ts");
const { createInquiry, updateLead, addLeadTask, bookLead } = await import("../lib/crm.ts");
const { leadSchema } = await import("../lib/lead.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const {
  acceptProposal,
  approveCatalogPrice,
  publishCatalogPrice,
  savePackage,
  savePricingRule,
  sendQuote,
} = await import("../lib/finance.ts");
const {
  confirmBooking,
  cancelBooking,
  completeBooking,
  rescheduleBooking,
  setBookingHold,
} = await import("../lib/calendar.ts");
const { createTemplate, smsApproved, deliverRun } = await import("../lib/automations.ts");
const {
  notifyInquiryOffice,
  notifyInquiryConfirmation,
  notifyQuoteSent,
  notifyPaymentReceipt,
  notifyInviteDelivery,
  emailSandboxActive,
  smsApproved: smsApprovedComm,
} = await import("../lib/communications.ts");
const { integrationFlags } = await import("../lib/config.ts");
const { addGuest } = await import("../lib/invites.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const owner = { email: "owner@comms.test", userId: null as string | null };
const origin = "https://example.test";

await saveBusinessSettings({
  companyName: "MB Events",
  timezone: "America/New_York",
  requireOwnerConfirm: true,
  requireStaffBeforeConfirm: false,
  actorEmail: owner.email,
});

check("sms flag off without approval", (await smsApproved()) === false && (await smsApprovedComm()) === false);
check("integration flags keep sms off", integrationFlags().sms === false);
check("email sandbox inactive by default", emailSandboxActive() === false);

const smsBlocked = await throws(
  () => createTemplate({ kind: "inquiry_confirmation", channel: "sms", subject: "Hi", body: "Hi", active: true }, owner),
  "SMS is disabled",
);
check("sms template create blocked until approved", Boolean(smsBlocked) && smsBlocked.includes("SMS is disabled"), smsBlocked);

async function countTopic(topic: string, status?: string) {
  const row = status
    ? await db!.prepare("SELECT count(*)::int AS n FROM notifications WHERE topic = ? AND status = ?").bind(topic, status).first<{ n: number }>()
    : await db!.prepare("SELECT count(*)::int AS n FROM notifications WHERE topic = ?").bind(topic).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function countJobs(kind: string, entityId?: string) {
  const row = entityId
    ? await db!.prepare(
      `SELECT count(*)::int AS n FROM message_jobs j
       JOIN automation_templates t ON t.id = j.template_id
       WHERE t.kind = ? AND j.entity_id = ?`,
    ).bind(kind, entityId).first<{ n: number }>()
    : await db!.prepare(
      `SELECT count(*)::int AS n FROM message_jobs j
       JOIN automation_templates t ON t.id = j.template_id
       WHERE t.kind = ?`,
    ).bind(kind).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

const lead = await createInquiry(leadSchema.parse({
  source: "contact",
  name: "Casey Comms",
  email: "casey-comms@example.com",
  phone: "5550404",
  eventType: "Wedding",
  eventDate: "2037-05-01",
  services: [],
}));

const office = await notifyInquiryOffice({
  leadId: lead.id,
  origin,
  name: "Casey Comms",
  source: "contact",
  eventType: "Wedding",
  eventDate: "2037-05-01",
  email: "casey-comms@example.com",
  phone: "5550404",
});
check("inquiry office fails closed without email provider", office.sent === false && office.status === "failed", JSON.stringify(office));
check("inquiry office recorded as failed not sent", (await countTopic("inquiry_office", "sent")) === 0 && (await countTopic("inquiry_office", "failed")) >= 1);

const confirm = await notifyInquiryConfirmation({
  leadId: lead.id,
  email: "casey-comms@example.com",
  name: "Casey Comms",
  eventType: "Wedding",
  eventDate: "2037-05-01",
  origin,
});
check("inquiry confirmation not marked sent without provider", confirm.sent === false && confirm.status === "failed");

const again = await notifyInquiryConfirmation({
  leadId: lead.id,
  email: "casey-comms@example.com",
  name: "Casey Comms",
  eventType: "Wedding",
  eventDate: "2037-05-01",
  origin,
});
check(
  "inquiry confirmation keeps a single dedupe row",
  (await countTopic("inquiry_confirmation")) === 1 && again.sent === false,
  JSON.stringify({ again, count: await countTopic("inquiry_confirmation") }),
);

await updateLead(lead.id, { consultationAt: "2037-04-01T18:00:00.000Z" }, owner);
check("consultation notification recorded", (await countTopic("consultation")) >= 1);
check("consultation reminder scheduled", (await countJobs("consultation_reminder", lead.id)) >= 1);

const task = await addLeadTask(lead.id, { title: "Call Casey", dueOn: "2037-03-20", assigneeId: null }, owner);
check("follow-up notification recorded", (await countTopic("follow_up")) >= 1 && !!task.id);

const booked = await bookLead({
  leadId: lead.id,
  actor: owner,
  details: {
    clientNames: "Casey Comms",
    email: "casey-comms@example.com",
    phone: "5550404",
    eventType: "Wedding",
    eventDate: "2037-05-01",
    venueName: "Hall",
    guestCount: "100",
  },
});
check("planner access notification recorded", (await countTopic("planner_access")) >= 1);
const plannerNotif = await db.prepare(
  "SELECT topic, status, dedupe_key FROM notifications WHERE topic = 'planner_access' ORDER BY created_at DESC LIMIT 1",
).first<{ topic: string; status: string; dedupe_key: string }>();
check(
  "planner access not marked sent without provider",
  plannerNotif?.status === "failed" || plannerNotif?.status === "queued",
  JSON.stringify(plannerNotif),
);
check("planner password not stored on notification row", !JSON.stringify(plannerNotif).includes(booked.password));

const eventId = booked.id;
await rescheduleBooking(eventId, owner, {
  eventDate: "2037-05-01",
  startTime: "4:00 PM",
  endTime: "11:00 PM",
  timezone: "America/New_York",
});
await setBookingHold(eventId, owner, new Date(Date.now() + 86400000).toISOString());

const pkg = await savePackage({ name: "Comms Pack", priceCents: 12000, actorEmail: owner.email });
await approveCatalogPrice({ kind: "package", id: pkg.id, actorEmail: owner.email });
await publishCatalogPrice({ kind: "package", id: pkg.id, actorEmail: owner.email });
await savePricingRule({
  kind: "deposit",
  label: "Comms deposit",
  amountCents: 3000,
  percent: null,
  active: true,
  actorEmail: owner.email,
});
const quoted = await sendQuote({ eventId, packageId: pkg.id, actorEmail: owner.email });
check("quote delivery notification recorded", (await countTopic("quote_sent")) >= 1 && !!quoted.versionId);

const accepted = await acceptProposal({ eventId, acceptedBy: "Casey Comms", actorEmail: "casey-comms@example.com" });
check("deposit invoice notification recorded", (await countTopic("deposit_invoice")) >= 1 && !!accepted.depositPaymentId);

const receipt = await notifyPaymentReceipt({
  eventId,
  email: "casey-comms@example.com",
  amountCents: 3000,
  paymentId: accepted.depositPaymentId!,
  origin,
});
check("payment receipt failure path does not claim emailed", receipt.emailed === false && receipt.sent === false);

await confirmBooking(eventId, owner);
check("booking confirmation notification recorded", (await countTopic("booking_confirmed")) >= 1);
check("event preparation scheduled after confirm", (await countJobs("event_preparation", eventId)) >= 1);

await rescheduleBooking(eventId, owner, {
  eventDate: "2037-05-08",
  startTime: "5:00 PM",
  endTime: "11:00 PM",
  timezone: "America/New_York",
  note: "moved",
});
check("reschedule notification recorded", (await countTopic("booking_rescheduled")) >= 1);

const guest = await addGuest(eventId, { name: "Guest One", email: "guest-comms@example.com", phone: "", partySize: 1, table: "", isMinor: false }, origin);
check("rsvp reminder scheduled for guest", (await countJobs("rsvp_reminder", guest.id)) === 1);

const invite = await notifyInviteDelivery({
  eventId,
  email: "guest-comms@example.com",
  subject: "You're invited",
  body: "Join us — open your invite link from the host.",
  jobId: crypto.randomUUID(),
  origin,
});
check("invite delivery not marked sent without provider", invite.sent === false);

await completeBooking(eventId, owner);
check("review request scheduled after complete", (await countJobs("review_request", eventId)) === 1);
check("referral ask scheduled after complete", (await countJobs("referral", eventId)) === 1);

const review = await db.prepare(
  `SELECT j.id, j.last_error FROM message_jobs j
   JOIN automation_templates t ON t.id = j.template_id
   WHERE t.kind = 'review_request' AND j.entity_id = ?`,
).bind(eventId).first<{ id: string; last_error: string }>();
if (review) {
  await db.prepare("UPDATE message_jobs SET next_attempt_at = now() - interval '1 minute' WHERE id = ?").bind(review.id).run();
  const delivered = await deliverRun(review.id);
  const after = await db.prepare("SELECT status, last_error FROM message_jobs WHERE id = ?").bind(review.id).first<{ status: string; last_error: string }>();
  check(
    "review request blocked without marketing consent",
    delivered.sent === false && after?.status !== "sent" && (after?.last_error === "marketing_opt_in" || after?.last_error === "email_not_configured"),
    JSON.stringify({ delivered, after }),
  );
} else {
  check("review request blocked without marketing consent", false, "missing job");
}

await cancelBooking(eventId, owner, "test cancel");
check("cancellation notification recorded", (await countTopic("booking_canceled")) >= 1);

process.env.MB_EMAIL_SANDBOX = "true";
const sandboxed = await notifyQuoteSent({
  eventId,
  email: "casey-comms@example.com",
  packageName: "Comms Pack",
  invoiceTotalCents: 12000,
  origin,
  versionId: crypto.randomUUID(),
});
check("sandbox without provider still fails closed", sandboxed.sent === false);
delete process.env.MB_EMAIL_SANDBOX;

const sentRows = await db.prepare("SELECT count(*)::int AS n FROM notifications WHERE status = 'sent'").first<{ n: number }>();
check("no messages marked sent when provider unavailable", Number(sentRows?.n) === 0, String(sentRows?.n));

const jobSent = await db.prepare("SELECT count(*)::int AS n FROM message_jobs WHERE status = 'sent'").first<{ n: number }>();
check("no automation jobs marked sent without provider", Number(jobSent?.n) === 0, String(jobSent?.n));

const failed = results.filter((result) => !result.pass);
for (const result of results) {
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
