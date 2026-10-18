import { notifyRow } from "@/lib/audit";
import { emailConfigured, smsConfigured, scheduleAutomation, createTemplate, listTemplates } from "@/lib/automations";
import { env } from "@/lib/env";
import { notifyAccount, notifyClient, notifyMb } from "@/lib/notify";

/**
 * Transactional + lifecycle communications.
 * Email uses Resend when configured. Without keys, messages stay failed/unsent (never marked sent).
 * SMS stays disabled until MB_SMS_ENABLED=true and business_settings.sms_enabled (Michael approval).
 * Secrets (passwords, invite tokens) are never written to logs.
 */

export type CommTopic =
  | "inquiry_office"
  | "inquiry_confirmation"
  | "consultation"
  | "follow_up"
  | "quote_sent"
  | "deposit_invoice"
  | "payment_receipt"
  | "booking_confirmed"
  | "booking_rescheduled"
  | "booking_canceled"
  | "planner_access"
  | "invite_delivery"
  | "rsvp_reminder"
  | "event_preparation"
  | "review_request";

function database() {
  return env.DB;
}

/** SMS requires explicit env approval AND business setting. Provider alone is never enough. */
export async function smsApproved(): Promise<boolean> {
  if ((process.env.MB_SMS_ENABLED ?? "").trim().toLowerCase() !== "true") return false;
  if (!smsConfigured()) return false;
  const row = await database()?.prepare("SELECT sms_enabled FROM business_settings WHERE id = 'default'").first<{ sms_enabled: boolean }>();
  return row?.sms_enabled === true;
}

export function emailSandboxActive() {
  const mode = (process.env.MB_EMAIL_SANDBOX ?? process.env.MB_EMAIL_MODE ?? "").trim().toLowerCase();
  return mode === "1" || mode === "true" || mode === "sandbox" || mode === "test";
}

function redactSecrets(text: string) {
  return text
    .replace(/password[=:\s]+\S+/gi, "password=[redacted]")
    .replace(/token[=:\s]+\S+/gi, "token=[redacted]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[redacted]");
}

async function alreadySent(topic: string, dedupeKey: string) {
  if (!dedupeKey || !database()) return false;
  const row = await database()!.prepare(
    "SELECT id FROM notifications WHERE topic = ? AND dedupe_key = ? AND status = 'sent' LIMIT 1",
  ).bind(topic, dedupeKey).first<{ id: string }>();
  return !!row;
}

async function record(input: {
  topic: CommTopic;
  dedupeKey: string;
  status: "queued" | "sent" | "failed";
  eventId?: string | null;
  customerId?: string | null;
  channel?: "email" | "sms";
}) {
  await notifyRow({
    eventId: input.eventId,
    customerId: input.customerId,
    channel: input.channel ?? "email",
    topic: input.topic,
    status: input.status,
    dedupeKey: input.dedupeKey,
  });
}

async function deliverEmail(input: {
  topic: CommTopic;
  dedupeKey: string;
  to: string;
  subject: string;
  lines: string[];
  link?: { url: string; label: string };
  eventId?: string | null;
  customerId?: string | null;
  audience: "office" | "customer";
  tab?: string;
  origin?: string;
}) {
  const dedupeKey = input.dedupeKey.slice(0, 160);
  if (await alreadySent(input.topic, dedupeKey)) {
    return { sent: false, status: "duplicate" as const };
  }
  await record({ topic: input.topic, dedupeKey, status: "queued", eventId: input.eventId, customerId: input.customerId });

  if (!emailConfigured()) {
    await record({ topic: input.topic, dedupeKey, status: "failed", eventId: input.eventId, customerId: input.customerId });
    return { sent: false, status: "failed" as const, reason: "email_not_configured" };
  }

  let to = input.to.trim();
  let subject = input.subject;
  const lines = input.lines.map((line) => redactSecrets(line));
  if (input.audience === "customer" && emailSandboxActive()) {
    const sink = ((env as unknown as { MB_NOTIFY_EMAIL?: string }).MB_NOTIFY_EMAIL ?? "").trim();
    if (!sink.includes("@")) {
      await record({ topic: input.topic, dedupeKey, status: "failed", eventId: input.eventId, customerId: input.customerId });
      return { sent: false, status: "failed" as const, reason: "sandbox_sink_missing" };
    }
    subject = `[SANDBOX → ${to}] ${subject}`;
    to = sink;
  }

  const origin = (input.origin || (env.MB_PUBLIC_ORIGIN ?? "")).replace(/\/$/, "");
  let sent = false;
  if (input.audience === "office") {
    const path = input.link?.url?.startsWith(origin)
      ? input.link.url.slice(origin.length) || "/admin"
      : (input.link?.url?.startsWith("/") ? input.link.url : "/admin");
    sent = await notifyMb(origin || "http://localhost", input.eventId || "", subject, lines, path);
  } else if (input.tab != null) {
    sent = await notifyClient(origin || "http://localhost", to, subject, lines, input.tab);
  } else {
    sent = await notifyAccount(to, subject, lines, input.link);
  }

  // Never mark sent when the provider did not accept the message.
  const status = sent ? "sent" as const : "failed" as const;
  await record({ topic: input.topic, dedupeKey, status, eventId: input.eventId, customerId: input.customerId });
  return { sent, status };
}

