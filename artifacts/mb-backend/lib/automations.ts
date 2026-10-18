import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/places";

export const automationKinds = [
  "inquiry_confirmation",
  "sales_follow_up",
  "consultation_reminder",
  "proposal_follow_up",
  "deposit_reminder",
  "planning_deadline",
  "rsvp_reminder",
  "event_preparation",
  "thank_you",
  "review_request",
  "referral",
] as const;

export type AutomationKind = (typeof automationKinds)[number];

export const marketingKinds = ["review_request", "referral"] as const;

const kindSet = new Set<string>(automationKinds);
const marketingSet = new Set<string>(marketingKinds);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TemplateRow = {
  id: string;
  kind: string;
  channel: string;
  delay_minutes: number;
  subject: string;
  body: string;
  active: boolean;
};

type RunRow = {
  id: string;
  template_id: string;
  entity_type: string;
  entity_id: string;
  occurrence: string;
  customer_id: string | null;
  to_address: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  due: boolean;
};

type Target = { recipient: string; customerId: string | null; eventId: string | null; guestId: string | null };

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function flagged(value: unknown) {
  return value === true || value === "t" || value === "true" || value === 1;
}

function optedIn(value: unknown) {
  return flagged(value);
}

function clean(value: string | null | undefined, max: number) {
  return (value ?? "").trim().slice(0, max);
}

function assertKind(kind: string): AutomationKind {
  if (!kindSet.has(kind)) throw new AppError("Choose an automation kind.", 400);
  return kind as AutomationKind;
}

function assertChannel(channel: string) {
  if (channel !== "email" && channel !== "sms") throw new AppError("Choose email or SMS.", 400);
  return channel;
}

function delayOf(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 527040) throw new AppError("Enter the delay in minutes.", 400);
  return value;
}

export function emailConfigured() {
  return Boolean(env.RESEND_API_KEY && env.MB_FROM_EMAIL);
}

export function smsConfigured() {
  return Boolean(env.MB_SMS_ACCOUNT_SID && env.MB_SMS_AUTH_TOKEN && env.MB_SMS_FROM);
}

