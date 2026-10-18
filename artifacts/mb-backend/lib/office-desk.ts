import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertCan, type Role } from "@/lib/authz";

/**
 * Read-only office command desk aggregates.
 * Does not change booking, finance, or sales workflow rules.
 */

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

export type DeskItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  tone?: "default" | "urgent" | "warn";
};

export type OwnerDesk = {
  counts: {
    newLeads: number;
    upcoming: number;
    activeHolds: number;
    unsignedContracts: number;
    depositsDue: number;
    overdueBalances: number;
    urgentTasks: number;
  };
  newLeads: DeskItem[];
  upcoming: DeskItem[];
  activeHolds: DeskItem[];
  unsignedContracts: DeskItem[];
  depositsDue: DeskItem[];
  overdueBalances: DeskItem[];
  urgentTasks: DeskItem[];
};

function plannerHref(plannerId: string | null, eventId: string, room = "overview") {
  if (plannerId) return `/admin/planner/${plannerId}?room=${room}`;
  return `/admin/calendar?event=${encodeURIComponent(eventId)}`;
}

function bookingHref(plannerId: string | null, eventId: string) {
  // Holds and upcoming bookings open the event control room on the booking surface.
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

export async function buildOwnerDesk(role: Role): Promise<OwnerDesk> {
  assertCan(role, "office.access");
  const db = database();

  const [leads, upcoming, holds, deposits, overdue, tasks, contracts] = await Promise.all([
    db.prepare(
      `SELECT id, name, event_type, event_date::text AS event_date, stage, created_at::text AS created_at
       FROM leads
       WHERE merged_into_id IS NULL AND created_at >= now() - interval '7 days'
       ORDER BY created_at DESC LIMIT 12`,
    ).all<{ id: string; name: string; event_type: string; event_date: string | null; stage: string; created_at: string }>(),
    db.prepare(
      `SELECT e.id, p.id AS planner_id, e.name, c.name AS customer_name, e.event_date::text AS event_date,
              e.start_time, b.status, e.event_type
       FROM events e
       JOIN bookings b ON b.event_id = e.id
       LEFT JOIN planner_events p ON p.event_id = e.id
       LEFT JOIN customers c ON c.id = e.customer_id
       WHERE b.status IN ('tentative', 'confirmed')
         AND (e.event_date IS NULL OR e.event_date >= CURRENT_DATE)
       ORDER BY e.event_date NULLS LAST, e.start_time
       LIMIT 16`,
    ).all<{ id: string; planner_id: string | null; name: string; customer_name: string | null; event_date: string | null; start_time: string; status: string; event_type: string }>(),
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
      `SELECT t.id, t.title, t.due_on::text AS due_on,
              l.id AS lead_id, l.name AS lead_name,
              e.id AS event_id, e.name AS event_name, p.id AS planner_id
       FROM tasks t
       LEFT JOIN leads l ON l.id = t.lead_id AND l.merged_into_id IS NULL
       LEFT JOIN events e ON e.id = t.event_id
       LEFT JOIN planner_events p ON p.event_id = e.id
       WHERE t.done = false AND t.due_on IS NOT NULL AND t.due_on <= CURRENT_DATE
         AND (t.lead_id IS NULL OR l.id IS NOT NULL)
       ORDER BY t.due_on
       LIMIT 16`,
    ).all<{ id: string; title: string; due_on: string; lead_id: string | null; lead_name: string | null; event_id: string | null; event_name: string | null; planner_id: string | null }>(),
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
  ]);

  const unsignedContracts: DeskItem[] = [];
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
    unsignedContracts.push({
      id: row.id,
      label: row.name || row.customer_name || "Event",
      detail: `${open.length} unsigned · ${open.map((doc) => doc.title || "Contract").slice(0, 2).join(", ")}`,
      href: plannerHref(row.planner_id, row.id, "documents"),
      tone: "warn",
    });
    if (unsignedContracts.length >= 12) break;
  }

  const newLeads: DeskItem[] = leads.results.map((row) => ({
    id: row.id,
    label: row.name,
    detail: [row.event_type, shortDate(row.event_date), row.stage].filter(Boolean).join(" · "),
    href: `/admin/leads/${row.id}`,
  }));

  const upcomingItems: DeskItem[] = upcoming.results.map((row) => ({
    id: row.id,
    label: row.name || row.customer_name || "Event",
    detail: [shortDate(row.event_date), row.start_time, row.status, row.event_type].filter(Boolean).join(" · "),
    href: bookingHref(row.planner_id, row.id),
  }));

  const activeHolds: DeskItem[] = holds.results.map((row) => ({
    id: row.id,
    label: row.name || row.customer_name || "Event",
    detail: `Hold until ${shortDate(row.hold_until?.slice(0, 10) ?? null) || row.hold_until}${row.event_date ? ` · ${shortDate(row.event_date)}` : ""}`,
    href: bookingHref(row.planner_id, row.id),
    tone: "warn",
  }));

  const depositsDue: DeskItem[] = deposits.results.map((row) => ({
    id: row.id,
    label: row.name || row.customer_name || "Event",
    detail: `${row.label || "Deposit"} · ${money(Number(row.amount_cents))}${row.due_on ? ` · due ${shortDate(row.due_on)}` : ""}`,
    href: plannerHref(row.planner_id, row.event_id, "payments"),
    tone: "urgent",
  }));

  const overdueBalances: DeskItem[] = overdue.results.map((row) => ({
    id: row.id,
    label: row.name || row.customer_name || "Event",
    detail: `${row.label || "Payment"} · ${money(Number(row.amount_cents))} · due ${shortDate(row.due_on)}`,
    href: plannerHref(row.planner_id, row.event_id, "payments"),
    tone: "urgent",
  }));

  const urgentTasks: DeskItem[] = tasks.results.map((row) => ({
    id: row.id,
    label: row.title,
    detail: `${row.lead_name || row.event_name || "General"} · due ${shortDate(row.due_on)}`,
    href: row.lead_id
      ? `/admin/leads/${row.lead_id}`
      : row.planner_id
        ? `/admin/planner/${row.planner_id}?room=overview`
        : row.event_id
          ? `/admin/calendar?event=${encodeURIComponent(row.event_id)}`
          : "/admin/tasks",
    tone: "urgent",
  }));

  return {
    counts: {
      newLeads: newLeads.length,
      upcoming: upcomingItems.length,
      activeHolds: activeHolds.length,
      unsignedContracts: unsignedContracts.length,
      depositsDue: depositsDue.length,
      overdueBalances: overdueBalances.length,
      urgentTasks: urgentTasks.length,
    },
    newLeads,
    upcoming: upcomingItems,
    activeHolds,
    unsignedContracts,
    depositsDue,
    overdueBalances,
    urgentTasks,
  };
}