async function ensureLifecycleTemplate(kind: string, subject: string, body: string, delayMinutes: number) {
  const templates = await listTemplates();
  const existing = templates.find((item) => item.kind === kind && item.channel === "email" && item.active);
  if (existing) return existing.id;
  // SMS templates are never auto-created. Email-only system templates for delayed lifecycle mail.
  const created = await createTemplate({
    kind,
    channel: "email",
    delayMinutes,
    subject,
    body,
    active: true,
  }, { email: "system@communications", userId: null });
  return created.id;
}

async function scheduleLifecycle(input: {
  kind: string;
  entityType: "lead" | "event" | "guest";
  entityId: string;
  occurrence: string;
  subject: string;
  body: string;
  delayMinutes: number;
}) {
  try {
    const templateId = await ensureLifecycleTemplate(input.kind, input.subject, input.body, input.delayMinutes);
    return await scheduleAutomation({
      templateId,
      entityType: input.entityType,
      entityId: input.entityId,
      occurrence: input.occurrence,
    });
  } catch {
    return { id: "", created: false };
  }
}

export async function notifyInquiryOffice(input: {
  leadId: string;
  origin: string;
  name: string;
  source: string;
  eventType: string;
  eventDate?: string | null;
  email: string;
  phone: string;
  venueName?: string | null;
  services?: string[];
  notes?: string | null;
}) {
  return deliverEmail({
    topic: "inquiry_office",
    dedupeKey: `inquiry_office:${input.leadId}`,
    to: ((env as unknown as { MB_NOTIFY_EMAIL?: string }).MB_NOTIFY_EMAIL ?? ""),
    subject: `New ${input.source} inquiry from ${input.name}`,
    lines: [
      `${input.eventType}${input.eventDate ? ` on ${input.eventDate}` : ""}`,
      [input.email, input.phone].filter(Boolean).join(" · "),
      input.venueName ? `Venue: ${input.venueName}` : "",
      input.services?.length ? `Services: ${input.services.join(", ")}` : "",
      input.notes ?? "",
    ].filter(Boolean),
    audience: "office",
    origin: input.origin,
    link: { url: `${input.origin.replace(/\/$/, "")}/admin/leads/${input.leadId}`, label: "Open lead" },
    eventId: null,
  });
}

export async function notifyInquiryConfirmation(input: { leadId: string; email: string; name: string; eventType: string; eventDate?: string | null; origin: string }) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const, reason: "missing_recipient" };
  const immediate = await deliverEmail({
    topic: "inquiry_confirmation",
    dedupeKey: `inquiry_confirmation:${input.leadId}`,
    to: input.email,
    subject: "We received your MB Events inquiry",
    lines: [
      `Hi ${input.name},`,
      `Thanks for reaching out about your ${input.eventType}${input.eventDate ? ` on ${input.eventDate}` : ""}.`,
      "An MB Event Specialist will follow up shortly. An inquiry does not reserve a date.",
    ],
    audience: "customer",
    origin: input.origin,
    link: { url: `${input.origin.replace(/\/$/, "")}/`, label: "Visit MB Events" },
  });
  await scheduleLifecycle({
    kind: "inquiry_confirmation",
    entityType: "lead",
    entityId: input.leadId,
    occurrence: "confirm",
    subject: "Thanks for contacting MB Events",
    body: "We received your inquiry and will follow up soon. An inquiry does not reserve a date.",
    delayMinutes: 0,
  });
  return immediate;
}

export async function notifyConsultation(input: { leadId: string; email: string; name: string; when: string; origin: string }) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const };
  const result = await deliverEmail({
    topic: "consultation",
    dedupeKey: `consultation:${input.leadId}:${input.when}`,
    to: input.email,
    subject: "Your MB Events consultation",
    lines: [`Hi ${input.name},`, `Your consultation is set for ${input.when}.`, "Reply to this email or call (855) 627-6863 if you need to reschedule."],
    audience: "customer",
    origin: input.origin,
  });
  await scheduleLifecycle({
    kind: "consultation_reminder",
    entityType: "lead",
    entityId: input.leadId,
    occurrence: input.when.slice(0, 120),
    subject: "Reminder: MB Events consultation",
    body: `Your consultation is coming up (${input.when}).`,
    delayMinutes: 60,
  });
  return result;
}