/** SMS stays off until Michael approves (MB_SMS_ENABLED=true and business_settings.sms_enabled). */
export async function smsApproved() {
  if ((process.env.MB_SMS_ENABLED ?? "").trim().toLowerCase() !== "true") return false;
  if (!smsConfigured()) return false;
  const row = await database().prepare("SELECT sms_enabled FROM business_settings WHERE id = 'default'").first<{ sms_enabled: boolean }>();
  return row?.sms_enabled === true;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function templateView(row: TemplateRow) {
  return {
    id: row.id,
    kind: row.kind,
    channel: row.channel,
    delayMinutes: Number(row.delay_minutes),
    subject: row.subject,
    body: row.body,
    active: flagged(row.active),
  };
}

async function resolveTarget(entityType: string, entityId: string, channel: string): Promise<Target> {
  const db = database();
  if (entityType === "lead") {
    const lead = await db.prepare("SELECT customer_id, email, phone FROM leads WHERE id = ?").bind(entityId).first<{ customer_id: string | null; email: string; phone: string }>();
    if (!lead) throw new AppError("Lead not found.", 404);
    const booked = await db.prepare("SELECT converted_event_id FROM leads WHERE id = ?").bind(entityId).first<{ converted_event_id: string | null }>();
    return { customerId: lead.customer_id, recipient: channel === "sms" ? lead.phone : lead.email, eventId: booked?.converted_event_id ?? null, guestId: null };
  }
  if (entityType === "event") {
    const event = await db.prepare(
      `SELECT e.customer_id, c.email, c.phone
       FROM events e LEFT JOIN customers c ON c.id = e.customer_id
       WHERE e.id = ?`,
    ).bind(entityId).first<{ customer_id: string | null; email: string | null; phone: string | null }>();
    if (!event) throw new AppError("Event not found.", 404);
    return { customerId: event.customer_id, recipient: channel === "sms" ? (event.phone ?? "") : (event.email ?? ""), eventId: entityId, guestId: null };
  }
  const guest = await db.prepare(
    `SELECT g.email, g.phone, g.event_id, e.customer_id
     FROM guests g JOIN events e ON e.id = g.event_id
     WHERE g.id = ?`,
  ).bind(entityId).first<{ email: string; phone: string; event_id: string; customer_id: string | null }>();
  if (!guest) throw new AppError("Guest not found.", 404);
  return { customerId: guest.customer_id, recipient: channel === "sms" ? guest.phone : guest.email, eventId: guest.event_id, guestId: entityId };
}

function checkEntity(kind: string, entityType: string) {
  if (kind === "rsvp_reminder" && entityType !== "guest") throw new AppError("RSVP reminders go to the guest on that invitation.", 400);
  if (kind !== "rsvp_reminder" && entityType === "guest") throw new AppError("That message uses the contact stored on the lead or event.", 400);
  if (marketingSet.has(kind) && entityType === "guest") throw new AppError("Marketing messages use the customer contact.", 400);
}

export async function createTemplate(input: {
  kind: string;
  channel: string;
  delayMinutes?: number;
  subject?: string | null;
  body?: string | null;
  active?: boolean;
}, actor: Actor) {
  const kind = assertKind(input.kind);
  const channel = assertChannel(input.channel);
  if (channel === "sms" && !(await smsApproved())) {
    throw new AppError("SMS is disabled until Michael approves its use and provider.", 403);
  }
  const delayMinutes = delayOf(input.delayMinutes ?? 0);
  const subject = clean(input.subject, 200);
  const body = clean(input.body, 8000);
  const active = input.active === true;
  const id = crypto.randomUUID();
  await database().prepare(
    `INSERT INTO automation_templates (id, kind, channel, delay_minutes, subject, body, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, kind, channel, delayMinutes, subject, body, active).run();
  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    ip: actor.ip,
    action: "template_changed",
    entity: "automation_templates",
    subjectId: id,
    after: { kind, channel, delayMinutes, subject, body, active },
  });
  return { id, kind, channel, delayMinutes, subject, body, active };
}

export async function updateTemplate(id: string, patch: {
  kind?: string;
  channel?: string;
  delayMinutes?: number;
  subject?: string;
  body?: string;
  active?: boolean;
}, actor: Actor) {
  if (!uuidPattern.test(id)) throw new AppError("Template not found.", 404);
  const current = await database().prepare(
    "SELECT id, kind, channel, delay_minutes, subject, body, active FROM automation_templates WHERE id = ?",
  ).bind(id).first<TemplateRow>();
  if (!current) throw new AppError("Template not found.", 404);
  const next = {
    kind: patch.kind !== undefined ? assertKind(patch.kind) : current.kind,
    channel: patch.channel !== undefined ? assertChannel(patch.channel) : current.channel,
    delayMinutes: patch.delayMinutes !== undefined ? delayOf(patch.delayMinutes) : Number(current.delay_minutes),
    subject: patch.subject !== undefined ? clean(patch.subject, 200) : current.subject,
    body: patch.body !== undefined ? clean(patch.body, 8000) : current.body,
    active: patch.active !== undefined ? patch.active : flagged(current.active),
  };
  await database().prepare(
    `UPDATE automation_templates
     SET kind = ?, channel = ?, delay_minutes = ?, subject = ?, body = ?, active = ?, updated_at = now()
     WHERE id = ?`,
  ).bind(next.kind, next.channel, next.delayMinutes, next.subject, next.body, next.active, id).run();
  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    ip: actor.ip,
    action: "template_changed",
    entity: "automation_templates",
    subjectId: id,
    before: templateView(current),
    after: next,
  });
  return { id, ...next };
}

export async function listTemplates() {
  const rows = await database().prepare(
    "SELECT id, kind, channel, delay_minutes, subject, body, active FROM automation_templates ORDER BY created_at",
  ).all<TemplateRow>();
  return rows.results.map(templateView);
}

export async function listRuns() {
  const rows = await database().prepare(
    `SELECT j.id, j.template_id, t.kind, j.entity_type, j.entity_id, j.occurrence, j.to_address AS recipient, j.status,
            j.attempt_count AS attempts, j.max_attempts, j.next_attempt_at AS scheduled_for, j.sent_at, j.last_error
     FROM message_jobs j
     JOIN automation_templates t ON t.id = j.template_id
     ORDER BY j.created_at DESC
     LIMIT 200`,
  ).all<{
    id: string; template_id: string; kind: string; entity_type: string; entity_id: string; occurrence: string;
    recipient: string; status: string; attempts: number; max_attempts: number; scheduled_for: string; sent_at: string | null; last_error: string;
  }>();
  return rows.results.map((row) => ({
    id: row.id,
    templateId: row.template_id,
    kind: row.kind,
    entityType: row.entity_type,
    entityId: row.entity_id,
    occurrence: row.occurrence,
    recipient: row.recipient,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    lastError: row.last_error,
  }));
}

async function ensureUnsubscribeToken(customerId: string) {
  const db = database();
  const existing = await db.prepare("SELECT unsubscribe_token FROM customers WHERE id = ?").bind(customerId).first<{ unsubscribe_token: string | null }>();
  if (!existing) return "";
  if (existing.unsubscribe_token) return existing.unsubscribe_token;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await db.prepare("UPDATE customers SET unsubscribe_token = ? WHERE id = ? AND unsubscribe_token IS NULL").bind(token, customerId).run();
  const saved = await db.prepare("SELECT unsubscribe_token FROM customers WHERE id = ?").bind(customerId).first<{ unsubscribe_token: string | null }>();
  return saved?.unsubscribe_token ?? token;
}

export async function scheduleAutomation(input: {
  templateId: string;
  entityType: "lead" | "event" | "guest";
  entityId: string;
  occurrence?: string | null;
}) {
  if (!uuidPattern.test(input.templateId)) throw new AppError("Template not found.", 404);
  if (!uuidPattern.test(input.entityId)) throw new AppError("That record was not found.", 404);
  if (input.entityType !== "lead" && input.entityType !== "event" && input.entityType !== "guest") {
    throw new AppError("Choose a lead, event, or guest.", 400);
  }
  const template = await database().prepare(
    "SELECT id, kind, channel, delay_minutes, subject, body, active FROM automation_templates WHERE id = ?",
  ).bind(input.templateId).first<TemplateRow>();
  if (!template) throw new AppError("Template not found.", 404);
  if (!flagged(template.active)) throw new AppError("Turn the template on before scheduling it.", 400);
  checkEntity(template.kind, input.entityType);
  const target = await resolveTarget(input.entityType, input.entityId, template.channel);
  if (marketingSet.has(template.kind) && target.customerId) await ensureUnsubscribeToken(target.customerId);
  const occurrence = clean(input.occurrence, 120);
  const id = crypto.randomUUID();
  const inserted = await database().prepare(
    `INSERT INTO message_jobs (
       id, event_id, guest_id, channel, kind, to_address, subject, body,
       template_id, entity_type, entity_id, occurrence, customer_id, next_attempt_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now() + (? * interval '1 minute'))
     ON CONFLICT (template_id, entity_type, entity_id, occurrence) WHERE template_id IS NOT NULL DO NOTHING
     RETURNING id`,
  ).bind(
    id, target.eventId, target.guestId, template.channel, template.kind, clean(target.recipient, 200), template.subject, template.body,
    template.id, input.entityType, input.entityId, occurrence, target.customerId, Number(template.delay_minutes),
  ).first<{ id: string }>();
  if (inserted) return { id: inserted.id, created: true };
  const existing = await database().prepare(
    "SELECT id FROM message_jobs WHERE template_id = ? AND entity_type = ? AND entity_id = ? AND occurrence = ?",
  ).bind(template.id, input.entityType, input.entityId, occurrence).first<{ id: string }>();
  if (!existing) throw new AppError("Could not schedule that automation.", 500);
  return { id: existing.id, created: false };
}

async function sendEmail(to: string, subject: string, body: string) {
  const key = env.RESEND_API_KEY;
  const from = env.MB_FROM_EMAIL;
  if (!key || !from || !to.includes("@")) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1714">${escapeHtml(body).replace(/\n/g, "<br>")}</div>`,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (error) {
    console.error("Email send failed", error);
    return false;
  }
}

async function sendSms(to: string, body: string) {
  const sid = env.MB_SMS_ACCOUNT_SID;
  const token = env.MB_SMS_AUTH_TOKEN;
  const from = env.MB_SMS_FROM;
  if (!sid || !token || !from || !to.trim()) return false;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (error) {
    console.error("SMS send failed", error);
    return false;
  }
}

async function markUnsent(id: string, lastError: string) {
  await database().prepare(
    "UPDATE message_jobs SET last_error = ? WHERE id = ? AND template_id IS NOT NULL AND status IN ('pending', 'failed')",
  ).bind(lastError, id).run();
}

export async function deliverRun(runId: string) {
  if (!uuidPattern.test(runId)) throw new AppError("Automation run not found.", 404);
  const run = await database().prepare(
    `SELECT id, template_id, entity_type, entity_id, occurrence, customer_id, to_address, status, attempt_count, max_attempts,
            (next_attempt_at <= now()) AS due
     FROM message_jobs WHERE id = ? AND template_id IS NOT NULL`,
  ).bind(runId).first<RunRow>();
  if (!run) throw new AppError("Automation run not found.", 404);
  const attempts = Number(run.attempt_count);
  const maxAttempts = Number(run.max_attempts);
  if (run.status === "canceled" || run.status === "sent") return { id: run.id, status: run.status, sent: false, attempts };
  if (attempts >= maxAttempts) return { id: run.id, status: "failed", sent: false, attempts };
  if (!flagged(run.due)) return { id: run.id, status: run.status, sent: false, attempts };

  const template = await database().prepare(
    "SELECT id, kind, channel, delay_minutes, subject, body, active FROM automation_templates WHERE id = ?",
  ).bind(run.template_id).first<TemplateRow>();
  if (!template || !flagged(template.active)) {
    await markUnsent(run.id, "template_inactive");
    return { id: run.id, status: run.status, sent: false, attempts };
  }

  const target = await resolveTarget(run.entity_type, run.entity_id, template.channel);
  if (marketingSet.has(template.kind)) {
    const customer = target.customerId
      ? await database().prepare("SELECT marketing_opt_in FROM customers WHERE id = ?").bind(target.customerId).first<{ marketing_opt_in: boolean | null }>()
      : null;
    if (!optedIn(customer?.marketing_opt_in)) {
      await markUnsent(run.id, "marketing_opt_in");
      return { id: run.id, status: run.status, sent: false, attempts };
    }
  }
  if (template.channel === "email" && !emailConfigured()) {
    await markUnsent(run.id, "email_not_configured");
    return { id: run.id, status: run.status, sent: false, attempts };
  }
  if (template.channel === "sms" && !(await smsApproved())) {
    await markUnsent(run.id, "sms_disabled");
    return { id: run.id, status: run.status, sent: false, attempts };
  }
  const recipient = clean(target.recipient, 200);
  if (!recipient) {
    await markUnsent(run.id, "missing_recipient");
    return { id: run.id, status: run.status, sent: false, attempts };
  }

  let body = template.body;
  if (marketingSet.has(template.kind) && target.customerId && body.includes("{{unsubscribe_url}}")) {
    const token = await ensureUnsubscribeToken(target.customerId);
    const origin = (env.MB_PUBLIC_ORIGIN ?? "").replace(/\/$/, "");
    body = body.replaceAll("{{unsubscribe_url}}", `${origin}/api/unsubscribe?token=${token}`);
  }
  const sent = template.channel === "email" ? await sendEmail(recipient, template.subject, body) : await sendSms(recipient, body);
  if (sent) {
    const saved = await database().prepare(
      `UPDATE message_jobs
       SET status = 'sent', attempt_count = attempt_count + 1, to_address = ?, subject = ?, body = ?, sent_at = now(), last_error = ''
       WHERE id = ? AND status IN ('pending', 'failed')
       RETURNING status, attempt_count AS attempts`,
    ).bind(recipient, template.subject, body, run.id).first<{ status: string; attempts: number }>();
    if (!saved) return { id: run.id, status: "canceled", sent: false, attempts };
    return { id: run.id, status: "sent", sent: true, attempts: Number(saved.attempts) };
  }
  const failed = await database().prepare(
    `UPDATE message_jobs
     SET status = 'failed', attempt_count = attempt_count + 1, to_address = ?, subject = ?, body = ?, last_error = 'send_failed'
     WHERE id = ? AND status IN ('pending', 'failed')
     RETURNING attempt_count AS attempts`,
  ).bind(recipient, template.subject, body, run.id).first<{ attempts: number }>();
  return { id: run.id, status: "failed", sent: false, attempts: failed ? Number(failed.attempts) : attempts };
}

export async function processDueRuns() {
  const due = await database().prepare(
    `SELECT id FROM message_jobs
     WHERE template_id IS NOT NULL AND status IN ('pending', 'failed') AND attempt_count < max_attempts AND next_attempt_at <= now()
     ORDER BY next_attempt_at
     LIMIT 50`,
  ).all<{ id: string }>();
  const results = [];
  for (const row of due.results) results.push(await deliverRun(row.id));
  return {
    processed: results.length,
    sent: results.filter((result) => result.sent).length,
    unsent: results.filter((result) => !result.sent).length,
  };
}

export async function cancelRun(runId: string, actor: Actor) {
  if (!uuidPattern.test(runId)) throw new AppError("Automation run not found.", 404);
  const run = await database().prepare("SELECT id, status, template_id FROM message_jobs WHERE id = ?").bind(runId).first<{ id: string; status: string; template_id: string | null }>();
  if (!run || !run.template_id) throw new AppError("Automation run not found.", 404);
  if (run.status === "sent") throw new AppError("A sent message stays in the history.", 409);
  await database().prepare(
    "UPDATE message_jobs SET status = 'canceled' WHERE id = ? AND template_id IS NOT NULL AND status IN ('pending', 'failed')",
  ).bind(runId).run();
  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    ip: actor.ip,
    action: "automation_canceled",
    entity: "message_jobs",
    subjectId: runId,
    before: { status: run.status },
    after: { status: "canceled" },
  });
  return { id: runId, status: "canceled" };
}