export type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  eventCount: number;
  leadCount: number;
  activeBookingCount: number;
  latestEventDate: string | null;
  latestEventId: string | null;
  latestPlannerId: string | null;
  latestEventName: string;
  /** Outstanding balance across events when role has payments.read; otherwise null. */
  balanceCents: number | null;
  openFollowUps: number;
};

export async function listCustomers(role: Role, query = ""): Promise<CustomerRow[]> {
  assertCan(role, "customers.read");
  const { can } = await import("@/lib/authz");
  const showPayments = can(role, "payments.read");
  const q = query.trim().toLowerCase();
  const rows = await database().prepare(
    `SELECT c.id, c.name, c.email, c.phone,
            (SELECT count(*)::int FROM events e WHERE e.customer_id = c.id) AS event_count,
            (SELECT count(*)::int FROM leads l WHERE l.customer_id = c.id AND l.merged_into_id IS NULL) AS lead_count,
            (SELECT count(*)::int FROM events e
               JOIN bookings b ON b.event_id = e.id
             WHERE e.customer_id = c.id
               AND b.status IN ('tentative', 'confirmed', 'pending')
               AND (e.event_date IS NULL OR e.event_date >= CURRENT_DATE)) AS active_booking_count,
            (SELECT count(*)::int FROM tasks t
             WHERE t.done = false
               AND (t.lead_id IN (SELECT id FROM leads WHERE customer_id = c.id)
                 OR t.event_id IN (SELECT id FROM events WHERE customer_id = c.id))) AS open_follow_ups,
            latest.event_date::text AS latest_event_date,
            latest.id AS latest_event_id,
            latest.planner_id AS latest_planner_id,
            latest.name AS latest_event_name
     FROM customers c
     LEFT JOIN LATERAL (
       SELECT e.id, e.name, e.event_date, p.id AS planner_id
       FROM events e
       LEFT JOIN planner_events p ON p.event_id = e.id
       WHERE e.customer_id = c.id
       ORDER BY e.event_date DESC NULLS LAST, e.created_at DESC
       LIMIT 1
     ) latest ON true
     WHERE (? = '' OR lower(c.name) LIKE '%' || ? || '%' OR lower(coalesce(c.email, '')) LIKE '%' || ? || '%' OR coalesce(c.phone, '') LIKE '%' || ? || '%')
     ORDER BY c.name
     LIMIT 200`,
  ).bind(q, q, q, q).all<{
    id: string;
    name: string;
    email: string;
    phone: string;
    event_count: number;
    lead_count: number;
    active_booking_count: number;
    open_follow_ups: number;
    latest_event_date: string | null;
    latest_event_id: string | null;
    latest_planner_id: string | null;
    latest_event_name: string | null;
  }>();

  const balances = new Map<string, number>();
  if (showPayments && rows.results.length) {
    const { ledgerForEvents } = await import("@/lib/finance");
    const customerIds = rows.results.map((row) => row.id);
    const placeholders = customerIds.map(() => "?").join(", ");
    const eventLinks = await database().prepare(
      `SELECT e.id, e.customer_id FROM events e WHERE e.customer_id IN (${placeholders})`,
    ).bind(...customerIds).all<{ id: string; customer_id: string }>();
    const ledgers = await ledgerForEvents(eventLinks.results.map((row) => row.id));
    for (const link of eventLinks.results) {
      const balance = ledgers.get(link.id)?.balanceCents;
      if (balance == null) continue;
      balances.set(link.customer_id, (balances.get(link.customer_id) ?? 0) + balance);
    }
  }

  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    eventCount: Number(row.event_count),
    leadCount: Number(row.lead_count),
    activeBookingCount: Number(row.active_booking_count),
    latestEventDate: row.latest_event_date,
    latestEventId: row.latest_event_id,
    latestPlannerId: row.latest_planner_id,
    latestEventName: row.latest_event_name || "",
    balanceCents: showPayments ? (balances.get(row.id) ?? 0) : null,
    openFollowUps: Number(row.open_follow_ups),
  }));
}

