import { quotedInvoiceCents } from "@/lib/finance";
import { adminDataSchema, type AdminData } from "@/lib/planner";

// One money source per event. A relational payment row wins for that event.
// Planner JSON is used only for events that have no row in payments.
// The two are never added for the same event.

export type ReportDb = {
  prepare(sql: string): {
    bind(...args: unknown[]): ReportStatement;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    first<T = Record<string, unknown>>(): Promise<T | null>;
  };
};

type ReportStatement = {
  bind(...args: unknown[]): ReportStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

export type NotRecorded = { recorded: false; label: "not recorded"; reason: string };
export type CostNotRecorded = { recorded: false; label: "cost not recorded"; reason: string };

export type Profitability =
  | CostNotRecorded
  | {
      recorded: true;
      events: { eventId: string; revenueCents: number; costCents: number; profitCents: number; marginBps: number | null }[];
      missingCostEvents: number;
      totalProfitCents: number | null;
      /** Null when company profit is incomplete or collected net is not positive. */
      totalMarginBps: number | null;
    };

export type ReportFilters = {
  /** Inclusive YYYY-MM-DD on event_date / lead created_at where applicable. */
  from?: string | null;
  to?: string | null;
};

export type BusinessReport = {
  moneySource: {
    note: string;
    relationalEvents: number;
    plannerJsonEvents: number;
    collectedStatus: "succeeded" | "paid" | null;
    revenueIsNet: boolean;
  };
  range: { from: string | null; to: string | null; note: string };
  revenueCents: number;
  relationalCollectedCents: number;
  plannerJsonCollectedCents: number;
  adjustments: { recorded: true; cents: number; note: string } | NotRecorded;
  depositsCents: number;
  /** Sum of accepted proposal invoice snapshots in range. Null when none accepted. */
  contractedCents: number | null;
  invoice: { recorded: true; cents: number } | NotRecorded;
  outstanding: { recorded: true; cents: number } | NotRecorded;
  byEventType: { label: string; revenueCents: number; eventCount: number }[];
  byPackage: { label: string; revenueCents: number }[];
  packageNote: string;
  byLeadSource: { label: string; revenueCents: number }[];
  averageBookingValueCents: number | null;
  bookingsWithRevenue: number;
  leads: {
    total: number;
    converted: number;
    /** converted / total when total > 0; otherwise null (not a fake 0%). */
    conversionRate: number | null;
    byStage: { stage: string; count: number }[];
    definition: string;
  };
  bookingPipeline: { status: string; count: number }[];
  eventsTimeline: {
    upcoming: number;
    past: number;
    completed: number;
    cancelled: number;
    definition: string;
  };
  profitability: Profitability;
  staffUtilization: NotRecorded | { recorded: true; assignments: number; staffAssigned: number; eventsAssigned: number };
  equipmentUtilization: NotRecorded | { recorded: true; reservations: number; equipmentReserved: number; quantityReserved: number; quantityOnHand: number };
  referrals: NotRecorded | { recorded: true; leads: { label: string; count: number }[]; events: { label: string; revenueCents: number }[] };
  invitations: { count: number; rsvps: number; responded: number; responseRate: number | null };
  guestInquiries: NotRecorded | { recorded: true; count: number };
  repeatCustomers: number;
};

type EventMoney = {
  eventId: string;
  source: "relational" | "planner_json";
  collectedCents: number;
  netCents: number;
  depositCents: number;
  invoiceCents: number | null;
};

const notRecorded = (reason: string): NotRecorded => ({ recorded: false, label: "not recorded", reason });

/** Legacy helper for planner JSON only. Relational deposits use payments.kind = 'deposit'. */
export function isDepositLabel(label: string) {
  return /deposit/i.test(label);
}

function num(value: unknown) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function isDepositPayment(row: { kind?: unknown; label?: unknown }) {
  if (text(row.kind) === "deposit") return true;
  // Pre-migration / JSON rows without a structured kind still use the label convention.
  if (row.kind == null || text(row.kind) === "" || text(row.kind) === "other") {
    return isDepositLabel(text(row.label));
  }
  return false;
}

async function rows<T>(db: ReportDb, sql: string, args: unknown[] = []) {
  const statement = db.prepare(sql);
  const bound = args.length ? statement.bind(...args) : statement;
  return (await bound.all<T>()).results;
}

async function one<T>(db: ReportDb, sql: string, args: unknown[] = []) {
  const statement = db.prepare(sql);
  const bound = args.length ? statement.bind(...args) : statement;
  return bound.first<T>();
}

async function tableExists(db: ReportDb, name: string) {
  const row = await one<{ ok: number }>(db, "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?", [name]);
  return !!row;
}

async function columnExists(db: ReportDb, table: string, column: string) {
  const row = await one<{ ok: number }>(
    db,
    "SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
    [table, column],
  );
  return !!row;
}

async function constraintText(db: ReportDb, table: string) {
  const found = await rows<{ def: string }>(
    db,
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'c'",
    [table],
  );
  return found.map((row) => text(row.def)).join("\n");
}

function buckets(map: Map<string, number>) {
  return [...map.entries()]
    .map(([label, revenueCents]) => ({ label, revenueCents }))
    .sort((a, b) => b.revenueCents - a.revenueCents || a.label.localeCompare(b.label));
}

function readAdmin(raw: unknown): AdminData | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  const parsed = adminDataSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : null;
}