export async function notifyFollowUp(input: { leadId: string; email: string; name: string; title: string; dueOn: string; taskId: string; origin: string }) {
  // Office-facing follow-up reminder (staff), not a marketing blast.
  return deliverEmail({
    topic: "follow_up",
    dedupeKey: `follow_up:${input.taskId}`,
    to: ((env as unknown as { MB_NOTIFY_EMAIL?: string }).MB_NOTIFY_EMAIL ?? ""),
    subject: `Follow-up due ${input.dueOn}: ${input.title}`,
    lines: [`Lead: ${input.name}`, `Task: ${input.title}`, `Due: ${input.dueOn}`, input.email].filter(Boolean),
    audience: "office",
    origin: input.origin,
    link: { url: `${input.origin.replace(/\/$/, "")}/admin/leads/${input.leadId}`, label: "Open lead" },
  });
}

export async function notifyQuoteSent(input: {
  eventId: string;
  email: string;
  packageName: string;
  invoiceTotalCents: number;
  origin: string;
  versionId: string;
}) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const };
  const dollars = (input.invoiceTotalCents / 100).toFixed(2);
  const result = await deliverEmail({
    topic: "quote_sent",
    dedupeKey: `quote_sent:${input.versionId}`,
    to: input.email,
    subject: "Your MB Events proposal is ready",
    lines: [
      `Your proposal for ${input.packageName} is ready to review.`,
      `Quoted total: $${dollars}.`,
      "Open your planner to review and accept. Acceptance creates a deposit obligation when a deposit rule is configured; it does not confirm the booking.",
    ],
    audience: "customer",
    origin: input.origin,
    tab: "Documents",
    eventId: input.eventId,
  });
  await scheduleLifecycle({
    kind: "proposal_follow_up",
    entityType: "event",
    entityId: input.eventId,
    occurrence: input.versionId,
    subject: "Reminder: your MB Events proposal",
    body: "Your proposal is waiting in your planner when you are ready to review it.",
    delayMinutes: 24 * 60,
  });
  return result;
}

export async function notifyDepositInvoice(input: {
  eventId: string;
  email: string;
  label: string;
  amountCents: number;
  dueOn: string | null;
  paymentId: string;
  origin: string;
}) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const };
  const dollars = (input.amountCents / 100).toFixed(2);
  return deliverEmail({
    topic: "deposit_invoice",
    dedupeKey: `deposit_invoice:${input.paymentId}`,
    to: input.email,
    subject: "Your MB Events deposit is due",
    lines: [
      `${input.label}: $${dollars}${input.dueOn ? ` due ${input.dueOn}` : ""}.`,
      "Paying a deposit does not confirm the booking. Confirmation is a separate owner approval step.",
      "Open your planner Payments tab to pay securely.",
    ],
    audience: "customer",
    origin: input.origin,
    tab: "Payments",
    eventId: input.eventId,
  });
}

export async function notifyPaymentReceipt(input: {
  eventId: string;
  email: string;
  amountCents: number;
  paymentId: string;
  origin: string;
}) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const, emailed: false };
  const dollars = (input.amountCents / 100).toFixed(2);
  const result = await deliverEmail({
    topic: "payment_receipt",
    dedupeKey: `payment_receipt:${input.paymentId}`,
    to: input.email,
    subject: "Payment receipt from MB Events",
    lines: [`We received $${dollars} for your event.`, "This receipt is for that payment only."],
    audience: "customer",
    origin: input.origin,
    tab: "Payments",
    eventId: input.eventId,
  });
  return { ...result, emailed: result.sent };
}

export async function notifyBookingConfirmed(input: {
  eventId: string;
  email: string;
  name: string;
  eventDate: string | null;
  origin: string;
}) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const };
  const result = await deliverEmail({
    topic: "booking_confirmed",
    dedupeKey: `booking_confirmed:${input.eventId}`,
    to: input.email,
    subject: "Your MB Events booking is confirmed",
    lines: [
      `Hi ${input.name},`,
      `Your booking${input.eventDate ? ` for ${input.eventDate}` : ""} is confirmed.`,
      "Open your planner for next steps.",
    ],
    audience: "customer",
    origin: input.origin,
    tab: "Overview",
    eventId: input.eventId,
  });
  await scheduleLifecycle({
    kind: "event_preparation",
    entityType: "event",
    entityId: input.eventId,
    occurrence: "prep",
    subject: "Getting ready for your event",
    body: "Your booking is confirmed. Use your planner checklist as the date approaches.",
    delayMinutes: 7 * 24 * 60,
  });
  return result;
}

