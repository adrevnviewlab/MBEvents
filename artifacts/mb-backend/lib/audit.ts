import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export async function audit(entry: {
  actorEmail: string;
  userId?: string | null;
  action: string;
  entity: string;
  subjectId: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}) {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  await env.DB.prepare(
    `INSERT INTO admin_audit (id, created_at, actor_email, user_id, action, entity, subject_id, ip, before_value, after_value)
     VALUES (?, now(), ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)`,
  ).bind(
    crypto.randomUUID(),
    entry.actorEmail,
    entry.userId || null,
    entry.action,
    entry.entity,
    entry.subjectId,
    entry.ip ?? "",
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
  ).run();
}

export async function notifyRow(entry: {
  userId?: string | null;
  eventId?: string | null;
  customerId?: string | null;
  channel: "email" | "sms" | "in_app";
  topic: string;
  status: "queued" | "sent" | "failed" | "read";
  dedupeKey?: string;
}) {
  if (!env.DB) return;
  const dedupeKey = (entry.dedupeKey ?? "").slice(0, 160);
  if (dedupeKey) {
    await env.DB.prepare(
      `INSERT INTO notifications (id, user_id, event_id, customer_id, channel, topic, status, dedupe_key, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN now() ELSE NULL END)
       ON CONFLICT (topic, dedupe_key) WHERE dedupe_key <> '' DO UPDATE
       SET status = EXCLUDED.status,
           sent_at = CASE
             WHEN EXCLUDED.status = 'sent' THEN COALESCE(notifications.sent_at, now())
             ELSE notifications.sent_at
           END
       WHERE notifications.status <> 'sent'`,
    ).bind(
      crypto.randomUUID(),
      entry.userId ?? null,
      entry.eventId ?? null,
      entry.customerId ?? null,
      entry.channel,
      entry.topic,
      entry.status,
      dedupeKey,
      entry.status,
    ).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, event_id, customer_id, channel, topic, status, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN now() ELSE NULL END)`,
  ).bind(crypto.randomUUID(), entry.userId ?? null, entry.eventId ?? null, entry.customerId ?? null, entry.channel, entry.topic, entry.status, entry.status).run();
}