export type EquipmentCatalogItem = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  active: boolean;
  openReservations: number;
  reservedQuantity: number;
  availableHint: number;
};

export async function listEquipmentCatalog(role: Role, query = ""): Promise<{
  categories: { id: string; name: string }[];
  assets: EquipmentCatalogItem[];
  canWrite: boolean;
}> {
  assertCan(role, "equipment.read");
  const q = query.trim().toLowerCase();
  const [categories, assets] = await Promise.all([
    database().prepare("SELECT id, name FROM equipment_categories ORDER BY name").all<{ id: string; name: string }>(),
    database().prepare(
      `SELECT e.id, e.name, e.category, e.quantity, e.active,
              (SELECT count(*)::int FROM equipment_reservations r
               WHERE r.equipment_id = e.id AND r.canceled_at IS NULL AND r.returned_at IS NULL AND r.blocking) AS open_reservations,
              (SELECT coalesce(sum(r.quantity), 0)::int FROM equipment_reservations r
               WHERE r.equipment_id = e.id AND r.canceled_at IS NULL AND r.returned_at IS NULL AND r.blocking) AS reserved_quantity
       FROM equipment e
       WHERE (? = '' OR lower(e.name) LIKE '%' || ? || '%' OR lower(coalesce(e.category, '')) LIKE '%' || ? || '%')
       ORDER BY e.name
       LIMIT 300`,
    ).bind(q, q, q).all<{ id: string; name: string; category: string; quantity: number; active: boolean; open_reservations: number; reserved_quantity: number }>(),
  ]);
  const { can } = await import("@/lib/authz");
  return {
    categories: categories.results,
    assets: assets.results.map((row) => {
      const quantity = Number(row.quantity);
      const reservedQuantity = Number(row.reserved_quantity);
      return {
        id: row.id,
        name: row.name,
        category: row.category || "",
        quantity,
        active: row.active !== false,
        openReservations: Number(row.open_reservations),
        reservedQuantity,
        availableHint: Math.max(0, quantity - reservedQuantity),
      };
    }),
    canWrite: can(role, "equipment.write"),
  };
}