export async function notifyBookingRescheduled(input: {
  eventId: string;
  email: string;
  name: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  origin: string;
  note?: string;
}) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const };
  return deliverEmail({
    topic: "booking_rescheduled",
    dedupeKey: `booking_rescheduled:${input.eventId}:${input.eventDate}:${input.startTime}`,
    to: input.email,
    subject: "Your MB Events date was updated",
    lines: [
      `Hi ${input.name},`,
      `Your event is now scheduled for ${input.eventDate}, ${input.startTime}–${input.endTime}.`,
      input.note || "",
    ].filter(Boolean),
    audience: "customer",
    origin: input.origin,
    tab: "Overview",
    eventId: input.eventId,
  });
}

export async function notifyBookingCanceled(input: {
  eventId: string;
  email: string;
  name: string;
  origin: string;
}) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const };
  return deliverEmail({
    topic: "booking_canceled",
    dedupeKey: `booking_canceled:${input.eventId}`,
    to: input.email,
    subject: "Your MB Events booking was canceled",
    lines: [
      `Hi ${input.name},`,
      "Your booking has been canceled. The calendar date is released.",
      "Contact us if you would like to inquire about another date.",
    ],
    audience: "customer",
    origin: input.origin,
    eventId: input.eventId,
  });
}

export async function notifyPlannerAccess(input: {
  eventId: string;
  email: string;
  name: string;
  code: string;
  password: string;
  origin: string;
}) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const };
  // Password is included once for access delivery. It is never logged.
  return deliverEmail({
    topic: "planner_access",
    dedupeKey: `planner_access:${input.eventId}`,
    to: input.email,
    subject: "Your MB Events planner access",
    lines: [
      `Hi ${input.name},`,
      "Your client planner is ready.",
      `Planner code: ${input.code}`,
      `Temporary password: ${input.password}`,
      "Sign in at the planner link below and change your password after your first visit.",
    ],
    audience: "customer",
    origin: input.origin,
    link: { url: `${input.origin.replace(/\/$/, "")}/planner`, label: "Open your planner" },
    eventId: input.eventId,
  });
}

export async function notifyInviteDelivery(input: {
  eventId: string;
  email: string;
  subject: string;
  body: string;
  jobId: string;
  origin: string;
}) {
  if (!input.email.includes("@")) return { sent: false, status: "failed" as const };
  // Invitation tokens must not appear in logs; body may contain a public invite URL without the raw token hash.
  return deliverEmail({
    topic: "invite_delivery",
    dedupeKey: `invite_delivery:${input.jobId}`,
    to: input.email,
    subject: input.subject || "You're invited",
    lines: [input.body],
    audience: "customer",
    origin: input.origin,
    eventId: input.eventId,
  });
}

export async function scheduleRsvpReminder(input: { guestId: string; eventId: string }) {
  return scheduleLifecycle({
    kind: "rsvp_reminder",
    entityType: "guest",
    entityId: input.guestId,
    occurrence: "rsvp",
    subject: "RSVP reminder",
    body: "Please RSVP using your invitation link when you can.",
    delayMinutes: 3 * 24 * 60,
  });
}

export async function scheduleReviewRequest(input: { eventId: string }) {
  // Marketing consent is enforced again at deliverRun time.
  return scheduleLifecycle({
    kind: "review_request",
    entityType: "event",
    entityId: input.eventId,
    occurrence: "review",
    subject: "How was your event with MB Events?",
    body: "If you opted in to updates, we would love your feedback.\n\nUnsubscribe: {{unsubscribe_url}}",
    delayMinutes: 2 * 24 * 60,
  });
}

export async function scheduleReferralRequest(input: { eventId: string }) {
  // Marketing consent is enforced again at deliverRun time.
  return scheduleLifecycle({
    kind: "referral",
    entityType: "event",
    entityId: input.eventId,
    occurrence: "referral",
    subject: "Know someone planning a celebration?",
    body: "If you opted in to updates, feel free to share MB Events with friends planning a night of their own.\n\nUnsubscribe: {{unsubscribe_url}}",
    delayMinutes: 14 * 24 * 60,
  });
}

export async function customerEmailForEvent(eventId: string) {
  const row = await database()?.prepare(
    `SELECT c.email, c.name, c.id AS customer_id, e.event_date::text AS event_date
     FROM events e LEFT JOIN customers c ON c.id = e.customer_id WHERE e.id = ?`,
  ).bind(eventId).first<{ email: string | null; name: string | null; customer_id: string | null; event_date: string | null }>();
  return row;
}
