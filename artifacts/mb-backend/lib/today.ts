import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertCan, type Role } from "@/lib/authz";
import { checklistProgress } from "@/lib/planner";
import type { DeskItem } from "@/lib/office-desk";

/**
 * Daily work board for /admin/today.
 * Reuses desk sources (holds, payments, contracts) plus consultations,
 * today's events, unified tasks, quotes needing action, and readiness.
 * No fake reminders or scheduled notification inventing.
 */

export type TodayBoard = {
  date: string;
  counts: {
    todaysEvents: number;
    overdueFollowUps: number;
    tasksDueToday: number;
    consultations: number;
    activeHolds: number;
    quotesPayments: number;
    readinessWarnings: number;
  };
  todaysEvents: DeskItem[];
  overdueFollowUps: DeskItem[];
  tasksDueToday: DeskItem[];
  consultations: DeskItem[];
  activeHolds: DeskItem[];
  quotesPayments: DeskItem[];
  readinessWarnings: DeskItem[];
};

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function plannerHref(plannerId: string | null, eventId: string, room = "overview") {
  if (plannerId) return `/admin/planner/${plannerId}?room=${room}`;
  return `/admin/calendar?event=${encodeURIComponent(eventId)}`;
}

function bookingHref(plannerId: string | null, eventId: string) {
  if (plannerId) return `/admin/planner/${plannerId}?room=overview&focus=booking`;
  return `/admin/calendar?event=${encodeURIComponent(eventId)}`;
}

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function shortDate(value: string | null) {
  if (!value) return "";
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value;
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function taskHref(leadId: string | null, plannerId: string | null, eventId: string | null) {
  if (leadId) return `/admin/leads/${leadId}`;
  if (plannerId) return `/admin/planner/${plannerId}?room=overview`;
  if (eventId) return `/admin/calendar?event=${encodeURIComponent(eventId)}`;
  return "/admin/tasks";
}

export async function buildTodayBoard(role: Role): Promise<TodayBoard> {
  assertCan(role, "office.access");
  const db = database();
  const date = new Date().toISOString().slice(0, 10);

  const [todaysEvents, overdueTasks, dueTodayTasks, consultations, holds, deposits, overduePay, quoteLeads, contracts, readinessRows] = await Promise.all([
    db.prepare(
      `SELECT e.id, p.id AS planner_id, e.name, c.name AS customer_name, e.event_date::text AS event_date,
              e.start_time, b.status, e.event_type
       FROM events e
       JOIN bookings b ON b.event_id = e.id
       LEFT JOIN planner_events p ON p.event_id = e.id
       LEFT JOIN customers c ON c.id = e.customer_id
       WHERE b.status IN ('tentative', 'confirmed') AND e.event_date = CURRENT_DATE
       ORDER BY e.start_time, e.name
       LIMIT 24`,
    ).all<{ id: string; planner_id: string | null; name: string; customer_name: string | null; event_date: string | null; start_time: string; status: string; event_type: string }>(),
    db.prepare(
      `SELECT t.id, t.title, t.due_on::text AS due_on, t.lead_id, l.name AS lead_name,
              t.event_id, e.name AS event_name, p.id AS planner_id
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id AND l.merged_into_id IS NULL
       LEFT JOIN events e ON e.id = t.event_id
       LEFT JOIN planner_events p ON p.event_id = e.id
       WHERE t.done = false AND t.due_on IS NOT NULL AND t.due_on < CURRENT_DATE
         AND (t.lead_id IS NULL OR l.id IS NOT NULL)
       ORDER BY t.due_on
       LIMIT 24`,
    ).all<{ id: string; title: string; due_on: string; lead_id: string | null; lead_name: string | null; event_id: string | null; event_name: string | null; planner_id: string | null }>(),
    db.prepare(
      `SELECT t.id, t.title, t.due_on::text AS due_on, t.lead_id, l.name AS lead_name,
              t.event_id, e.name AS event_name, p.id AS planner_id, s.name AS assignee_name
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id AND l.merged_into_id IS NULL
       LEFT JOIN events e ON e.id = t.event_id
       LEFT JOIN planner_events p ON p.event_id = e.id
       LEFT JOIN staff s ON s.id = t.assignee_id
       WHERE t.done = false AND t.due_on = CURRENT_DATE
         AND (t.lead_id IS NULL OR l.id IS NOT NULL)
       ORDER BY t.title
       LIMIT 24`,
    ).all<{ id: string; title: string; due_on: string; lead_id: string | null; lead_name: string | null; event_id: string | null; event_name: string | null; planner_id: string | null; assignee_name: string | null }>(),
    db.prepare(
      `SELECT id, name, event_type, consultation_at::text AS consultation_at, stage
       FROM leads
       WHERE merged_into_id IS NULL
         AND consultation_at IS NOT NULL
         AND consultation_at >= date_trunc('day', now())
         AND consultation_at < date_trunc('day', now()) + interval '14 days'
         AND stage NOT IN ('lost', 'booked', 'event_completed')
       ORDER BY consultation_at
       LIMIT 24`,
    ).all<{ id: string; name: string; event_type: string; consultation_at: string; stage: string }>(),
    db.prepare(
      `SELECT e.id, p.id AS planner_id, e.name, c.name AS customer_name, e.event_date::text AS event_date,
              b.hold_until::text AS hold_until
       FROM events e
       JOIN bookings b ON b.event_id = e.id
       LEFT JOIN planner_events p ON p.event_id = e.id
       LEFT JOIN customers c ON c.id = e.customer_id
       WHERE b.status = 'tentative' AND b.hold_until IS NOT NULL AND b.hold_until > now()
       ORDER BY b.hold_until
       LIMIT 16`,
    ).all<{ id: string; planner_id: string | null; name: string; customer_name: string | null; event_date: string | null; hold_until: string }>(),
    db.prepare(
      `SELECT pay.id, pay.event_id, pay.label, pay.amount_cents, pay.due_on::text AS due_on,
              e.name, p.id AS planner_id, c.name AS customer_name
       FROM payments pay
       JOIN events e ON e.id = pay.event_id
       LEFT JOIN planner_events p ON p.event_id = e.id
       LEFT JOIN customers c ON c.id = e.customer_id
       WHERE pay.status = 'due' AND (pay.kind = 'deposit' OR lower(pay.label) LIKE '%deposit%')
       ORDER BY pay.due_on NULLS LAST
       LIMIT 16`,
    ).all<{ id: string; event_id: string; label: string; amount_cents: number; due_on: string | null; name: string; planner_id: string | null; customer_name: string | null }>(),
    db.prepare(
      `SELECT pay.id, pay.event_id, pay.label, pay.amount_cents, pay.due_on::text AS due_on,
              e.name, p.id AS planner_id, c.name AS customer_name
       FROM payments pay
       JOIN events e ON e.id = pay.event_id
       LEFT JOIN planner_events p ON p.event_id = e.id
       LEFT JOIN customers c ON c.id = e.customer_id
       WHERE pay.status = 'due' AND pay.due_on IS NOT NULL AND pay.due_on < CURRENT_DATE
       ORDER BY pay.due_on
       LIMIT 16`,
    ).all<{ id: string; event_id: string; label: string; amount_cents: number; due_on: string | null; name: string; planner_id: string | null; customer_name: string | null }>(),
    db.prepare(
      `SELECT id, name, event_type, stage, event_date::text AS event_date
       FROM leads
       WHERE merged_into_id IS NULL AND stage IN ('proposal_sent', 'follow_up', 'deposit_pending')
       ORDER BY created_at DESC
       LIMIT 16`,
    ).all<{ id: string; name: string; event_type: string; stage: string; event_date: string | null }>(),
    db.prepare(
      `SELECT e.id, p.id AS planner_id, e.name, c.name AS customer_name, p.admin_data::text AS admin_data
       FROM planner_events p
       JOIN events e ON e.id = p.event_id
       JOIN bookings b ON b.event_id = e.id
       LEFT JOIN customers c ON c.id = e.customer_id
       WHERE b.status IN ('tentative', 'confirmed')
       ORDER BY e.event_date NULLS LAST
       LIMIT 80`,
    ).all<{ id: string; planner_id: string | null; name: string; customer_name: string | null; admin_data: string }>(),
    db.prepare(
      `SELECT e.id, p.id AS planner_id, e.name, c.name AS customer_name, e.event_date::text AS event_date,
              event_readiness(e.id) AS readiness
       FROM events e
       JOIN bookings b ON b.event_id = e.id
       LEFT JOIN planner_events p ON p.event_id = e.id
       LEFT JOIN customers c ON c.id = e.customer_id
       WHERE b.status IN ('tentative', 'confirmed')
         AND (e.event_date IS NULL OR e.event_date >= CURRENT_DATE)
         AND event_readiness(e.id) = 'not_ready'
       ORDER BY e.event_date NULLS LAST
       LIMIT 16`,
    ).all<{ id: string; planner_id: string | null; name: string; customer_name: string | null; event_date: string | null; readiness: string }>(),
  ]);

  const todaysEventItems: DeskItem[] = todaysEvents.results.map((row) => ({
    id: row.id,
    label: row.name || row.customer_name || "Event",
    detail: [row.start_time, row.status, row.event_type].filter(Boolean).join(" · "),
    href: bookingHref(row.planner_id, row.id),
  }));

  const overdueFollowUps: DeskItem[] = overdueTasks.results.map((row) => ({
    id: row.id,
    label: row.title,
    detail: [row.lead_name || row.event_name || "General", `due ${shortDate(row.due_on)}`].filter(Boolean).join(" · "),
    href: taskHref(row.lead_id, row.planner_id, row.event_id),
    tone: "urgent",
  }));

  const tasksDueToday: DeskItem[] = dueTodayTasks.results.map((row) => ({
    id: row.id,
    label: row.title,
    detail: [row.lead_name || row.event_name || "General", row.assignee_name].filter(Boolean).join(" · "),
    href: taskHref(row.lead_id, row.planner_id, row.event_id),
    tone: "warn",
  }));

  const consultationItems: DeskItem[] = consultations.results.map((row) => ({
    id: row.id,
    label: row.name,
    detail: [row.event_type, shortDate(row.consultation_at?.slice(0, 10) ?? null), row.stage.replaceAll("_", " ")].filter(Boolean).join(" · "),
    href: `/admin/leads/${row.id}`,
  }));

  const activeHolds: DeskItem[] = holds.results.map((row) => ({
    id: row.id,
    label: row.name || row.customer_name || "Event",
    detail: `Hold until ${shortDate(row.hold_until?.slice(0, 10) ?? null) || row.hold_until}${row.event_date ? ` · ${shortDate(row.event_date)}` : ""}`,
    href: bookingHref(row.planner_id, row.id),
    tone: "warn",
  }));

  const quotesPayments: DeskItem[] = [];
  for (const row of quoteLeads.results) {
    quotesPayments.push({
      id: `lead-${row.id}`,
      label: row.name,
      detail: [row.stage.replaceAll("_", " "), row.event_type, shortDate(row.event_date)].filter(Boolean).join(" · "),
      href: `/admin/leads/${row.id}`,
      tone: row.stage === "deposit_pending" ? "urgent" : "warn",
    });
  }
  for (const row of deposits.results) {
    quotesPayments.push({
      id: `dep-${row.id}`,
      label: row.name || row.customer_name || "Event",
      detail: `${row.label || "Deposit"} · ${money(Number(row.amount_cents))}${row.due_on ? ` · due ${shortDate(row.due_on)}` : ""}`,
      href: plannerHref(row.planner_id, row.event_id, "payments"),
      tone: "urgent",
    });
  }
  for (const row of overduePay.results) {
    if (quotesPayments.some((item) => item.id === `dep-${row.id}`)) continue;
    quotesPayments.push({
      id: `pay-${row.id}`,
      label: row.name || row.customer_name || "Event",
      detail: `${row.label || "Payment"} · ${money(Number(row.amount_cents))} · due ${shortDate(row.due_on)}`,
      href: plannerHref(row.planner_id, row.event_id, "payments"),
      tone: "urgent",
    });
  }
  for (const row of contracts.results) {
    let docs: { title?: string; status?: string }[] = [];
    try {
      const admin = JSON.parse(row.admin_data || "{}") as { documents?: { title?: string; status?: string }[] };
      docs = Array.isArray(admin.documents) ? admin.documents : [];
    } catch {
      docs = [];
    }
    const open = docs.filter((doc) => doc.status === "sent" || doc.status === "draft");
    if (!open.length) continue;
    quotesPayments.push({
      id: `doc-${row.id}`,
      label: row.name || row.customer_name || "Event",
      detail: `${open.length} unsigned · ${open.map((doc) => doc.title || "Contract").slice(0, 2).join(", ")}`,
      href: plannerHref(row.planner_id, row.id, "documents"),
      tone: "warn",
    });
    if (quotesPayments.length >= 24) break;
  }

  const readinessWarnings: DeskItem[] = readinessRows.results.map((row) => ({
    id: row.id,
    label: row.name || row.customer_name || "Event",
    detail: ["Not ready", shortDate(row.event_date)].filter(Boolean).join(" · "),
    href: row.planner_id
      ? `/admin/planner/${row.planner_id}/operations`
      : `/admin/calendar?event=${encodeURIComponent(row.id)}`,
    tone: "warn",
  }));

  return {
    date,
    counts: {
      todaysEvents: todaysEventItems.length,
      overdueFollowUps: overdueFollowUps.length,
      tasksDueToday: tasksDueToday.length,
      consultations: consultationItems.length,
      activeHolds: activeHolds.length,
      quotesPayments: quotesPayments.length,
      readinessWarnings: readinessWarnings.length,
    },
    todaysEvents: todaysEventItems,
    overdueFollowUps,
    tasksDueToday,
    consultations: consultationItems,
    activeHolds,
    quotesPayments: quotesPayments.slice(0, 24),
    readinessWarnings,
  };
}

export type ChecklistBoard = {
  templates: {
    id: string;
    eventType: string;
    name: string;
    published: boolean;
    seeded: boolean;
    itemCount: number;
  }[];
  events: {
    id: string;
    plannerId: string | null;
    name: string;
    eventType: string;
    eventDate: string | null;
    clientDone: number;
    clientTotal: number;
    opsDone: number;
    opsTotal: number;
    href: string;
  }[];
};

export async function buildChecklistBoard(role: Role): Promise<ChecklistBoard> {
  assertCan(role, "events.read");
  const { listPlanningTemplates } = await import("@/lib/planning-templates");
  const templates = await listPlanningTemplates();
  const rows = await database().prepare(
    `SELECT e.id, p.id AS planner_id, e.name, e.event_type, e.event_date::text AS event_date,
            coalesce(p.data::text, '{}') AS data,
            (SELECT count(*)::int FROM event_checklist ec WHERE ec.event_id = e.id) AS ops_total,
            (SELECT count(*)::int FROM event_checklist ec WHERE ec.event_id = e.id AND ec.done = true) AS ops_done
     FROM events e
     JOIN bookings b ON b.event_id = e.id
     LEFT JOIN planner_events p ON p.event_id = e.id
     WHERE b.status IN ('tentative', 'confirmed')
       AND (e.event_date IS NULL OR e.event_date >= CURRENT_DATE - interval '14 days')
     ORDER BY e.event_date NULLS LAST, e.name
     LIMIT 80`,
  ).all<{
    id: string;
    planner_id: string | null;
    name: string;
    event_type: string;
    event_date: string | null;
    data: string;
    ops_total: number;
    ops_done: number;
  }>();

  const events = rows.results.map((row) => {
    let clientDone = 0;
    let clientTotal = 0;
    try {
      const data = JSON.parse(row.data || "{}") as { checklist?: { done?: boolean }[] };
      const progress = checklistProgress(Array.isArray(data.checklist) ? data.checklist.map((item) => ({ done: Boolean(item.done) })) : []);
      clientDone = progress.done;
      clientTotal = progress.total;
    } catch {
      clientDone = 0;
      clientTotal = 0;
    }
    return {
      id: row.id,
      plannerId: row.planner_id,
      name: row.name || "Event",
      eventType: row.event_type || "Other",
      eventDate: row.event_date,
      clientDone,
      clientTotal,
      opsDone: Number(row.ops_done),
      opsTotal: Number(row.ops_total),
      href: row.planner_id
        ? `/admin/planner/${row.planner_id}?room=timeline`
        : `/admin/calendar?event=${encodeURIComponent(row.id)}`,
    };
  });

  return {
    templates: templates.map((template) => ({
      id: template.id,
      eventType: template.eventType,
      name: template.name,
      published: template.published,
      seeded: template.seeded,
      itemCount: template.checklist.length,
    })),
    events,
  };
}
