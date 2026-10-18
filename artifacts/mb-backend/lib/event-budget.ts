import { audit } from "@/lib/audit";
import { assertCan, can, type Role } from "@/lib/authz";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { eventLedger } from "@/lib/finance";

export const expenseCategories = ["staff", "vendor", "equipment", "venue", "travel", "supplies", "other"] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];
export const costSources = ["manual", "staff_payout", "vendor"] as const;
export type CostSource = (typeof costSources)[number];

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function clip(value: string, max: number) {
  return value.trim().slice(0, max);
}

function moneyOrThrow(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new AppError(`${label} must be a whole amount in cents of zero or more.`, 400);
  return value;
}

function isCategory(value: string): value is ExpenseCategory {
  return (expenseCategories as readonly string[]).includes(value);
}

function isSource(value: string): value is CostSource {
  return (costSources as readonly string[]).includes(value);
}

export type EventCostRow = {
  id: string;
  eventId: string;
  label: string;
  category: ExpenseCategory;
  amountCents: number;
  estimatedCents: number | null;
  varianceCents: number | null;
  notes: string;
  sourceKind: CostSource;
  assignmentId: string | null;
  vendorId: string | null;
  vendorName: string;
  staffName: string;
};

export type EventBudgetSummary = {
  /** Distinct money layers — never collapsed into a single invented figure. */
  layers: {
    estimatedInvoiceCents: number | null;
    contractedInvoiceCents: number | null;
    invoicedCents: number;
    collectedCents: number;
    outstandingCents: number;
    deposit: { status: string; amountCents: number; dueOn: string | null } | null;
  };
  costs: {
    recorded: boolean;
    actualCents: number | null;
    estimatedCents: number | null;
    varianceCents: number | null;
    byCategory: { category: string; actualCents: number; estimatedCents: number | null }[];
  };
  profit: {
    recorded: boolean;
    collectedNetCents: number | null;
    actualCostCents: number | null;
    profitCents: number | null;
    marginBps: number | null;
    reason: string;
  };
  rows: EventCostRow[];
  canWrite: boolean;
};

export async function listEventCosts(eventId: string): Promise<EventCostRow[]> {
  const rows = await database().prepare(
    `SELECT c.id, c.event_id, c.label, c.category, c.amount_cents, c.estimated_cents, c.notes,
            c.source_kind, c.assignment_id, c.vendor_id,
            coalesce(v.name, '') AS vendor_name,
            coalesce(s.name, '') AS staff_name
     FROM event_costs c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN assignments a ON a.id = c.assignment_id
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE c.event_id = ?
     ORDER BY c.created_at, c.label`,
  ).bind(eventId).all<{
    id: string;
    event_id: string;
    label: string;
    category: string;
    amount_cents: number;
    estimated_cents: number | null;
    notes: string;
    source_kind: string;
    assignment_id: string | null;
    vendor_id: string | null;
    vendor_name: string;
    staff_name: string;
  }>();

  return rows.results.map((row) => {
    const amountCents = Number(row.amount_cents);
    const estimatedCents = row.estimated_cents === null || row.estimated_cents === undefined ? null : Number(row.estimated_cents);
    return {
      id: row.id,
      eventId: row.event_id,
      label: row.label || "",
      category: isCategory(row.category) ? row.category : "other",
      amountCents,
      estimatedCents,
      varianceCents: estimatedCents === null ? null : amountCents - estimatedCents,
      notes: row.notes || "",
      sourceKind: isSource(row.source_kind) ? row.source_kind : "manual",
      assignmentId: row.assignment_id,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name || "",
      staffName: row.staff_name || "",
    };
  });
}