export async function unsubscribeCustomer(customerId: string, actor: Actor) {
  if (!uuidPattern.test(customerId)) throw new AppError("Customer not found.", 404);
  const customer = await database().prepare("SELECT id FROM customers WHERE id = ?").bind(customerId).first<{ id: string }>();
  if (!customer) throw new AppError("Customer not found.", 404);
  await database().prepare("UPDATE customers SET marketing_opt_in = false, updated_at = now() WHERE id = ?").bind(customerId).run();
  await database().prepare(
    `UPDATE message_jobs AS job
     SET status = 'canceled'
     FROM automation_templates AS template
     WHERE job.template_id = template.id
       AND job.customer_id = ?
       AND job.status IN ('pending', 'failed')
       AND template.kind IN ('review_request', 'referral')`,
  ).bind(customerId).run();
  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    ip: actor.ip,
    action: "unsubscribed",
    entity: "customers",
    subjectId: customerId,
    after: { marketingOptIn: false },
  });
}

export async function unsubscribeByToken(token: string, actor: Actor) {
  const cleanToken = token.trim();
  if (!/^[0-9a-f]{64}$/i.test(cleanToken)) throw new AppError("This unsubscribe link is not valid.", 404);
  const customer = await database().prepare("SELECT id FROM customers WHERE unsubscribe_token = ?").bind(cleanToken).first<{ id: string }>();
  if (!customer) throw new AppError("This unsubscribe link is not valid.", 404);
  await unsubscribeCustomer(customer.id, actor);
}