function jsonInvoiceCents(admin: AdminData) {
  if (!admin.lineItems.length) return null;
  const subtotal = admin.lineItems.reduce((sum, item) => sum + item.qty * item.price, 0);
  const total = Math.round(subtotal * (1 + admin.taxRate / 100) * 100) / 100;
  return Math.round(total * 100);
}

function validDate(value: string | null | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function dateInRange(value: string | null | undefined, from: string | null, to: string | null) {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

export async function buildBusinessReport(db: ReportDb, filters: ReportFilters = {}): Promise<BusinessReport> {
  const from = validDate(filters.from ?? null);
  const to = validDate(filters.to ?? null);
  const rangeNote = from || to
    ? `Figures are limited to events with event_date${from ? ` from ${from}` : ""}${to ? ` through ${to}` : ""}. Leads use created_at in the same window. Money still comes only from the payment ledger / recorded costs.`
    : "No date filter. All stored rows are included.";

  const paymentsReady = await tableExists(db, "payments");
  const statusRule = paymentsReady ? await constraintText(db, "payments") : "";
  const collectedStatus: "succeeded" | "paid" | null = statusRule.includes("'succeeded'") ? "succeeded" : statusRule.includes("'paid'") ? "paid" : null;
  const adjustmentTable = await tableExists(db, "payment_adjustments");
  const adjustmentCentsColumn = adjustmentTable && (await columnExists(db, "payment_adjustments", "amount_cents"));
  const packageOnPayment = paymentsReady && (await columnExists(db, "payments", "package_id"));
  const packageOnEvent = await columnExists(db, "events", "package_id");
  const kindOnPayment = paymentsReady && (await columnExists(db, "payments", "kind"));

  const paymentRows = paymentsReady && collectedStatus
    ? await rows<{ event_id: string; label: string; amount_cents: number; status: string; kind?: string | null; package_id?: string | null }>(
        db,
        kindOnPayment
          ? (packageOnPayment
            ? "SELECT event_id, label, amount_cents, status, kind, package_id FROM payments"
            : "SELECT event_id, label, amount_cents, status, kind FROM payments")
          : (packageOnPayment
            ? "SELECT event_id, label, amount_cents, status, package_id FROM payments"
            : "SELECT event_id, label, amount_cents, status FROM payments"),
      )
    : [];
  const eventsWithRelational = new Set(paymentRows.map((row) => text(row.event_id)).filter(Boolean));

  const byEvent = new Map<string, EventMoney>();
  const packageByEvent = new Map<string, string | null>();

  for (const row of paymentRows) {
    const eventId = text(row.event_id);
    if (!eventId || text(row.status) !== collectedStatus) continue;
    const current = byEvent.get(eventId) ?? { eventId, source: "relational" as const, collectedCents: 0, netCents: 0, depositCents: 0, invoiceCents: null };
    const amount = num(row.amount_cents);
    current.collectedCents += amount;
    current.netCents += amount;
    if (isDepositPayment(row)) current.depositCents += amount;
    byEvent.set(eventId, current);
    if (packageOnPayment) packageByEvent.set(eventId, text(row.package_id) || null);
  }

  // Events that have any payments row, even a due row, do not also read JSON.
  for (const eventId of eventsWithRelational) {
    if (!byEvent.has(eventId)) byEvent.set(eventId, { eventId, source: "relational", collectedCents: 0, netCents: 0, depositCents: 0, invoiceCents: null });
  }

  const planners = await rows<{ event_id: string; admin_data: unknown }>(db, "SELECT event_id, admin_data FROM planner_events");
  for (const planner of planners) {
    const eventId = text(planner.event_id);
    if (!eventId || eventsWithRelational.has(eventId)) continue;
    const admin = readAdmin(planner.admin_data);
    if (!admin) continue;
    const paid = admin.payments.filter((payment) => payment.status === "paid");
    if (!paid.length && !admin.lineItems.length) continue;
    const current = byEvent.get(eventId) ?? { eventId, source: "planner_json" as const, collectedCents: 0, netCents: 0, depositCents: 0, invoiceCents: null };
    for (const payment of paid) {
      const amount = Math.round(num(payment.amount) * 100);
      current.collectedCents += amount;
      current.netCents += amount;
      if (isDepositLabel(payment.label)) current.depositCents += amount;
    }
    current.invoiceCents = jsonInvoiceCents(admin);
    current.source = "planner_json";
    byEvent.set(eventId, current);
  }

  let adjustmentCents = 0;
  let unappliedAdjustments = 0;
  if (adjustmentCentsColumn) {
    const adjustmentRows = await rows<{ event_id: string; cents: number }>(
      db,
      "SELECT event_id, COALESCE(SUM(amount_cents), 0)::int AS cents FROM payment_adjustments GROUP BY event_id",
    );
    for (const row of adjustmentRows) {
      const cents = num(row.cents);
      adjustmentCents += cents;
      const money = byEvent.get(text(row.event_id));
      if (money?.source === "relational") money.netCents -= cents;
      else if (!money) unappliedAdjustments += cents;
    }
  }

  const hasEventReferral = await columnExists(db, "events", "referred_by");
  const eventMeta = await rows<{
    id: string;
    event_type: string;
    event_date: string | null;
    status: string;
    lead_id: string | null;
    source: string | null;
    referred_by?: string | null;
    package_id?: string | null;
  }>(
    db,
    `SELECT e.id, e.event_type, e.event_date::text AS event_date, e.status, e.lead_id, l.source${hasEventReferral ? ", e.referred_by" : ""}${packageOnEvent ? ", e.package_id" : ""}
     FROM events e LEFT JOIN leads l ON l.id = e.lead_id`,
  );
  const meta = new Map(eventMeta.map((row) => [text(row.id), row]));
  const eventInRange = (eventId: string) => {
    if (!from && !to) return true;
    return dateInRange(meta.get(eventId)?.event_date ?? null, from, to);
  };

  // Drop money outside the event_date window so company totals match the filter.
  if (from || to) {
    for (const eventId of [...byEvent.keys()]) {
      if (!eventInRange(eventId)) byEvent.delete(eventId);
    }
  }

  const typeMap = new Map<string, number>();
  const typeCountMap = new Map<string, number>();
  const packageMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  let revenueCents = 0;
  let depositsCents = 0;
  let relationalCollectedCents = 0;
  let plannerJsonCollectedCents = 0;
  let relationalEvents = 0;
  let plannerJsonEvents = 0;

  const proposalPackage = new Map<string, string>();
  if (await tableExists(db, "proposals") && await tableExists(db, "packages")) {
    const links = await rows<{ event_id: string; name: string }>(
      db,
      `SELECT p.event_id, pk.name
       FROM proposals p JOIN packages pk ON pk.id = p.package_id
       WHERE p.package_id IS NOT NULL
       ORDER BY CASE p.status WHEN 'accepted' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END, p.updated_at DESC`,
    );
    for (const row of links) {
      const eventId = text(row.event_id);
      const name = text(row.name).trim();
      if (eventId && name && !proposalPackage.has(eventId)) proposalPackage.set(eventId, name);
    }
  }

  for (const money of byEvent.values()) {
    if (money.source === "relational") {
      relationalEvents += 1;
      relationalCollectedCents += money.collectedCents;
    } else {
      plannerJsonEvents += 1;
      plannerJsonCollectedCents += money.collectedCents;
    }
    revenueCents += money.netCents;
    depositsCents += money.depositCents;
    const info = meta.get(money.eventId);
    const eventType = text(info?.event_type).trim() || "not recorded";
    typeMap.set(eventType, (typeMap.get(eventType) ?? 0) + money.netCents);
    const leadSource = info?.lead_id && text(info.source).trim() ? text(info.source).trim() : "not recorded";
    sourceMap.set(leadSource, (sourceMap.get(leadSource) ?? 0) + money.netCents);
    let packageLabel = "not recorded";
    if (packageOnPayment) {
      const linked = packageByEvent.get(money.eventId);
      if (linked) packageLabel = linked;
    } else if (packageOnEvent && info && text(info.package_id).trim()) {
      packageLabel = text(info.package_id).trim();
    }
    if (packageLabel === "not recorded") {
      const named = proposalPackage.get(money.eventId);
      if (named) packageLabel = named;
    }
    packageMap.set(packageLabel, (packageMap.get(packageLabel) ?? 0) + money.netCents);
  }
  revenueCents -= unappliedAdjustments;

  const relationalCollected = [...byEvent.values()].some((money) => money.source === "relational" && money.collectedCents > 0);
  const adjustments = adjustmentCentsColumn
    ? {
        recorded: true as const,
        cents: adjustmentCents,
        note: "payment_adjustments rows (refunds and cancellations) are subtracted from relational payments. Deposit totals stay the labeled payment amounts.",
      }
    : relationalCollected
      ? notRecorded(adjustmentTable
          ? "payment_adjustments has no amount_cents column, so nothing was subtracted."
          : "payment_adjustments is not in this database, so relational revenue is collected payments and is not net of adjustments.")
      : { recorded: true as const, cents: 0, note: "Planner JSON does not store payment adjustments. None were added." };

  const revenueIsNet = adjustments.recorded;

  if (await tableExists(db, "proposal_versions")) {
    const quoteRows = await rows<{ event_id: string; kind: string; number: number; snapshot: unknown; sent_at: string | null; accepted_at: string | null }>(
      db,
      `SELECT p.event_id, v.kind, v.number, v.snapshot, v.sent_at, v.accepted_at
       FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id`,
    );
    const grouped = new Map<string, typeof quoteRows>();
    for (const row of quoteRows) {
      const eventId = text(row.event_id);
      const list = grouped.get(eventId) ?? [];
      list.push(row);
      grouped.set(eventId, list);
    }
    for (const [eventId, versions] of grouped) {
      const quoted = quotedInvoiceCents(versions);
      const money = byEvent.get(eventId);
      if (quoted == null || !money || money.invoiceCents != null) continue;
      money.invoiceCents = quoted;
    }
  }

  const invoiceEvents = [...byEvent.values()].filter((money) => money.collectedCents > 0);
  const missingInvoice = invoiceEvents.filter((money) => money.invoiceCents == null);
  const invoice = missingInvoice.length || !invoiceEvents.length
    ? notRecorded(invoiceEvents.length
        ? "Invoice totals are not stored for every event with collected payments. A sent quote supplies the total. Planner JSON line items are used only when that event has no payment rows and no sent quote."
        : "No invoice totals are stored.")
    : { recorded: true as const, cents: invoiceEvents.reduce((sum, money) => sum + (money.invoiceCents ?? 0), 0) };

  const outstanding = invoice.recorded && adjustments.recorded
    ? { recorded: true as const, cents: invoice.cents - (relationalCollectedCents + plannerJsonCollectedCents) + adjustments.cents }
    : notRecorded(!adjustments.recorded
        ? "Outstanding balance needs payment adjustments from the same source, and that table is not available."
        : invoice.recorded ? "Outstanding balance is not recorded." : invoice.reason);

  const bookingEventRows = await rows<{ event_id: string }>(db, "SELECT event_id FROM bookings");
  const bookingsWithRevenue = bookingEventRows.filter((row) => (byEvent.get(text(row.event_id))?.netCents ?? 0) > 0);
  const bookingRevenue = bookingsWithRevenue.reduce((sum, row) => sum + (byEvent.get(text(row.event_id))?.netCents ?? 0), 0);
  const averageBookingValueCents = bookingsWithRevenue.length ? Math.round(bookingRevenue / bookingsWithRevenue.length) : null;

  const costRows = (await tableExists(db, "event_costs"))
    ? await rows<{ event_id: string; cents: number }>(db, "SELECT event_id, COALESCE(SUM(amount_cents), 0)::int AS cents FROM event_costs GROUP BY event_id")
    : [];
  const costByEvent = new Map(
    costRows
      .filter((row) => eventInRange(text(row.event_id)))
      .map((row) => [text(row.event_id), num(row.cents)]),
  );
  const profitability: Profitability = costByEvent.size
    ? (() => {
        const events = [...costByEvent.entries()].map(([eventId, costCents]) => {
          const revenue = byEvent.get(eventId)?.netCents ?? 0;
          const profitCents = revenue - costCents;
          return {
            eventId,
            revenueCents: revenue,
            costCents,
            profitCents,
            marginBps: revenue > 0 ? Math.round((profitCents / revenue) * 10_000) : null,
          };
        });
        const missingCostEvents = [...byEvent.values()].filter((money) => money.netCents > 0 && !costByEvent.has(money.eventId)).length;
        const totalProfitCents = missingCostEvents ? null : events.reduce((sum, event) => sum + event.profitCents, 0);
        const totalRevenue = missingCostEvents ? 0 : events.reduce((sum, event) => sum + event.revenueCents, 0);
        return {
          recorded: true as const,
          events,
          missingCostEvents,
          totalProfitCents,
          totalMarginBps: totalProfitCents === null || totalRevenue <= 0
            ? null
            : Math.round((totalProfitCents / totalRevenue) * 10_000),
        };
      })()
    : { recorded: false, label: "cost not recorded", reason: "No rows in event_costs." };

  const staffCount = num((await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM assignments"))?.n);
  const staffUtilization = staffCount
    ? {
        recorded: true as const,
        assignments: staffCount,
        staffAssigned: num((await one<{ n: number }>(db, "SELECT COUNT(DISTINCT staff_id)::int AS n FROM assignments"))?.n),
        eventsAssigned: num((await one<{ n: number }>(db, "SELECT COUNT(DISTINCT event_id)::int AS n FROM assignments"))?.n),
      }
    : notRecorded("No assignment rows.");

  const reservationCount = num((await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM equipment_reservations"))?.n);
  const equipmentTotals = reservationCount
    ? await one<{ reserved: number; on_hand: number; gear: number }>(
        db,
        `SELECT COALESCE(SUM(reserved), 0)::int AS reserved, COALESCE(SUM(on_hand), 0)::int AS on_hand, COUNT(*)::int AS gear
         FROM (
           SELECT e.quantity AS on_hand, SUM(r.quantity) AS reserved
           FROM equipment e
           JOIN equipment_reservations r ON r.equipment_id = e.id
           GROUP BY e.id, e.quantity
         ) reserved_gear`,
      )
    : null;
  const equipmentUtilization = equipmentTotals
    ? {
        recorded: true as const,
        reservations: reservationCount,
        equipmentReserved: num(equipmentTotals.gear),
        quantityReserved: num(equipmentTotals.reserved),
        quantityOnHand: num(equipmentTotals.on_hand),
      }
    : notRecorded("No equipment reservation rows.");

  const referrals = await referralReport(db, byEvent);
  const invitations = await invitationReport(db);
  const guestInquiries = await guestInquiryReport(db, await tableExists(db, "leads") ? await constraintText(db, "leads") : "");
  const repeatCustomers = num((await one<{ n: number }>(
    db,
    `SELECT COUNT(*)::int AS n FROM (
       SELECT customer_id FROM events WHERE customer_id IS NOT NULL GROUP BY customer_id HAVING COUNT(*) > 1
     ) repeats`,
  ))?.n);

  const note = moneyNote(relationalEvents, plannerJsonEvents, collectedStatus, revenueIsNet);

  // Contracted = accepted proposal invoice snapshots only (never invented).
  let contractedCents: number | null = null;
  if (await tableExists(db, "proposal_versions")) {
    const accepted = await rows<{ event_id: string; snapshot: unknown }>(
      db,
      `SELECT p.event_id, v.snapshot
       FROM proposal_versions v
       JOIN proposals p ON p.id = v.proposal_id
       WHERE v.accepted_at IS NOT NULL AND v.kind = 'quote'`,
    );
    let sum = 0;
    let count = 0;
    for (const row of accepted) {
      if (!eventInRange(text(row.event_id))) continue;
      const snap = typeof row.snapshot === "string" ? JSON.parse(row.snapshot) as { invoiceTotalCents?: unknown } : row.snapshot as { invoiceTotalCents?: unknown };
      const cents = num(snap?.invoiceTotalCents);
      if (!Number.isInteger(cents) || cents < 0) continue;
      sum += cents;
      count += 1;
    }
    contractedCents = count ? sum : null;
  }

  const leadRows = await tableExists(db, "leads")
    ? await rows<{ stage: string; converted_event_id: string | null; created_at: string }>(
      db,
      `SELECT stage, converted_event_id, created_at::date::text AS created_at
       FROM leads WHERE merged_into_id IS NULL`,
    )
    : [];
  const leadsInRange = leadRows.filter((row) => dateInRange(row.created_at, from, to));
  const leadStages = new Map<string, number>();
  let converted = 0;
  for (const row of leadsInRange) {
    const stage = text(row.stage).trim() || "not recorded";
    leadStages.set(stage, (leadStages.get(stage) ?? 0) + 1);
    if (row.converted_event_id) converted += 1;
  }
  const leadTotal = leadsInRange.length;

  const bookingRows = await tableExists(db, "bookings")
    ? await rows<{ status: string; event_id: string }>(db, "SELECT status, event_id FROM bookings")
    : [];
  const bookingPipelineMap = new Map<string, number>();
  for (const row of bookingRows) {
    if (!eventInRange(text(row.event_id))) continue;
    const status = text(row.status).trim() || "not recorded";
    bookingPipelineMap.set(status, (bookingPipelineMap.get(status) ?? 0) + 1);
  }

  const today = new Date().toISOString().slice(0, 10);
  let upcoming = 0;
  let past = 0;
  let completed = 0;
  let cancelled = 0;
  typeCountMap.clear();
  for (const row of eventMeta) {
    if ((from || to) && !dateInRange(row.event_date, from, to)) continue;
    const eventType = text(row.event_type).trim() || "not recorded";
    typeCountMap.set(eventType, (typeCountMap.get(eventType) ?? 0) + 1);
    if (!typeMap.has(eventType)) typeMap.set(eventType, 0);
    const status = text(row.status);
    if (status === "cancelled") cancelled += 1;
    else if (status === "completed") completed += 1;
    if (row.event_date && row.event_date >= today && status !== "cancelled") upcoming += 1;
    if (row.event_date && row.event_date < today) past += 1;
  }

  const byEventType = [...typeMap.keys()].map((label) => ({
    label,
    revenueCents: typeMap.get(label) ?? 0,
    eventCount: typeCountMap.get(label) ?? 0,
  })).sort((a, b) => b.revenueCents - a.revenueCents || b.eventCount - a.eventCount || a.label.localeCompare(b.label));

  return {
    moneySource: { note, relationalEvents, plannerJsonEvents, collectedStatus, revenueIsNet },
    range: { from, to, note: rangeNote },
    revenueCents,
    relationalCollectedCents,
    plannerJsonCollectedCents,
    adjustments,
    depositsCents,
    contractedCents,
    invoice,
    outstanding,
    byEventType,
    byPackage: buckets(packageMap),
    packageNote: packageOnPayment || packageOnEvent
      ? "Package ids stored on the payment or the event are used. A sent quote supplies the name when those links are missing."
      : "Package names come from the quote linked to the event. Events without a quote are counted as not recorded.",
    byLeadSource: buckets(sourceMap),
    averageBookingValueCents,
    bookingsWithRevenue: bookingsWithRevenue.length,
    leads: {
      total: leadTotal,
      converted,
      conversionRate: leadTotal ? converted / leadTotal : null,
      byStage: [...leadStages.entries()].map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage)),
      definition: "Converted means converted_event_id is set (CRM book flow). Rate is converted ÷ open leads in range; blank when there are no leads.",
    },
    bookingPipeline: [...bookingPipelineMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    eventsTimeline: {
      upcoming,
      past,
      completed,
      cancelled,
      definition: "Upcoming = event_date on/after today and not cancelled. Past = event_date before today. Completed/cancelled use events.status.",
    },
    profitability,
    staffUtilization,
    equipmentUtilization,
    referrals,
    invitations,
    guestInquiries,
    repeatCustomers,
  };
}

function moneyNote(relationalEvents: number, plannerJsonEvents: number, collectedStatus: "succeeded" | "paid" | null, revenueIsNet: boolean) {
  if (!relationalEvents && !plannerJsonEvents) {
    return "The payments table is empty, and no planner JSON payments are stored. Figures are zero where a count is real, or not recorded where the source has no rows.";
  }
  const statusNote = collectedStatus === "succeeded"
    ? "Relational revenue uses status succeeded."
    : collectedStatus === "paid"
      ? "This database has no succeeded status. Relational revenue uses status paid."
      : "No collected payment status was found.";
  const netNote = revenueIsNet ? "Adjustments were subtracted." : "Adjustments were not subtracted.";
  if (relationalEvents && plannerJsonEvents) {
    return `${relationalEvents} events use relational payments. ${plannerJsonEvents} events have no payment rows and were read from planner JSON. The two sources were not added for the same event. ${statusNote} ${netNote}`;
  }
  if (relationalEvents) return `Revenue is from relational payments only. Planner JSON payments were not added. ${statusNote} ${netNote}`;
  return "The payments table has no rows for these events. Figures are paid amounts stored on planner JSON (admin_data.payments), not line items. They were not added to the relational payments table. Planner JSON has no payment adjustments.";
}

async function referralReport(db: ReportDb, byEvent: Map<string, EventMoney>): Promise<BusinessReport["referrals"]> {
  const hasLead = await columnExists(db, "leads", "referred_by");
  const hasEvent = await columnExists(db, "events", "referred_by");
  if (!hasLead && !hasEvent) return notRecorded("No referred_by column is stored on leads or events.");
  const leadRows = hasLead
    ? await rows<{ label: string; n: number }>(
        db,
        `SELECT btrim(referred_by) AS label, COUNT(*)::int AS n FROM leads
         WHERE referred_by IS NOT NULL AND btrim(referred_by) <> '' GROUP BY btrim(referred_by)`,
      )
    : [];
  const eventRows = hasEvent
    ? await rows<{ id: string; label: string }>(
        db,
        "SELECT id, btrim(referred_by) AS label FROM events WHERE referred_by IS NOT NULL AND btrim(referred_by) <> ''",
      )
    : [];
  if (!leadRows.length && !eventRows.length) return notRecorded("Referral columns exist, but no lead or event has a referred_by value.");
  const eventMap = new Map<string, number>();
  for (const row of eventRows) {
    const label = text(row.label);
    eventMap.set(label, (eventMap.get(label) ?? 0) + (byEvent.get(text(row.id))?.collectedCents ?? 0));
  }
  return {
    recorded: true,
    leads: leadRows.map((row) => ({ label: text(row.label), count: num(row.n) })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    events: [...eventMap.entries()].map(([label, revenueCents]) => ({ label, revenueCents })).sort((a, b) => b.revenueCents - a.revenueCents || a.label.localeCompare(b.label)),
  };
}

async function invitationReport(db: ReportDb): Promise<BusinessReport["invitations"]> {
  if (!(await tableExists(db, "invitations")) || !(await tableExists(db, "rsvps"))) {
    return { count: 0, rsvps: 0, responded: 0, responseRate: null };
  }
  const count = num((await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM invitations"))?.n);
  const rsvps = num((await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM rsvps"))?.n);
  const responded = num((await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM rsvps WHERE status IN ('yes', 'no') OR responded_at IS NOT NULL"))?.n);
  return { count, rsvps, responded, responseRate: rsvps ? responded / rsvps : null };
}

async function guestInquiryReport(db: ReportDb, leadRules: string): Promise<BusinessReport["guestInquiries"]> {
  const marker = await rows<{ column_name: string }>(
    db,
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leads'
       AND column_name IN ('attribution', 'guest_generated', 'inquiry_origin')`,
  );
  const guestValues = [...leadRules.matchAll(/'([^']*guest[^']*)'/gi)].map((match) => match[1]).filter((value) => value.toLowerCase() !== "guest_count");
  if (!marker.length && !guestValues.length) {
    return notRecorded("Leads have no guest attribution field, and the stored source values do not mark a guest inquiry.");
  }
  if (guestValues.length) {
    const placeholders = guestValues.map(() => "?").join(", ");
    const count = num((await one<{ n: number }>(db, `SELECT COUNT(*)::int AS n FROM leads WHERE source IN (${placeholders})`, guestValues))?.n);
    return { recorded: true, count };
  }
  return notRecorded("A guest column name exists, but this report does not guess which values mark a guest inquiry.");
}