export async function saveEventCost(input: {
  actorRole: Role;
  actorEmail: string;
  actorUserId: string | null;
  eventId: string;
  costId?: string | null;
  label: string;
  category: string;
  amountCents: number;
  estimatedCents?: number | null;
  notes?: string;
  vendorId?: string | null;
  ip?: string;
}) {
  assertCan(input.actorRole, "office.access");
  assertCan(input.actorRole, "payments.write");
  const label = clip(input.label, 200);
  if (!label) throw new AppError("Enter a cost label.", 400);
  if (!isCategory(input.category)) throw new AppError("Choose an expense category.", 400);
  const amountCents = moneyOrThrow(input.amountCents, "Actual cost");
  const estimatedCents = input.estimatedCents === undefined || input.estimatedCents === null
    ? null
    : moneyOrThrow(input.estimatedCents, "Estimated cost");
  const notes = clip(input.notes ?? "", 2000);
  const vendorId = input.vendorId || null;
  if (vendorId) {
    const vendor = await database().prepare("SELECT id FROM vendors WHERE id = ?").bind(vendorId).first<{ id: string }>();
    if (!vendor) throw new AppError("That vendor was not found.", 404);
  }
  const event = await database().prepare("SELECT id FROM events WHERE id = ?").bind(input.eventId).first<{ id: string }>();
  if (!event) throw new AppError("That event was not found.", 404);

  if (input.costId) {
    const existing = await database().prepare("SELECT id FROM event_costs WHERE id = ? AND event_id = ?")
      .bind(input.costId, input.eventId).first<{ id: string }>();
    if (!existing) throw new AppError("That cost row was not found.", 404);
    await database().prepare(
      `UPDATE event_costs
       SET label = ?, category = ?, amount_cents = ?, estimated_cents = ?, notes = ?, vendor_id = ?,
           source_kind = CASE WHEN ? IS NOT NULL THEN 'vendor' ELSE source_kind END
       WHERE id = ?`,
    ).bind(label, input.category, amountCents, estimatedCents, notes, vendorId, vendorId, input.costId).run();
    await audit({
      actorEmail: input.actorEmail,
      userId: input.actorUserId,
      action: "event_cost_updated",
      entity: "event_costs",
      subjectId: input.costId,
      after: { label, category: input.category, amountCents, estimatedCents },
      ip: input.ip,
    });
    return input.costId;
  }

  const id = crypto.randomUUID();
  await database().prepare(
    `INSERT INTO event_costs (id, event_id, label, category, amount_cents, estimated_cents, notes, created_by, source_kind, vendor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.eventId,
    label,
    input.category,
    amountCents,
    estimatedCents,
    notes,
    input.actorUserId || null,
    vendorId ? "vendor" : "manual",
    vendorId,
  ).run();
  await audit({
    actorEmail: input.actorEmail,
    userId: input.actorUserId,
    action: "event_cost_created",
    entity: "event_costs",
    subjectId: id,
    after: { eventId: input.eventId, label, category: input.category, amountCents, estimatedCents },
    ip: input.ip,
  });
  return id;
}

export async function deleteEventCost(input: {
  actorRole: Role;
  actorEmail: string;
  actorUserId: string | null;
  eventId: string;
  costId: string;
  ip?: string;
}) {
  assertCan(input.actorRole, "office.access");
  assertCan(input.actorRole, "payments.write");
  const row = await database().prepare("SELECT id, label, amount_cents FROM event_costs WHERE id = ? AND event_id = ?")
    .bind(input.costId, input.eventId).first<{ id: string; label: string; amount_cents: number }>();
  if (!row) throw new AppError("That cost row was not found.", 404);
  await database().prepare("DELETE FROM event_costs WHERE id = ?").bind(row.id).run();
  await audit({
    actorEmail: input.actorEmail,
    userId: input.actorUserId,
    action: "event_cost_deleted",
    entity: "event_costs",
    subjectId: row.id,
    before: { label: row.label, amountCents: Number(row.amount_cents) },
    ip: input.ip,
  });
}

/** Explicit copy of an assignment payout into event_costs. Never auto-sums payouts into profit. */
export async function importStaffPayoutCost(input: {
  actorRole: Role;
  actorEmail: string;
  actorUserId: string | null;
  eventId: string;
  assignmentId: string;
  ip?: string;
}) {
  assertCan(input.actorRole, "office.access");
  assertCan(input.actorRole, "payments.write");
  const assignment = await database().prepare(
    `SELECT a.id, a.payout_cents, a.role_label, s.name AS staff_name
     FROM assignments a JOIN staff s ON s.id = a.staff_id
     WHERE a.id = ? AND a.event_id = ? AND a.status <> 'declined'`,
  ).bind(input.assignmentId, input.eventId).first<{
    id: string;
    payout_cents: number | null;
    role_label: string;
    staff_name: string;
  }>();
  if (!assignment) throw new AppError("That assignment was not found.", 404);
  if (assignment.payout_cents === null || assignment.payout_cents === undefined) {
    throw new AppError("That assignment has no payout recorded. Enter a payout first, or add a manual staff cost.", 400);
  }
  const existing = await database().prepare(
    "SELECT id FROM event_costs WHERE event_id = ? AND assignment_id = ? AND source_kind = 'staff_payout'",
  ).bind(input.eventId, assignment.id).first<{ id: string }>();
  if (existing) throw new AppError("That staff payout is already on the event budget.", 409);

  const id = crypto.randomUUID();
  const label = clip(`${assignment.staff_name} · ${assignment.role_label || "Staff"}`, 200);
  await database().prepare(
    `INSERT INTO event_costs (id, event_id, label, category, amount_cents, estimated_cents, notes, created_by, source_kind, assignment_id)
     VALUES (?, ?, ?, 'staff', ?, NULL, '', ?, 'staff_payout', ?)`,
  ).bind(id, input.eventId, label, Number(assignment.payout_cents), input.actorUserId || null, assignment.id).run();
  await audit({
    actorEmail: input.actorEmail,
    userId: input.actorUserId,
    action: "event_cost_from_payout",
    entity: "event_costs",
    subjectId: id,
    after: { assignmentId: assignment.id, amountCents: Number(assignment.payout_cents) },
    ip: input.ip,
  });
  return id;
}

export async function listAssignablePayouts(eventId: string) {
  const rows = await database().prepare(
    `SELECT a.id, a.role_label, a.payout_cents, s.name AS staff_name,
            EXISTS (
              SELECT 1 FROM event_costs c
              WHERE c.assignment_id = a.id AND c.source_kind = 'staff_payout'
            ) AS imported
     FROM assignments a
     JOIN staff s ON s.id = a.staff_id
     WHERE a.event_id = ? AND a.status <> 'declined' AND a.payout_cents IS NOT NULL
     ORDER BY s.name`,
  ).bind(eventId).all<{ id: string; role_label: string; payout_cents: number; staff_name: string; imported: boolean }>();
  return rows.results.map((row) => ({
    assignmentId: row.id,
    staffName: row.staff_name,
    roleLabel: row.role_label || "",
    payoutCents: Number(row.payout_cents),
    imported: Boolean(row.imported),
  }));
}

export async function eventBudgetSummary(eventId: string, role: Role): Promise<EventBudgetSummary> {
  assertCan(role, "office.access");
  assertCan(role, "payments.read");
  const ledger = await eventLedger(eventId);
  const costRows = await listEventCosts(eventId);
  const adjustments = await database().prepare(
    "SELECT coalesce(sum(amount_cents), 0)::int AS cents FROM payment_adjustments WHERE event_id = ?",
  ).bind(eventId).first<{ cents: number }>();
  const adjustmentCents = Number(adjustments?.cents ?? 0);
  const collectedNet = ledger.paidCents - adjustmentCents;

  const actualCents = costRows.length ? costRows.reduce((sum, row) => sum + row.amountCents, 0) : null;
  // Estimated total only when every cost line has an estimate (no partial invent).
  const allEstimated = costRows.length > 0 && costRows.every((row) => row.estimatedCents !== null);
  const estimatedTotal = allEstimated
    ? costRows.reduce((sum, row) => sum + (row.estimatedCents ?? 0), 0)
    : null;
  const varianceCents = actualCents !== null && estimatedTotal !== null ? actualCents - estimatedTotal : null;

  const byCategoryMap = new Map<string, { actualCents: number; lines: EventCostRow[] }>();
  for (const row of costRows) {
    const bucket = byCategoryMap.get(row.category) ?? { actualCents: 0, lines: [] };
    bucket.actualCents += row.amountCents;
    bucket.lines.push(row);
    byCategoryMap.set(row.category, bucket);
  }

  const profitRecorded = actualCents !== null;
  const profitCents = profitRecorded ? collectedNet - actualCents : null;
  const marginBps = profitRecorded && collectedNet > 0 && profitCents !== null
    ? Math.round((profitCents / collectedNet) * 10_000)
    : null;

  const accepted = ledger.proposal?.status === "accepted";

  return {
    layers: {
      estimatedInvoiceCents: null,
      contractedInvoiceCents: accepted ? ledger.invoiceTotalCents : null,
      invoicedCents: ledger.invoiceTotalCents,
      collectedCents: ledger.paidCents,
      outstandingCents: ledger.balanceCents,
      deposit: ledger.deposit
        ? { status: ledger.deposit.status, amountCents: ledger.deposit.amountCents, dueOn: ledger.deposit.dueOn }
        : null,
    },
    costs: {
      recorded: costRows.length > 0,
      actualCents,
      estimatedCents: estimatedTotal,
      varianceCents,
      byCategory: [...byCategoryMap.entries()].map(([category, bucket]) => ({
        category,
        actualCents: bucket.actualCents,
        estimatedCents: bucket.lines.every((line) => line.estimatedCents !== null)
          ? bucket.lines.reduce((sum, line) => sum + (line.estimatedCents ?? 0), 0)
          : null,
      })),
    },
    profit: {
      recorded: profitRecorded,
      collectedNetCents: profitRecorded ? collectedNet : null,
      actualCostCents: actualCents,
      profitCents,
      marginBps,
      reason: profitRecorded
        ? "Profit = collected payments minus refunds/credits minus recorded actual costs. Margin uses collected net only when it is greater than zero."
        : "Profit and margin stay blank until at least one actual cost row is recorded for this event.",
    },
    rows: costRows,
    canWrite: can(role, "payments.write"),
  };
}

export async function listFinanceDesk(role: Role, filters: {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}): Promise<{
  moneySource: string;
  events: {
    id: string;
    clientNames: string;
    eventDate: string | null;
    eventType: string;
    invoiceCents: number | null;
    dueCents: number | null;
    paidCents: number | null;
    balanceCents: number | null;
    depositStatus: string | null;
    paymentStatus: string;
    costActualCents: number | null;
    profitCents: number | null;
    href: string;
  }[];
}> {
  assertCan(role, "office.access");
  assertCan(role, "payments.read");
  const q = (filters.q ?? "").trim().toLowerCase();
  const from = filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from) ? filters.from : "";
  const to = filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? filters.to : "";
  const status = (filters.status ?? "").trim().toLowerCase();

  const events = await database().prepare(
    `SELECT e.id, e.name, e.event_type, e.event_date::text AS event_date,
            coalesce(c.name, '') AS client_name
     FROM events e
     LEFT JOIN customers c ON c.id = e.customer_id
     WHERE (? = '' OR lower(e.name) LIKE '%' || ? || '%' OR lower(coalesce(c.name, '')) LIKE '%' || ? || '%')
       AND (? = '' OR e.event_date >= ?::date)
       AND (? = '' OR e.event_date <= ?::date)
     ORDER BY e.event_date NULLS LAST, e.name
     LIMIT 400`,
  ).bind(q, q, q, from, from || "1900-01-01", to, to || "9999-12-31").all<{
    id: string;
    name: string;
    event_type: string;
    event_date: string | null;
    client_name: string;
  }>();

  const ids = events.results.map((row) => row.id);
  const ledger = await (await import("@/lib/finance")).ledgerForEvents(ids);

  const costMap = new Map<string, number>();
  for (const id of ids) {
    const count = await database().prepare("SELECT count(*)::int AS n FROM event_costs WHERE event_id = ?").bind(id).first<{ n: number }>();
    if (!Number(count?.n)) continue;
    const row = await database().prepare(
      "SELECT coalesce(sum(amount_cents), 0)::int AS actual FROM event_costs WHERE event_id = ?",
    ).bind(id).first<{ actual: number }>();
    costMap.set(id, Number(row?.actual ?? 0));
  }

  const deposits = await database().prepare(
    "SELECT event_id, status FROM payments WHERE kind = 'deposit' AND status <> 'void'",
  ).all<{ event_id: string; status: string }>();
  const depositMap = new Map(
    deposits.results.filter((row) => ids.includes(row.event_id)).map((row) => [row.event_id, row.status]),
  );

  const mapped = events.results.map((row) => {
    const money = ledger.get(row.id);
    const hasMoney = money && (money.dueCents !== null || money.paidCents !== null || money.balanceCents !== null);
    const paid = money?.paidCents ?? null;
    const due = money?.dueCents ?? null;
    const balance = money?.balanceCents ?? null;
    const invoice = money?.invoiceCents ?? null;
    const depositStatus = depositMap.get(row.id) ?? null;
    let paymentStatus = "none";
    if (hasMoney) {
      if ((balance ?? 0) <= 0 && (paid ?? 0) > 0) paymentStatus = "paid";
      else if (depositStatus === "due") paymentStatus = "deposit_due";
      else if ((due ?? 0) > 0) paymentStatus = "due";
      else if ((balance ?? 0) > 0) paymentStatus = "outstanding";
      else if (depositStatus === "paid") paymentStatus = "deposit_paid";
      else paymentStatus = "ledger";
    }
    const costActual = costMap.has(row.id) ? (costMap.get(row.id) ?? 0) : null;
    const profitCents = costActual !== null && paid !== null
      ? paid - (money?.adjustmentCents ?? 0) - costActual
      : null;
    return {
      id: row.id,
      clientNames: row.client_name || row.name || "Unnamed",
      eventDate: row.event_date,
      eventType: row.event_type || "",
      invoiceCents: invoice,
      dueCents: due,
      paidCents: paid,
      balanceCents: balance,
      depositStatus,
      paymentStatus,
      costActualCents: costActual,
      profitCents,
      href: `/admin/planner/${row.id}?room=payments`,
    };
  }).filter((row) => {
    if (!status) return true;
    if (status === "deposit_due") return row.depositStatus === "due" || row.paymentStatus === "deposit_due";
    if (status === "deposit_paid") return row.depositStatus === "paid";
    if (status === "outstanding") return (row.balanceCents ?? 0) > 0;
    if (status === "paid") return row.paymentStatus === "paid";
    if (status === "due") return (row.dueCents ?? 0) > 0;
    return true;
  });

  return { moneySource: "ledger", events: mapped };
}
