import { audit } from "@/lib/audit";
import { depositDueOn, getBusinessSettings } from "@/lib/business-settings";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { saveEventFile } from "@/lib/files";
import { adminDataSchema } from "@/lib/planner";

// Dashboard money source. Outstanding balance uses this ledger only.
// Planner JSON payments are never added to these totals.
export const MONEY_SOURCE = "ledger";
export const MONEY_SOURCE_DETAIL =
  "Outstanding balance is the latest sent quote snapshot, plus accepted change orders, minus payments with status paid, plus refund adjustments, minus cancellation credits. Planner JSON payments are not included.";

const ruleKinds = ["overtime", "travel", "setup", "discount", "adjustment", "tax", "deposit"] as const;
export type RuleKind = (typeof ruleKinds)[number];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PricingRuleInput = {
  kind: string;
  label: string;
  amountCents: number | null;
  percent: number | null;
  active: boolean;
  definition?: { includedMinutes?: number | null };
};

export type QuoteLine = {
  description: string;
  quantity: number;
  unitAmountCents: number;
  serviceId: string | null;
};

type QuoteSnapshot = {
  packageId: string | null;
  packageName: string;
  lines: QuoteLine[];
  charges: { kind: string; label: string; amountCents: number }[];
  invoiceTotalCents: number;
  // Frozen at send time from an active deposit rule. Null means acceptance cannot invent an amount.
  deposit: { label: string; amountCents: number } | null;
};

export const DEPOSIT_RULE_REQUIRED =
  "Add an active deposit pricing rule in Catalog (fixed amount or percent) before quote acceptance can create the deposit obligation. Amounts are never invented.";

/** One deposit obligation per event. Version id is audited, not used as the schedule key. */
export const DEPOSIT_SCHEDULE_KEY = "deposit";

export type PaymentKind = "deposit" | "balance" | "other";

export function assertStripeTestMode(key = (env.STRIPE_SECRET_KEY ?? "").trim()) {
  if (!key) return;
  if (key.startsWith("sk_live_")) {
    throw new AppError("Live Stripe keys are not allowed. Configure a Stripe TEST MODE secret key (sk_test_...).", 503);
  }
  if (!key.startsWith("sk_test_")) {
    throw new AppError("Stripe secret key must be a TEST MODE key (sk_test_...).", 503);
  }
}

type VersionRow = {
  id: string;
  kind: string;
  number: number;
  snapshot: unknown;
  sent_at: string | null;
  accepted_at: string | null;
};

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function asNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

export function assertNoCardData(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 13 && digits.length <= 19) throw new AppError("Card numbers are not stored. Use Checkout for cards.", 400);
}

function clockMinutes(value: string) {
  const text = value.trim();
  const ampm = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(text);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    const pm = ampm[3].toLowerCase() === "pm";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
    return hour * 60 + minute;
  }
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!h24) return null;
  const hour = Number(h24[1]);
  const minute = Number(h24[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function durationMinutes(start: string, end: string) {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from == null || to == null || to <= from) return null;
  return to - from;
}

// Applies only stored, active rules. A missing rule means that charge is absent.
export function quoteTotals(input: {
  lines: { quantity: number; unitAmountCents: number | null }[];
  rules: PricingRuleInput[];
  durationMinutes?: number | null;
}) {
  const priced = input.lines.filter((line) => line.unitAmountCents != null && line.quantity > 0);
  const subtotalCents = priced.reduce((sum, line) => sum + Math.round(line.quantity * (line.unitAmountCents as number)), 0);
  const charges: { kind: string; label: string; amountCents: number }[] = [];
  for (const rule of input.rules) {
    if (!rule.active || rule.kind === "deposit") continue;
    if (rule.kind === "overtime") {
      const included = rule.definition?.includedMinutes;
      if (included == null || input.durationMinutes == null || input.durationMinutes <= included || rule.amountCents == null) continue;
      charges.push({ kind: "overtime", label: rule.label, amountCents: rule.amountCents });
      continue;
    }
    const magnitude = rule.percent != null ? Math.round((subtotalCents * rule.percent) / 100) : rule.amountCents;
    if (magnitude == null || magnitude === 0) continue;
    const amountCents = rule.kind === "discount" ? -Math.abs(magnitude) : Math.abs(magnitude);
    charges.push({ kind: rule.kind, label: rule.label, amountCents });
  }
  const invoiceTotalCents = Math.max(0, subtotalCents + charges.reduce((sum, charge) => sum + charge.amountCents, 0));
  const depositRule = input.rules.find((rule) => rule.active && rule.kind === "deposit");
  let deposit: { label: string; amountCents: number } | null = null;
  if (depositRule) {
    const amountCents = depositRule.percent != null ? Math.round((invoiceTotalCents * depositRule.percent) / 100) : depositRule.amountCents;
    if (amountCents != null) deposit = { label: depositRule.label, amountCents };
  }
  return { subtotalCents, charges, invoiceTotalCents, deposit, pricedCount: priced.length };
}

// Refunds increase what is still owed. Cancellation credits reduce it.
export function outstandingCents(input: {
  invoiceTotalCents: number;
  succeededPaymentCents: number;
  adjustments: { kind: string; amountCents: number }[];
}) {
  const adjustmentCents = input.adjustments.reduce((sum, row) => sum + (row.kind === "cancellation" ? -row.amountCents : row.amountCents), 0);
  return input.invoiceTotalCents - input.succeededPaymentCents + adjustmentCents;
}

export function invoiceStatus(invoiceTotalCents: number, paidCents: number, balanceCents: number) {
  if (invoiceTotalCents <= 0 && paidCents <= 0) return "none";
  if (balanceCents <= 0 && (paidCents > 0 || invoiceTotalCents > 0)) return "paid";
  if (paidCents > 0) return "partial";
  return "open";
}

function snapshotOf(row: VersionRow) {
  return asJson<QuoteSnapshot>(row.snapshot);
}

function invoiceFromVersions(versions: VersionRow[]) {
  const quotes = versions.filter((version) => version.kind === "quote" && version.sent_at).sort((a, b) => b.number - a.number);
  const latest = quotes[0];
  const changes = versions.filter((version) => version.kind === "change" && version.accepted_at);
  const base = latest ? snapshotOf(latest).invoiceTotalCents : 0;
  return base + changes.reduce((sum, version) => sum + snapshotOf(version).invoiceTotalCents, 0);
}

// Null when no quote has been sent. A sent quote of zero is a stored total, not a missing one.
export function quotedInvoiceCents(versions: Pick<VersionRow, "kind" | "number" | "snapshot" | "sent_at" | "accepted_at">[]) {
  const quotes = versions.filter((version) => version.kind === "quote" && version.sent_at);
  if (!quotes.length) return null;
  return invoiceFromVersions(versions as VersionRow[]);
}

async function activeRules(): Promise<PricingRuleInput[]> {
  const rows = await database().prepare("SELECT kind, label, amount_cents, percent, definition, active FROM pricing_rules WHERE active = true").all<{
    kind: string;
    label: string;
    amount_cents: number | null;
    percent: number | string | null;
    definition: unknown;
    active: boolean;
  }>();
  return rows.results.map((row) => ({
    kind: row.kind,
    label: row.label,
    amountCents: asNumber(row.amount_cents),
    percent: asNumber(row.percent),
    active: row.active !== false,
    definition: asJson<{ includedMinutes?: number | null }>(row.definition || {}),
  }));
}

async function nextVersion(proposalId: string) {
  const row = await database().prepare("SELECT COALESCE(MAX(number), 0)::int AS n FROM proposal_versions WHERE proposal_id = ?").bind(proposalId).first<{ n: number }>();
  return Number(row?.n ?? 0) + 1;
}

async function proposalFor(eventId: string) {
  return database().prepare("SELECT id, status, title FROM proposals WHERE event_id = ? ORDER BY created_at ASC LIMIT 1").bind(eventId).first<{ id: string; status: string; title: string }>();
}

async function patchPlannerLines(eventId: string, packageName: string, lines: QuoteLine[], mode: "replace" | "append") {
  const row = await database().prepare("SELECT id, admin_data FROM planner_events WHERE id = ? OR event_id = ? LIMIT 1").bind(eventId, eventId).first<{ id: string; admin_data: string }>();
  if (!row) return;
  const admin = adminDataSchema.parse(typeof row.admin_data === "string" ? JSON.parse(row.admin_data) : row.admin_data);
  const mapped = lines.map((line) => ({
    id: crypto.randomUUID().slice(0, 12),
    description: line.description,
    qty: line.quantity,
    price: line.unitAmountCents / 100,
  }));
  const lineItems = mode === "append" ? [...admin.lineItems, ...mapped] : mapped;
  const next = { ...admin, packageName: packageName || admin.packageName, lineItems };
  await database().prepare("UPDATE planner_events SET admin_data = ?::jsonb, updated_at = now() WHERE id = ?").bind(JSON.stringify(next), row.id).run();
}

export async function listServices() {
  const rows = await database().prepare(
    "SELECT id, name, description, price_cents, active, price_approved_at, published FROM services ORDER BY name",
  ).all<{
    id: string;
    name: string;
    description: string;
    price_cents: number | null;
    active: boolean;
    price_approved_at: string | null;
    published: boolean;
  }>();
  return rows.results.map((row) => ({
    ...row,
    price_cents: asNumber(row.price_cents),
    priceApprovedAt: row.price_approved_at,
    published: Boolean(row.published),
  }));
}

export async function saveService(input: { id?: string; name: string; description?: string; priceCents: number | null; active?: boolean; actorEmail: string; ip?: string }) {
  const name = input.name.trim().slice(0, 200);
  if (name.length < 2) throw new AppError("Add a service name.", 400);
  if (input.priceCents != null && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) throw new AppError("Enter a price or leave it blank.", 400);
  const description = (input.description ?? "").slice(0, 2000);
  const active = input.active !== false;
  const id = input.id && uuidPattern.test(input.id) ? input.id : crypto.randomUUID();
  const existing = input.id
    ? await database().prepare("SELECT id, price_cents, price_approved_at, published FROM services WHERE id = ?").bind(id).first<{ id: string; price_cents: number | null; price_approved_at: string | null; published: boolean }>()
    : null;
  const priceChanged = !existing || asNumber(existing.price_cents) !== input.priceCents;
  if (existing) {
    await database().prepare(
      `UPDATE services SET name = ?, description = ?, price_cents = ?, active = ?,
        price_approved_at = CASE WHEN ? THEN NULL ELSE price_approved_at END,
        published = CASE WHEN ? THEN false ELSE published END,
        updated_at = now() WHERE id = ?`,
    ).bind(name, description, input.priceCents, active, priceChanged, priceChanged, id).run();
  } else {
    await database().prepare("INSERT INTO services (id, name, description, price_cents, active, published) VALUES (?, ?, ?, ?, ?, false)")
      .bind(id, name, description, input.priceCents, active).run();
  }
  await audit({ actorEmail: input.actorEmail, action: "price_rule_changed", entity: "services", subjectId: id, ip: input.ip, before: existing ? { priceCents: asNumber(existing.price_cents), published: existing.published } : undefined, after: { name, priceCents: input.priceCents, active, published: priceChanged ? false : existing?.published } });
  return { id };
}

export async function listPackages() {
  const packages = await database().prepare(
    "SELECT id, name, description, price_cents, active, price_approved_at, published FROM packages ORDER BY name",
  ).all<{
    id: string;
    name: string;
    description: string;
    price_cents: number | null;
    active: boolean;
    price_approved_at: string | null;
    published: boolean;
  }>();
  const links = await database().prepare("SELECT package_id, service_id, optional FROM package_services").all<{ package_id: string; service_id: string; optional: boolean }>();
  return packages.results.map((row) => ({
    ...row,
    price_cents: asNumber(row.price_cents),
    priceApprovedAt: row.price_approved_at,
    published: Boolean(row.published),
    services: links.results.filter((link) => link.package_id === row.id).map((link) => ({ serviceId: link.service_id, optional: Boolean(link.optional) })),
  }));
}

export async function savePackage(input: { id?: string; name: string; description?: string; priceCents: number | null; active?: boolean; actorEmail: string; ip?: string }) {
  const name = input.name.trim().slice(0, 200);
  if (name.length < 2) throw new AppError("Add a package name.", 400);
  if (input.priceCents != null && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) throw new AppError("Enter a price or leave it blank.", 400);
  const id = input.id && uuidPattern.test(input.id) ? input.id : crypto.randomUUID();
  const existing = input.id
    ? await database().prepare("SELECT price_cents, published FROM packages WHERE id = ?").bind(id).first<{ price_cents: number | null; published: boolean }>()
    : null;
  const priceChanged = !existing || asNumber(existing.price_cents) !== input.priceCents;
  if (existing) {
    await database().prepare(
      `UPDATE packages SET name = ?, description = ?, price_cents = ?, active = ?,
        price_approved_at = CASE WHEN ? THEN NULL ELSE price_approved_at END,
        published = CASE WHEN ? THEN false ELSE published END,
        updated_at = now() WHERE id = ?`,
    ).bind(name, (input.description ?? "").slice(0, 2000), input.priceCents, input.active !== false, priceChanged, priceChanged, id).run();
  } else {
    await database().prepare("INSERT INTO packages (id, name, description, price_cents, active, published) VALUES (?, ?, ?, ?, ?, false)")
      .bind(id, name, (input.description ?? "").slice(0, 2000), input.priceCents, input.active !== false).run();
  }
  await audit({ actorEmail: input.actorEmail, action: "price_rule_changed", entity: "packages", subjectId: id, ip: input.ip, before: existing ? { priceCents: asNumber(existing.price_cents), published: existing.published } : undefined, after: { name, priceCents: input.priceCents, published: priceChanged ? false : existing?.published } });
  return { id };
}

export async function approveCatalogPrice(input: { kind: "package" | "service"; id: string; actorEmail: string; ip?: string }) {
  const table = input.kind === "package" ? "packages" : "services";
  const row = await database().prepare(`SELECT id, name, price_cents, price_approved_at, published FROM ${table} WHERE id = ?`)
    .bind(input.id).first<{ id: string; name: string; price_cents: number | null; price_approved_at: string | null; published: boolean }>();
  if (!row) throw new AppError("Catalog item not found.", 404);
  if (row.price_cents == null) throw new AppError("Enter a price before approving. A missing price is not treated as $0.", 400);
  await database().prepare(`UPDATE ${table} SET price_approved_at = now(), updated_at = now() WHERE id = ?`).bind(input.id).run();
  await audit({
    actorEmail: input.actorEmail,
    action: "price_approved",
    entity: table,
    subjectId: input.id,
    ip: input.ip,
    before: { priceCents: asNumber(row.price_cents), approvedAt: row.price_approved_at, published: row.published },
    after: { priceCents: asNumber(row.price_cents), approved: true, published: row.published },
  });
  return { id: input.id };
}

export async function publishCatalogPrice(input: { kind: "package" | "service"; id: string; actorEmail: string; ip?: string }) {
  const table = input.kind === "package" ? "packages" : "services";
  const row = await database().prepare(`SELECT id, name, price_cents, price_approved_at, published, active FROM ${table} WHERE id = ?`)
    .bind(input.id).first<{ id: string; name: string; price_cents: number | null; price_approved_at: string | null; published: boolean; active: boolean }>();
  if (!row) throw new AppError("Catalog item not found.", 404);
  if (row.price_cents == null) throw new AppError("Enter a price before publishing. A missing price is not treated as $0.", 400);
  if (!row.price_approved_at) throw new AppError("Approve the price before publishing it for customer quotes.", 400);
  if (row.active === false) throw new AppError("Activate the catalog item before publishing it.", 400);
  await database().prepare(`UPDATE ${table} SET published = true, updated_at = now() WHERE id = ?`).bind(input.id).run();
  await audit({
    actorEmail: input.actorEmail,
    action: "price_published",
    entity: table,
    subjectId: input.id,
    ip: input.ip,
    before: { published: row.published, priceCents: asNumber(row.price_cents) },
    after: { published: true, priceCents: asNumber(row.price_cents), name: row.name },
  });
  return { id: input.id };
}

export async function unpublishCatalogPrice(input: { kind: "package" | "service"; id: string; actorEmail: string; ip?: string }) {
  const table = input.kind === "package" ? "packages" : "services";
  const row = await database().prepare(`SELECT id, published FROM ${table} WHERE id = ?`).bind(input.id).first<{ id: string; published: boolean }>();
  if (!row) throw new AppError("Catalog item not found.", 404);
  await database().prepare(`UPDATE ${table} SET published = false, updated_at = now() WHERE id = ?`).bind(input.id).run();
  await audit({ actorEmail: input.actorEmail, action: "price_unpublished", entity: table, subjectId: input.id, ip: input.ip, before: { published: row.published }, after: { published: false } });
  return { id: input.id };
}

export async function saveUpgrade(input: { packageId: string; serviceId: string; optional: boolean; actorEmail: string; ip?: string }) {
  if (!uuidPattern.test(input.packageId) || !uuidPattern.test(input.serviceId)) throw new AppError("Choose a package and a service.", 400);
  await database().prepare(
    `INSERT INTO package_services (package_id, service_id, optional) VALUES (?, ?, ?)
     ON CONFLICT (package_id, service_id) DO UPDATE SET optional = excluded.optional`,
  ).bind(input.packageId, input.serviceId, input.optional).run();
  await audit({ actorEmail: input.actorEmail, action: "price_rule_changed", entity: "package_services", subjectId: input.packageId, ip: input.ip, after: { serviceId: input.serviceId, optional: input.optional } });
}

export async function removeUpgrade(input: { packageId: string; serviceId: string; actorEmail: string; ip?: string }) {
  await database().prepare("DELETE FROM package_services WHERE package_id = ? AND service_id = ?").bind(input.packageId, input.serviceId).run();
  await audit({ actorEmail: input.actorEmail, action: "price_rule_changed", entity: "package_services", subjectId: input.packageId, ip: input.ip, after: { serviceId: input.serviceId, removed: true } });
}

export async function listPricingRules() {
  const rows = await database().prepare("SELECT id, kind, label, amount_cents, percent, definition, active FROM pricing_rules ORDER BY kind, label").all<{
    id: string;
    kind: string;
    label: string;
    amount_cents: number | null;
    percent: number | string | null;
    definition: unknown;
    active: boolean;
  }>();
  return rows.results.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    amountCents: asNumber(row.amount_cents),
    percent: asNumber(row.percent),
    definition: asJson<{ includedMinutes?: number }>(row.definition || {}),
    active: row.active !== false,
  }));
}

export async function savePricingRule(input: {
  id?: string;
  kind: string;
  label: string;
  amountCents: number | null;
  percent: number | null;
  active: boolean;
  includedMinutes?: number | null;
  actorEmail: string;
  ip?: string;
}) {
  if (!(ruleKinds as readonly string[]).includes(input.kind)) throw new AppError("Unknown pricing rule.", 400);
  const label = input.label.trim().slice(0, 120);
  if (!label) throw new AppError("Add a label for this rule.", 400);
  assertNoCardData(label);
  if (input.amountCents == null && input.percent == null) throw new AppError("Enter an amount or a percent. No rate is assumed.", 400);
  if (input.amountCents != null && (!Number.isInteger(input.amountCents) || input.amountCents < 0)) throw new AppError("Amount must be zero or more.", 400);
  if (input.percent != null && (input.percent < 0 || input.percent > 100)) throw new AppError("Percent must be between 0 and 100.", 400);
  if (input.includedMinutes != null && (!Number.isInteger(input.includedMinutes) || input.includedMinutes < 0)) throw new AppError("Included minutes must be zero or more.", 400);
  const definition = input.includedMinutes == null ? {} : { includedMinutes: input.includedMinutes };
  const id = input.id && uuidPattern.test(input.id) ? input.id : crypto.randomUUID();
  const existing = input.id ? await database().prepare("SELECT kind, label, amount_cents, percent, active FROM pricing_rules WHERE id = ?").bind(id).first() : null;
  if (existing) {
    await database().prepare("UPDATE pricing_rules SET kind = ?, label = ?, amount_cents = ?, percent = ?, definition = ?::jsonb, active = ? WHERE id = ?")
      .bind(input.kind, label, input.amountCents, input.percent, JSON.stringify(definition), input.active, id).run();
  } else {
    await database().prepare("INSERT INTO pricing_rules (id, kind, label, amount_cents, percent, definition, active) VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)")
      .bind(id, input.kind, label, input.amountCents, input.percent, JSON.stringify(definition), input.active).run();
  }
  await audit({
    actorEmail: input.actorEmail,
    action: "price_rule_changed",
    entity: "pricing_rules",
    subjectId: id,
    ip: input.ip,
    before: existing ?? undefined,
    after: { kind: input.kind, label, amountCents: input.amountCents, percent: input.percent, active: input.active, includedMinutes: input.includedMinutes ?? null },
  });
  return { id };
}

export async function sendQuote(input: { eventId: string; packageId: string; upgradeIds?: string[]; actorEmail: string; ip?: string }) {
  const event = await database().prepare("SELECT id, start_time, end_time FROM events WHERE id = ?").bind(input.eventId).first<{ id: string; start_time: string; end_time: string }>();
  if (!event) throw new AppError("Event not found.", 404);
  const pkg = await database().prepare(
    "SELECT id, name, price_cents, active, published, price_approved_at FROM packages WHERE id = ?",
  ).bind(input.packageId).first<{ id: string; name: string; price_cents: number | null; active: boolean; published: boolean; price_approved_at: string | null }>();
  if (!pkg || pkg.active === false) throw new AppError("Choose a package.", 400);
  if (pkg.price_cents == null) throw new AppError("Enter a package price before sending a quote. A missing price is not treated as $0.", 400);
  if (!pkg.price_approved_at || !pkg.published) {
    throw new AppError("Approve and publish the package price before sending it to a customer. Draft and demo prices stay out of quotes.", 400);
  }

  const links = await database().prepare(
    `SELECT ps.service_id, ps.optional, s.name, s.price_cents, s.active, s.published, s.price_approved_at
     FROM package_services ps JOIN services s ON s.id = ps.service_id WHERE ps.package_id = ?`,
  ).bind(pkg.id).all<{
    service_id: string;
    optional: boolean;
    name: string;
    price_cents: number | null;
    active: boolean;
    published: boolean;
    price_approved_at: string | null;
  }>();
  const lines: QuoteLine[] = [{ description: pkg.name, quantity: 1, unitAmountCents: Number(pkg.price_cents), serviceId: null }];
  const selected = new Set(input.upgradeIds ?? []);
  for (const link of links.results) {
    if (link.active === false) continue;
    const optional = Boolean(link.optional);
    if (optional && !selected.has(link.service_id)) continue;
    if (link.price_cents == null) {
      if (optional || selected.has(link.service_id)) throw new AppError(`Enter a price for ${link.name} before adding it. A missing price is not treated as $0.`, 400);
      continue;
    }
    if (!link.price_approved_at || !link.published) {
      throw new AppError(`Approve and publish ${link.name} before adding it to a customer quote.`, 400);
    }
    lines.push({ description: link.name, quantity: 1, unitAmountCents: Number(link.price_cents), serviceId: link.service_id });
  }

  const totals = quoteTotals({ lines, rules: await activeRules(), durationMinutes: durationMinutes(event.start_time, event.end_time) });
  if (totals.invoiceTotalCents <= 0) throw new AppError("A quote needs a positive total. Missing prices are not treated as $0.", 400);
  const settings = await getBusinessSettings();
  const deposit = totals.deposit && totals.deposit.amountCents > 0
    ? { ...totals.deposit, dueOn: depositDueOn(settings.depositDueDays) }
    : null;
  const snapshot: QuoteSnapshot = {
    packageId: pkg.id,
    packageName: pkg.name,
    lines,
    charges: totals.charges,
    invoiceTotalCents: totals.invoiceTotalCents,
    deposit: deposit ? { label: deposit.label, amountCents: deposit.amountCents } : null,
  };
  let proposal = await proposalFor(input.eventId);
  if (proposal?.status === "accepted") throw new AppError("This quote is already accepted. Add a change order for extra services.", 400);
  if (!proposal) {
    const id = crypto.randomUUID();
    await database().prepare("INSERT INTO proposals (id, event_id, package_id, title, status) VALUES (?, ?, ?, ?, 'draft')").bind(id, input.eventId, pkg.id, pkg.name).run();
    proposal = { id, status: "draft", title: pkg.name };
  }
  await database().prepare("DELETE FROM proposal_items WHERE proposal_id = ?").bind(proposal.id).run();
  let sort = 0;
  for (const line of lines) {
    await database().prepare("INSERT INTO proposal_items (id, proposal_id, service_id, description, quantity, unit_amount_cents, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), proposal.id, line.serviceId, line.description, line.quantity, line.unitAmountCents, sort).run();
    sort += 1;
  }
  const versionId = crypto.randomUUID();
  await database().prepare("INSERT INTO proposal_versions (id, proposal_id, number, kind, snapshot, sent_at) VALUES (?, ?, ?, 'quote', ?::jsonb, now())")
    .bind(versionId, proposal.id, await nextVersion(proposal.id), JSON.stringify(snapshot)).run();
  await database().prepare("UPDATE proposals SET package_id = ?, title = ?, status = 'sent', updated_at = now() WHERE id = ?").bind(pkg.id, pkg.name, proposal.id).run();
  await patchPlannerLines(input.eventId, pkg.name, lines, "replace");
  await audit({ actorEmail: input.actorEmail, action: "proposal_sent", entity: "proposals", subjectId: proposal.id, ip: input.ip, after: { versionId, invoiceTotalCents: totals.invoiceTotalCents, packageId: pkg.id, deposit } });
  const customer = await database().prepare(
    `SELECT c.email FROM events e LEFT JOIN customers c ON c.id = e.customer_id WHERE e.id = ?`,
  ).bind(input.eventId).first<{ email: string | null }>();
  if (customer?.email?.includes("@")) {
    const { notifyQuoteSent } = await import("@/lib/communications");
    await notifyQuoteSent({
      eventId: input.eventId,
      email: customer.email,
      packageName: pkg.name,
      invoiceTotalCents: totals.invoiceTotalCents,
      origin: process.env.MB_PUBLIC_ORIGIN ?? "",
      versionId,
    }).catch(() => undefined);
  }
  return { proposalId: proposal.id, versionId, invoiceTotalCents: totals.invoiceTotalCents, deposit };
}

export async function sendChangeOrder(input: {
  eventId: string;
  description?: string;
  quantity: number;
  unitAmountCents: number | null;
  serviceId?: string | null;
  actorEmail: string;
  ip?: string;
}) {
  const proposal = await proposalFor(input.eventId);
  if (!proposal || proposal.status !== "accepted") throw new AppError("Accept the quote before adding a change order.", 400);
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || input.quantity > 1000) throw new AppError("Enter a quantity.", 400);
  let unit = input.unitAmountCents;
  let description = (input.description ?? "").trim().slice(0, 200);
  const serviceId = input.serviceId && uuidPattern.test(input.serviceId) ? input.serviceId : null;
  if (serviceId) {
    const service = await database().prepare("SELECT name, price_cents, published, price_approved_at FROM services WHERE id = ?")
      .bind(serviceId).first<{ name: string; price_cents: number | null; published: boolean; price_approved_at: string | null }>();
    if (!service) throw new AppError("Choose a service.", 400);
    if (!description) description = service.name;
    if (unit == null && service.price_cents != null) {
      if (!service.price_approved_at || !service.published) {
        throw new AppError("Approve and publish this service price before using it on a change order.", 400);
      }
      unit = Number(service.price_cents);
    }
  }
  if (unit == null) throw new AppError("Enter an amount for this change. A missing price is not treated as $0.", 400);
  if (!Number.isInteger(unit) || unit < 0) throw new AppError("Enter an amount.", 400);
  if (!description) throw new AppError("Describe the added service.", 400);
  const line: QuoteLine = { description, quantity: input.quantity, unitAmountCents: unit, serviceId };
  const invoiceTotalCents = Math.round(input.quantity * unit);
  const snapshot: QuoteSnapshot = { packageId: null, packageName: "", lines: [line], charges: [], invoiceTotalCents, deposit: null };
  const versionId = crypto.randomUUID();
  await database().prepare("INSERT INTO proposal_versions (id, proposal_id, number, kind, snapshot, sent_at) VALUES (?, ?, ?, 'change', ?::jsonb, now())")
    .bind(versionId, proposal.id, await nextVersion(proposal.id), JSON.stringify(snapshot)).run();
  await audit({ actorEmail: input.actorEmail, action: "proposal_sent", entity: "proposal_versions", subjectId: versionId, ip: input.ip, after: { kind: "change", eventId: input.eventId, invoiceTotalCents } });
  return { proposalId: proposal.id, versionId, invoiceTotalCents };
}

async function resolveAcceptVersion(proposalId: string, versionId?: string) {
  if (versionId) {
    return database().prepare(
      "SELECT id, kind, number, snapshot, sent_at, accepted_at FROM proposal_versions WHERE id = ? AND proposal_id = ?",
    ).bind(versionId, proposalId).first<VersionRow>();
  }
  // Only the latest quote version is accept-eligible. Older sends stay on file but are ignored.
  const latestQuote = await database().prepare(
    `SELECT id, kind, number, snapshot, sent_at, accepted_at FROM proposal_versions
     WHERE proposal_id = ? AND kind = 'quote' AND sent_at IS NOT NULL
     ORDER BY number DESC LIMIT 1`,
  ).bind(proposalId).first<VersionRow>();
  if (latestQuote) return latestQuote;
  return database().prepare(
    `SELECT id, kind, number, snapshot, sent_at, accepted_at FROM proposal_versions
     WHERE proposal_id = ? AND kind = 'change' AND sent_at IS NOT NULL AND accepted_at IS NULL
     ORDER BY number ASC LIMIT 1`,
  ).bind(proposalId).first<VersionRow>();
}

export async function acceptProposal(input: { eventId: string; acceptedBy: string; actorEmail: string; ip?: string; versionId?: string }) {
  const proposal = await proposalFor(input.eventId);
  if (!proposal) throw new AppError("There is no quote to accept.", 404);
  const version = await resolveAcceptVersion(proposal.id, input.versionId);
  if (!version?.sent_at) throw new AppError("There is no quote to accept.", 404);

  const existingDeposit = async () => database().prepare(
    `SELECT id, status, amount_cents FROM payments
     WHERE event_id = ? AND kind = 'deposit' AND status IN ('due', 'paid')
     ORDER BY created_at ASC LIMIT 1`,
  ).bind(input.eventId).first<{ id: string; status: string; amount_cents: number }>();

  if (version.accepted_at) {
    const payment = version.kind === "quote" ? await existingDeposit() : null;
    return {
      proposalId: proposal.id,
      versionId: version.id,
      already: true,
      depositPaymentId: payment?.id ?? null,
      depositAmountCents: payment ? Number(payment.amount_cents) : null,
    };
  }

  // Refuse accepting an older quote when the caller targets it by id after a newer send.
  if (input.versionId && version.kind === "quote") {
    const newer = await database().prepare(
      `SELECT id FROM proposal_versions
       WHERE proposal_id = ? AND kind = 'quote' AND sent_at IS NOT NULL AND number > ? LIMIT 1`,
    ).bind(proposal.id, version.number).first<{ id: string }>();
    if (newer) throw new AppError("A newer quote was sent. Accept the latest quote.", 409);
  }

  const name = input.acceptedBy.trim().slice(0, 200) || "Client";

  if (version.kind === "change") {
    const snapshot = snapshotOf(version);
    const current = await database().prepare("SELECT COALESCE(MAX(sort_order), -1)::int AS n FROM proposal_items WHERE proposal_id = ?").bind(proposal.id).first<{ n: number }>();
    let sort = Number(current?.n ?? -1);
    const statements = [
      database().prepare("UPDATE proposal_versions SET accepted_at = now(), accepted_by = ? WHERE id = ? AND accepted_at IS NULL").bind(name, version.id),
    ];
    for (const line of snapshot.lines) {
      sort += 1;
      statements.push(
        database().prepare("INSERT INTO proposal_items (id, proposal_id, service_id, description, quantity, unit_amount_cents, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), proposal.id, line.serviceId, line.description, line.quantity, line.unitAmountCents, sort),
      );
    }
    await database().batch(statements);
    const raced = await database().prepare("SELECT accepted_at FROM proposal_versions WHERE id = ?").bind(version.id).first<{ accepted_at: string | null }>();
    if (!raced?.accepted_at) throw new AppError("There is no quote to accept.", 404);
    await patchPlannerLines(input.eventId, "", snapshot.lines, "append");
    await audit({ actorEmail: input.actorEmail, action: "proposal_accepted", entity: "proposals", subjectId: proposal.id, ip: input.ip, after: { versionId: version.id, kind: version.kind, acceptedBy: name } });
    return { proposalId: proposal.id, versionId: version.id, already: false, depositPaymentId: null, depositAmountCents: null };
  }

  // Quote acceptance creates exactly one deposit obligation (DUE). Amount comes only from the frozen quote snapshot.
  const snapshot = snapshotOf(version);
  const deposit = snapshot.deposit && snapshot.deposit.amountCents > 0 ? snapshot.deposit : null;
  if (!deposit) throw new AppError(DEPOSIT_RULE_REQUIRED, 409);

  const alreadyDeposit = await existingDeposit();
  if (alreadyDeposit) {
    await database().batch([
      database().prepare("UPDATE proposal_versions SET accepted_at = now(), accepted_by = ? WHERE id = ? AND accepted_at IS NULL").bind(name, version.id),
      database().prepare("UPDATE proposals SET status = 'accepted', updated_at = now() WHERE id = ?").bind(proposal.id),
    ]);
    await audit({
      actorEmail: input.actorEmail,
      action: "proposal_accepted",
      entity: "proposals",
      subjectId: proposal.id,
      ip: input.ip,
      after: { versionId: version.id, kind: "quote", acceptedBy: name, depositPaymentId: alreadyDeposit.id, depositAmountCents: Number(alreadyDeposit.amount_cents), depositStatus: alreadyDeposit.status, bookingConfirmed: false },
    });
    return {
      proposalId: proposal.id,
      versionId: version.id,
      already: false,
      depositPaymentId: alreadyDeposit.id,
      depositAmountCents: Number(alreadyDeposit.amount_cents),
    };
  }

  const settings = await getBusinessSettings();
  const dueOn = depositDueOn(settings.depositDueDays);
  const booking = await database().prepare("SELECT id FROM bookings WHERE event_id = ?").bind(input.eventId).first<{ id: string }>();
  const paymentId = crypto.randomUUID();
  const scheduleKey = DEPOSIT_SCHEDULE_KEY;

  try {
    await database().batch([
      database().prepare("UPDATE proposal_versions SET accepted_at = now(), accepted_by = ? WHERE id = ? AND accepted_at IS NULL").bind(name, version.id),
      database().prepare("UPDATE proposals SET status = 'accepted', updated_at = now() WHERE id = ?").bind(proposal.id),
      database().prepare(
        `INSERT INTO payments (id, event_id, booking_id, label, amount_cents, due_on, status, method, provider_ref, schedule_key, kind)
         VALUES (?, ?, ?, ?, ?, ?, 'due', '', '', ?, 'deposit')
         ON CONFLICT (event_id, schedule_key) WHERE schedule_key <> '' DO NOTHING`,
      ).bind(paymentId, input.eventId, booking?.id ?? null, deposit.label.slice(0, 120), deposit.amountCents, dueOn, scheduleKey),
    ]);
  } catch (error) {
    if (!/payments_schedule_key|payments_one_active_deposit|unique|duplicate/i.test(errorText(error))) throw error;
  }

  const accepted = await database().prepare("SELECT accepted_at FROM proposal_versions WHERE id = ?").bind(version.id).first<{ accepted_at: string | null }>();
  if (!accepted?.accepted_at) {
    const payment = await existingDeposit();
    if (payment) {
      return {
        proposalId: proposal.id,
        versionId: version.id,
        already: true,
        depositPaymentId: payment.id,
        depositAmountCents: Number(payment.amount_cents),
      };
    }
    throw new AppError("There is no quote to accept.", 404);
  }

  let payment = await existingDeposit();
  if (!payment) {
    try {
      await database().prepare(
        `INSERT INTO payments (id, event_id, booking_id, label, amount_cents, due_on, status, method, provider_ref, schedule_key, kind)
         VALUES (?, ?, ?, ?, ?, ?, 'due', '', '', ?, 'deposit')`,
      ).bind(paymentId, input.eventId, booking?.id ?? null, deposit.label.slice(0, 120), deposit.amountCents, dueOn, scheduleKey).run();
    } catch (error) {
      if (!/payments_schedule_key|payments_one_active_deposit|unique|duplicate/i.test(errorText(error))) throw error;
    }
    payment = await existingDeposit();
  }
  if (!payment) throw new AppError("The deposit obligation could not be created.", 500);

  const bookingStatus = await database().prepare("SELECT status FROM bookings WHERE event_id = ?").bind(input.eventId).first<{ status: string }>();
  await audit({
    actorEmail: input.actorEmail,
    action: "proposal_accepted",
    entity: "proposals",
    subjectId: proposal.id,
    ip: input.ip,
    after: {
      versionId: version.id,
      kind: "quote",
      acceptedBy: name,
      depositPaymentId: payment.id,
      depositAmountCents: Number(payment.amount_cents),
      depositStatus: "due",
      bookingStatus: bookingStatus?.status ?? null,
      bookingConfirmed: false,
    },
  });
  await audit({
    actorEmail: input.actorEmail,
    action: "deposit_scheduled",
    entity: "payments",
    subjectId: payment.id,
    ip: input.ip,
    after: {
      eventId: input.eventId,
      label: deposit.label,
      amountCents: deposit.amountCents,
      dueOn,
      scheduleKey,
      kind: "deposit",
      quoteVersionId: version.id,
      bookingConfirmed: false,
    },
  });

  const customer = await database().prepare(
    `SELECT c.email FROM events e LEFT JOIN customers c ON c.id = e.customer_id WHERE e.id = ?`,
  ).bind(input.eventId).first<{ email: string | null }>();
  if (customer?.email?.includes("@")) {
    const { notifyDepositInvoice } = await import("@/lib/communications");
    await notifyDepositInvoice({
      eventId: input.eventId,
      email: customer.email,
      label: deposit.label,
      amountCents: Number(payment.amount_cents),
      dueOn,
      paymentId: payment.id,
      origin: process.env.MB_PUBLIC_ORIGIN ?? "",
    }).catch(() => undefined);
  }

  return {
    proposalId: proposal.id,
    versionId: version.id,
    already: false,
    depositPaymentId: payment.id,
    depositAmountCents: Number(payment.amount_cents),
  };
}

export async function upsertSignedContract(input: {
  eventId: string;
  title: string;
  body: string;
  signedName: string;
  signedIp: string;
  signature?: Uint8Array;
  actorEmail: string;
  userId?: string | null;
}) {
  assertNoCardData(input.signedName);
  const existing = await database().prepare("SELECT id, status FROM contracts WHERE event_id = ?").bind(input.eventId).first<{ id: string; status: string }>();
  if (existing?.status === "signed") return { id: existing.id, created: false };
  const proposal = await proposalFor(input.eventId);
  let fileId: string | null = null;
  if (input.signature && input.signature.byteLength > 0) {
    const saved = await saveEventFile({
      bytes: input.signature,
      filename: "signature.png",
      contentType: "image/png",
      kind: "contract",
      eventId: input.eventId,
      actorEmail: input.actorEmail,
      userId: input.userId,
      ip: input.signedIp,
    });
    fileId = saved.id;
  }
  const title = input.title.slice(0, 200);
  const signedName = input.signedName.trim().slice(0, 200);
  const signedIp = input.signedIp.slice(0, 80);
  if (existing) {
    await database().prepare(
      `UPDATE contracts SET proposal_id = ?, file_id = COALESCE(?, file_id), title = ?, status = 'signed', body = ?, signed_name = ?, signed_at = now(), signed_ip = ?, updated_at = now()
       WHERE id = ? AND status <> 'signed'`,
    ).bind(proposal?.id ?? null, fileId, title, input.body, signedName, signedIp, existing.id).run();
    await audit({ actorEmail: input.actorEmail, action: "contract_signed", entity: "contracts", subjectId: existing.id, ip: signedIp, after: { eventId: input.eventId, signedName } });
    return { id: existing.id, created: false };
  }
  const id = crypto.randomUUID();
  try {
    await database().prepare(
      "INSERT INTO contracts (id, event_id, proposal_id, file_id, title, status, body, signed_name, signed_at, signed_ip) VALUES (?, ?, ?, ?, ?, 'signed', ?, ?, now(), ?)",
    ).bind(id, input.eventId, proposal?.id ?? null, fileId, title, input.body, signedName, signedIp).run();
  } catch (error) {
    if (errorText(error).includes("contracts_event")) {
      const again = await database().prepare("SELECT id, status FROM contracts WHERE event_id = ?").bind(input.eventId).first<{ id: string; status: string }>();
      if (again) return { id: again.id, created: false };
    }
    throw error;
  }
  await audit({ actorEmail: input.actorEmail, action: "contract_signed", entity: "contracts", subjectId: id, ip: signedIp, after: { eventId: input.eventId, signedName } });
  return { id, created: true };
}

export async function addSchedulePayment(input: {
  eventId: string;
  label: string;
  amountCents: number;
  dueOn?: string | null;
  kind?: PaymentKind;
  actorEmail: string;
  ip?: string;
}) {
  const label = input.label.trim().slice(0, 120);
  if (!label) throw new AppError("Add a label.", 400);
  assertNoCardData(label);
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new AppError("Enter an amount.", 400);
  const kind: PaymentKind = input.kind === "deposit" || input.kind === "balance" ? input.kind : "other";
  if (kind === "deposit") throw new AppError("Deposit obligations are created only when a quote is accepted. Schedule a balance or other payment instead.", 400);
  const event = await database().prepare("SELECT id FROM events WHERE id = ?").bind(input.eventId).first();
  if (!event) throw new AppError("Event not found.", 404);
  const booking = await database().prepare("SELECT id FROM bookings WHERE event_id = ?").bind(input.eventId).first<{ id: string }>();
  const due = input.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;
  const id = crypto.randomUUID();
  await database().prepare(
    "INSERT INTO payments (id, event_id, booking_id, label, amount_cents, due_on, status, method, provider_ref, kind) VALUES (?, ?, ?, ?, ?, ?, 'due', '', '', ?)",
  ).bind(id, input.eventId, booking?.id ?? null, label, input.amountCents, due, kind).run();
  await audit({ actorEmail: input.actorEmail, action: "payment_scheduled", entity: "payments", subjectId: id, ip: input.ip, after: { eventId: input.eventId, label, amountCents: input.amountCents, dueOn: due, kind } });
  return { id };
}

/** Authorized offline collection. Requires method + evidence reference. Never stores card numbers. */
export async function recordOfflinePayment(input: {
  eventId: string;
  paymentId: string;
  method: string;
  evidenceRef: string;
  note?: string;
  actorEmail: string;
  ip?: string;
}) {
  const method = input.method.trim().slice(0, 80);
  const evidenceRef = input.evidenceRef.trim().slice(0, 120);
  const note = (input.note ?? "").trim().slice(0, 500);
  if (!method) throw new AppError("Enter how the payment was received (check, cash, transfer).", 400);
  if (!evidenceRef) throw new AppError("Enter an evidence reference (check number, transfer id, or receipt number).", 400);
  assertNoCardData(method);
  assertNoCardData(evidenceRef);
  assertNoCardData(note);
  const row = await database().prepare(
    "SELECT id, status, amount_cents, label, kind FROM payments WHERE id = ? AND event_id = ?",
  ).bind(input.paymentId, input.eventId).first<{ id: string; status: string; amount_cents: number; label: string; kind: string }>();
  if (!row) throw new AppError("Payment not found.", 404);
  if (row.status === "paid") {
    return { id: row.id, already: true as const };
  }
  if (row.status !== "due") throw new AppError("Only a due payment can be marked paid offline.", 400);
  const providerRef = `offline:${evidenceRef}`.slice(0, 160);
  const updated = await database().prepare(
    `UPDATE payments
     SET status = 'paid', method = ?, provider_ref = ?, paid_at = now(), updated_at = now()
     WHERE id = ? AND status = 'due' AND provider_ref = ''`,
  ).bind(method, providerRef, row.id).run();
  if (!updated.meta.changes) {
    const again = await database().prepare("SELECT id, status FROM payments WHERE id = ?").bind(row.id).first<{ id: string; status: string }>();
    if (again?.status === "paid") return { id: row.id, already: true as const };
    throw new AppError("That payment could not be marked paid.", 409);
  }
  await writeReceipt(row.id, input.eventId, providerRef, Number(row.amount_cents));
  await audit({
    actorEmail: input.actorEmail,
    action: "payment_offline_recorded",
    entity: "payments",
    subjectId: row.id,
    ip: input.ip,
    after: { eventId: input.eventId, method, evidenceRef, amountCents: Number(row.amount_cents), kind: row.kind, label: row.label },
  });
  return { id: row.id, already: false as const };
}

export async function voidDuePayment(input: { eventId: string; paymentId: string; actorEmail: string; ip?: string }) {
  const row = await database().prepare("SELECT id, status, amount_cents FROM payments WHERE id = ? AND event_id = ?").bind(input.paymentId, input.eventId).first<{ id: string; status: string; amount_cents: number }>();
  if (!row) throw new AppError("Payment not found.", 404);
  if (row.status === "paid") throw new AppError("A paid payment stays on the ledger. Record a refund instead.", 400);
  if (row.status !== "void") {
    await database().prepare("UPDATE payments SET status = 'void', updated_at = now() WHERE id = ? AND status = 'due'").bind(row.id).run();
    await audit({ actorEmail: input.actorEmail, action: "payment_voided", entity: "payments", subjectId: row.id, ip: input.ip, after: { eventId: input.eventId, amountCents: Number(row.amount_cents) } });
  }
  return { id: row.id };
}

async function stripeRefund(paymentIntent: string, amountCents: number) {
  const key = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key || !paymentIntent.startsWith("pi_")) return "";
  assertStripeTestMode(key);
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ payment_intent: paymentIntent, amount: String(amountCents) }),
  });
  const json = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok) throw new AppError(json.error?.message || "The card refund could not be sent.", 502);
  return json.id && /^re_[A-Za-z0-9_]+$/.test(json.id) ? json.id : "";
}

export async function recordAdjustment(input: {
  eventId: string;
  paymentId?: string | null;
  kind: "refund" | "cancellation";
  amountCents: number;
  note?: string;
  actorEmail: string;
  ip?: string;
}) {
  if (input.kind !== "refund" && input.kind !== "cancellation") throw new AppError("Unknown adjustment.", 400);
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new AppError("Enter an amount.", 400);
  const note = (input.note ?? "").trim().slice(0, 500);
  assertNoCardData(note);
  let providerRef = "";
  if (input.kind === "refund") {
    if (!input.paymentId) throw new AppError("Choose the payment to refund.", 400);
    const payment = await database().prepare("SELECT id, event_id, status, amount_cents, provider_intent FROM payments WHERE id = ?").bind(input.paymentId).first<{
      id: string;
      event_id: string;
      status: string;
      amount_cents: number;
      provider_intent: string;
    }>();
    if (!payment || payment.event_id !== input.eventId) throw new AppError("Payment not found.", 404);
    if (payment.status !== "paid") throw new AppError("Only a succeeded payment can be refunded.", 400);
    const prior = await database().prepare("SELECT COALESCE(SUM(amount_cents), 0)::int AS total FROM payment_adjustments WHERE payment_id = ? AND kind = 'refund'").bind(payment.id).first<{ total: number }>();
    if (Number(prior?.total ?? 0) + input.amountCents > Number(payment.amount_cents)) throw new AppError("That refund is larger than the payment.", 400);
    providerRef = await stripeRefund(payment.provider_intent || "", input.amountCents);
  }
  const id = crypto.randomUUID();
  await database().prepare(
    "INSERT INTO payment_adjustments (id, event_id, payment_id, kind, amount_cents, note, actor_email, provider_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, input.eventId, input.paymentId || null, input.kind, input.amountCents, note, input.actorEmail.slice(0, 200), providerRef).run();
  await audit({
    actorEmail: input.actorEmail,
    action: input.kind === "refund" ? "payment_refunded" : "payment_adjusted",
    entity: "payment_adjustments",
    subjectId: id,
    ip: input.ip,
    after: { eventId: input.eventId, paymentId: input.paymentId ?? null, kind: input.kind, amountCents: input.amountCents },
  });
  return { id, providerRef };
}

type PaymentRow = {
  id: string;
  event_id: string;
  label: string;
  amount_cents: number;
  due_on: string | null;
  status: string;
  method: string;
  provider_ref: string;
  schedule_key?: string;
  kind?: string;
  paid_at?: string | null;
};

function mapPayment(row: PaymentRow) {
  return {
    id: row.id,
    label: row.label,
    amountCents: Number(row.amount_cents),
    dueOn: row.due_on,
    status: row.status,
    method: row.method,
    kind: (row.kind === "deposit" || row.kind === "balance" ? row.kind : "other") as PaymentKind,
    scheduleKey: row.schedule_key || "",
    paidAt: row.paid_at ?? null,
    hasEvidence: Boolean(row.provider_ref),
  };
}

export async function eventLedger(eventId: string) {
  const versions = await database().prepare(
    `SELECT v.id, v.kind, v.number, v.snapshot, v.sent_at, v.accepted_at
     FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id WHERE p.event_id = ?`,
  ).bind(eventId).all<VersionRow>();
  const payments = await database().prepare(
    `SELECT id, event_id, label, amount_cents, due_on::text AS due_on, status, method, provider_ref,
            schedule_key, kind, paid_at::text AS paid_at
     FROM payments WHERE event_id = ? ORDER BY created_at`,
  ).bind(eventId).all<PaymentRow>();
  const adjustments = await database().prepare("SELECT kind, amount_cents FROM payment_adjustments WHERE event_id = ?").bind(eventId).all<{ kind: string; amount_cents: number }>();
  const proposal = await proposalFor(eventId);
  const pending = versions.results.find((version) => version.sent_at && !version.accepted_at) ?? null;
  const invoiceTotalCents = invoiceFromVersions(versions.results);
  const paidCents = payments.results.filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const dueCents = payments.results.filter((row) => row.status === "due").reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const deposit = payments.results.find((row) => row.kind === "deposit" && row.status !== "void") ?? null;
  const adjustmentRows = adjustments.results.map((row) => ({ kind: row.kind, amountCents: Number(row.amount_cents) }));
  const balanceCents = outstandingCents({ invoiceTotalCents, succeededPaymentCents: paidCents, adjustments: adjustmentRows });
  const hasLedger = versions.results.some((version) => version.sent_at) || payments.results.length > 0 || adjustmentRows.length > 0;
  return {
    source: MONEY_SOURCE,
    detail: MONEY_SOURCE_DETAIL,
    hasLedger,
    invoiceTotalCents,
    /** Money actually received (status = paid). */
    paidCents,
    /** Money still owed on open schedule rows (status = due). Separate from balance. */
    dueCents,
    balanceCents,
    invoiceStatus: invoiceStatus(invoiceTotalCents, paidCents, balanceCents),
    deposit: deposit
      ? { id: deposit.id, status: deposit.status, amountCents: Number(deposit.amount_cents), dueOn: deposit.due_on, label: deposit.label }
      : null,
    payments: payments.results.map(mapPayment),
    proposal: proposal ? { id: proposal.id, status: proposal.status, title: proposal.title } : null,
    pendingVersion: pending ? { id: pending.id, kind: pending.kind } : null,
  };
}

export async function ledgerForEvents(eventIds: string[]) {
  const map = new Map<string, {
    dueCents: number | null;
    paidCents: number | null;
    balanceCents: number | null;
    invoiceCents: number | null;
    adjustmentCents: number;
  }>();
  if (!eventIds.length) return map;
  const versions = await database().prepare(
    `SELECT p.event_id, v.kind, v.number, v.snapshot, v.sent_at, v.accepted_at
     FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id`,
  ).all<VersionRow & { event_id: string }>();
  const payments = await database().prepare("SELECT event_id, status, amount_cents FROM payments").all<{ event_id: string; status: string; amount_cents: number }>();
  const adjustments = await database().prepare("SELECT event_id, kind, amount_cents FROM payment_adjustments").all<{ event_id: string; kind: string; amount_cents: number }>();
  const wanted = new Set(eventIds);
  for (const id of eventIds) map.set(id, { dueCents: null, paidCents: null, balanceCents: null, invoiceCents: null, adjustmentCents: 0 });
  const grouped = new Map<string, VersionRow[]>();
  for (const row of versions.results) {
    if (!wanted.has(row.event_id)) continue;
    const list = grouped.get(row.event_id) ?? [];
    list.push(row);
    grouped.set(row.event_id, list);
  }
  for (const id of eventIds) {
    const eventPayments = payments.results.filter((row) => row.event_id === id);
    const eventAdjustments = adjustments.results.filter((row) => row.event_id === id);
    const eventVersions = grouped.get(id) ?? [];
    if (!eventVersions.some((version) => version.sent_at) && !eventPayments.length && !eventAdjustments.length) continue;
    const invoiceTotalCents = invoiceFromVersions(eventVersions);
    const paidCents = eventPayments.filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.amount_cents), 0);
    const dueCents = eventPayments.filter((row) => row.status === "due").reduce((sum, row) => sum + Number(row.amount_cents), 0);
    const adjustmentCents = eventAdjustments.reduce((sum, row) => sum + Number(row.amount_cents), 0);
    const balanceCents = outstandingCents({
      invoiceTotalCents,
      succeededPaymentCents: paidCents,
      adjustments: eventAdjustments.map((row) => ({ kind: row.kind, amountCents: Number(row.amount_cents) })),
    });
    map.set(id, { dueCents, paidCents, balanceCents, invoiceCents: invoiceTotalCents, adjustmentCents });
  }
  return map;
}

export async function ensureCheckoutPayment(input: { eventId: string; paymentId: string; label: string; amountCents: number; dueOn?: string | null }) {
  const byId = uuidPattern.test(input.paymentId)
    ? await database().prepare("SELECT id, event_id, label, amount_cents, status, provider_ref FROM payments WHERE id = ?").bind(input.paymentId).first<PaymentRow>()
    : null;
  const existing = byId ?? await database().prepare("SELECT id, event_id, label, amount_cents, status, provider_ref FROM payments WHERE event_id = ? AND schedule_key = ?").bind(input.eventId, input.paymentId).first<PaymentRow>();
  if (existing) {
    if (existing.event_id !== input.eventId || existing.status !== "due" || Number(existing.amount_cents) <= 0) throw new AppError("That payment is not due.", 404);
    return { id: existing.id, label: existing.label, amountCents: Number(existing.amount_cents) };
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new AppError("That payment is not due.", 404);
  const booking = await database().prepare("SELECT id FROM bookings WHERE event_id = ?").bind(input.eventId).first<{ id: string }>();
  const id = crypto.randomUUID();
  const due = input.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;
  const label = input.label.trim().slice(0, 120) || "Payment";
  await database().prepare(
    "INSERT INTO payments (id, event_id, booking_id, label, amount_cents, due_on, status, method, provider_ref, schedule_key) VALUES (?, ?, ?, ?, ?, ?, 'due', '', '', ?)",
  ).bind(id, input.eventId, booking?.id ?? null, label, input.amountCents, due, input.paymentId.slice(0, 80)).run();
  return { id, label, amountCents: input.amountCents };
}

const signatureWindowMs = 5 * 60 * 1000;

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowMs = Date.now()) {
  if (!header || !secret) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  if (!/^\d+$/.test(timestamp) || !signatures.length) return false;
  if (Math.abs(nowMs - Number(timestamp) * 1000) > signatureWindowMs) return false;
  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  return signatures.some((signature) => safeEqual(signature, expected));
}

type CheckoutSession = {
  id?: string;
  payment_status?: string;
  amount_total?: number;
  payment_intent?: unknown;
  metadata?: { payment_id?: string; event_id?: string };
};

async function rememberStripeEvent(id: string, type: string) {
  const inserted = await database().prepare("INSERT INTO stripe_events (id, type) VALUES (?, ?) ON CONFLICT (id) DO NOTHING").bind(id, type).run();
  return inserted.meta.changes > 0;
}

async function writeReceipt(paymentId: string, eventId: string, providerRef: string, amountCents: number) {
  const customer = await database().prepare(
    `SELECT c.email, c.name FROM events e LEFT JOIN customers c ON c.id = e.customer_id WHERE e.id = ?`,
  ).bind(eventId).first<{ email: string | null; name: string | null }>();
  let emailed = false;
  if (customer?.email?.includes("@")) {
    const { notifyPaymentReceipt } = await import("@/lib/communications");
    const result = await notifyPaymentReceipt({
      eventId,
      email: customer.email,
      amountCents,
      paymentId,
      origin: process.env.MB_PUBLIC_ORIGIN ?? "",
    });
    emailed = result.emailed;
  }
  await database().prepare(
    "INSERT INTO receipts (id, payment_id, event_id, provider_ref, amount_cents, emailed) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (payment_id, provider_ref) DO NOTHING",
  ).bind(crypto.randomUUID(), paymentId, eventId, providerRef, amountCents, emailed).run();
}

async function recordPaidCheckout(session: CheckoutSession) {
  const sessionId = session.id ?? "";
  // TEST MODE only — reject live Checkout sessions.
  if (sessionId.startsWith("cs_live_")) {
    await audit({ actorEmail: "stripe-webhook", action: "payment_live_session_rejected", entity: "payments", subjectId: sessionId, after: { sessionId } });
    return;
  }
  if (!/^cs_(test_)?[A-Za-z0-9_]+$/.test(sessionId)) return;
  if (session.payment_status !== "paid") return;
  const eventId = session.metadata?.event_id ?? "";
  if (!uuidPattern.test(eventId)) return;
  const event = await database().prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first<{ id: string }>();
  if (!event) return;
  if (!Number.isInteger(session.amount_total) || (session.amount_total as number) < 0) return;
  const amount = session.amount_total as number;
  const intent = typeof session.payment_intent === "string" && /^pi_[A-Za-z0-9_]+$/.test(session.payment_intent) ? session.payment_intent : "";
  const paymentId = session.metadata?.payment_id ?? "";
  const already = await database().prepare("SELECT id FROM payments WHERE provider_ref = ?").bind(sessionId).first<{ id: string }>();
  if (already) return;

  let existing = uuidPattern.test(paymentId)
    ? await database().prepare("SELECT id, event_id, status, amount_cents, provider_ref FROM payments WHERE id = ?").bind(paymentId).first<PaymentRow>()
    : null;
  if (!existing || existing.event_id !== eventId) {
    // Prefer the matching due row (deposit or otherwise) instead of inventing a parallel paid row.
    existing = await database().prepare(
      `SELECT id, event_id, status, amount_cents, provider_ref FROM payments
       WHERE event_id = ? AND status = 'due' AND amount_cents = ?
       ORDER BY CASE kind WHEN 'deposit' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`,
    ).bind(eventId, amount).first<PaymentRow>();
  }

  let paidId = "";
  if (existing) {
    if (existing.provider_ref === sessionId) return;
    if (existing.status === "paid") return;
    if (existing.status !== "due" || Number(existing.amount_cents) !== amount) {
      await audit({ actorEmail: "stripe-webhook", action: "payment_amount_mismatch", entity: "payments", subjectId: existing.id, after: { eventId, expectedCents: Number(existing.amount_cents), sessionCents: amount } });
      return;
    }
    await database().prepare(
      "UPDATE payments SET status = 'paid', method = 'card', provider_ref = ?, provider_intent = ?, paid_at = now(), updated_at = now() WHERE id = ? AND status = 'due' AND provider_ref = '' AND amount_cents = ?",
    ).bind(sessionId, intent, existing.id, amount).run();
    paidId = existing.id;
  } else {
    const dueCount = await database().prepare(
      "SELECT count(*)::int AS n FROM payments WHERE event_id = ? AND status = 'due'",
    ).bind(eventId).first<{ n: number }>();
    if (Number(dueCount?.n ?? 0) > 0) {
      await audit({
        actorEmail: "stripe-webhook",
        action: "payment_unmatched_rejected",
        entity: "payments",
        subjectId: eventId,
        after: { eventId, sessionCents: amount, reason: "due_rows_exist_without_amount_match" },
      });
      return;
    }
    const booking = await database().prepare("SELECT id FROM bookings WHERE event_id = ?").bind(eventId).first<{ id: string }>();
    paidId = uuidPattern.test(paymentId) ? paymentId : crypto.randomUUID();
    try {
      await database().prepare(
        "INSERT INTO payments (id, event_id, booking_id, label, amount_cents, status, method, provider_ref, provider_intent, paid_at, kind) VALUES (?, ?, ?, 'Payment', ?, 'paid', 'card', ?, ?, now(), 'other')",
      ).bind(paidId, eventId, booking?.id ?? null, amount, sessionId, intent).run();
    } catch (error) {
      if (errorText(error).includes("provider_ref") || errorText(error).includes("payments_pkey")) return;
      throw error;
    }
  }
  await writeReceipt(paidId, eventId, sessionId, amount);
  await audit({ actorEmail: "stripe-webhook", action: "payment_recorded", entity: "payments", subjectId: paidId, after: { eventId, amountCents: amount, providerRef: sessionId, status: "paid" } });
}

export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  try {
    assertStripeTestMode();
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
  const secret = (env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return { status: 503, body: { error: "Stripe webhooks are not configured." } };
  if (!signature) return { status: 400, body: { error: "Missing Stripe signature." } };
  if (!(await verifyStripeSignature(rawBody, signature, secret))) return { status: 400, body: { error: "Invalid Stripe signature." } };
  let event: { id?: string; type?: string; data?: { object?: CheckoutSession } };
  try {
    event = JSON.parse(rawBody) as { id?: string; type?: string; data?: { object?: CheckoutSession } };
  } catch {
    return { status: 400, body: { error: "Invalid webhook." } };
  }
  if (!event.id || !event.type) return { status: 400, body: { error: "Invalid webhook." } };
  const seen = await database().prepare("SELECT id FROM stripe_events WHERE id = ?").bind(event.id).first();
  if (seen) return { status: 200, body: { received: true } };
  const session = event.data?.object;
  if (event.type === "checkout.session.completed" && session?.payment_status === "paid") await recordPaidCheckout(session);
  await rememberStripeEvent(event.id, event.type);
  return { status: 200, body: { received: true } };
}

type PlannerJsonPayment = {
  id?: string;
  label?: string;
  amount?: number;
  due?: string;
  status?: string;
  paidAt?: string;
  method?: string;
  ref?: string;
};

export type ReconcileReport = {
  eventId: string;
  plannerPaymentCount: number;
  ledgerPaymentCount: number;
  proposed: {
    action: "insert_due" | "insert_paid_offline";
    plannerId: string;
    label: string;
    amountCents: number;
    dueOn: string | null;
    kind: PaymentKind;
    evidenceRef: string;
  }[];
  skipped: { plannerId: string; reason: string }[];
  note: string;
};

function plannerKind(label: string): PaymentKind {
  return /deposit/i.test(label) ? "deposit" : /final|balance/i.test(label) ? "balance" : "other";
}

/** Dry-run only. Does not move money. Approval + apply is a separate call. */
export async function dryRunPlannerReconcile(input: { eventId: string; actorEmail: string; ip?: string }) {
  const planner = await database().prepare("SELECT admin_data FROM planner_events WHERE event_id = ? OR id = ? LIMIT 1")
    .bind(input.eventId, input.eventId).first<{ admin_data: unknown }>();
  if (!planner) throw new AppError("Planner not found for this event.", 404);
  const admin = asJson<{ payments?: PlannerJsonPayment[] }>(planner.admin_data || {});
  const jsonPayments = Array.isArray(admin.payments) ? admin.payments : [];
  const ledger = await eventLedger(input.eventId);
  const proposed: ReconcileReport["proposed"] = [];
  const skipped: ReconcileReport["skipped"] = [];
  for (const payment of jsonPayments) {
    const plannerId = String(payment.id || "").slice(0, 80) || crypto.randomUUID();
    const label = String(payment.label || "Payment").trim().slice(0, 120) || "Payment";
    const amountCents = Math.round(Number(payment.amount || 0) * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      skipped.push({ plannerId, reason: "missing_or_invalid_amount" });
      continue;
    }
    try {
      assertNoCardData(label);
      assertNoCardData(String(payment.method || ""));
      assertNoCardData(String(payment.ref || ""));
    } catch {
      skipped.push({ plannerId, reason: "card_like_text_rejected" });
      continue;
    }
    const kind = plannerKind(label);
    const match = ledger.payments.find((row) =>
      row.amountCents === amountCents && row.label === label && (row.status === payment.status || (payment.status === "paid" && row.status === "paid")),
    ) || ledger.payments.find((row) => row.scheduleKey === `planner:${plannerId}`);
    if (match) {
      skipped.push({ plannerId, reason: "already_on_ledger" });
      continue;
    }
    if (kind === "deposit" && ledger.deposit) {
      skipped.push({ plannerId, reason: "event_already_has_deposit" });
      continue;
    }
    const dueOn = payment.due && /^\d{4}-\d{2}-\d{2}$/.test(payment.due) ? payment.due : null;
    if (payment.status === "paid") {
      const evidence = String(payment.ref || payment.method || "").trim();
      if (!evidence) {
        skipped.push({ plannerId, reason: "paid_json_needs_evidence_ref_before_migrate" });
        continue;
      }
      proposed.push({
        action: "insert_paid_offline",
        plannerId,
        label,
        amountCents,
        dueOn,
        kind: kind === "deposit" ? "deposit" : kind,
        evidenceRef: evidence.slice(0, 120),
      });
    } else {
      proposed.push({
        action: "insert_due",
        plannerId,
        label,
        amountCents,
        dueOn,
        kind: kind === "deposit" ? "deposit" : kind === "balance" ? "balance" : "other",
        evidenceRef: "",
      });
    }
  }
  const report: ReconcileReport = {
    eventId: input.eventId,
    plannerPaymentCount: jsonPayments.length,
    ledgerPaymentCount: ledger.payments.length,
    proposed,
    skipped,
    note: "Dry-run only. No financial records were moved. Review this report, then apply with explicit approval.",
  };
  const id = crypto.randomUUID();
  await database().prepare(
    "INSERT INTO finance_reconcile_runs (id, event_id, report, dry_run, actor_email) VALUES (?, ?, ?::jsonb, true, ?)",
  ).bind(id, input.eventId, JSON.stringify(report), input.actorEmail).run();
  await audit({
    actorEmail: input.actorEmail,
    action: "finance_reconcile_dry_run",
    entity: "finance_reconcile_runs",
    subjectId: id,
    ip: input.ip,
    after: { eventId: input.eventId, proposed: proposed.length, skipped: skipped.length },
  });
  return { runId: id, report };
}

/** Moves planner JSON payment rows onto the ledger only after an approved dry-run. */
export async function applyPlannerReconcile(input: {
  runId: string;
  approve: true;
  actorEmail: string;
  ip?: string;
}) {
  if (input.approve !== true) throw new AppError("Set approve to true after reviewing the dry-run report.", 400);
  const run = await database().prepare(
    "SELECT id, event_id, report, approved_at, applied_at FROM finance_reconcile_runs WHERE id = ?",
  ).bind(input.runId).first<{ id: string; event_id: string; report: unknown; approved_at: string | null; applied_at: string | null }>();
  if (!run) throw new AppError("Reconcile run not found.", 404);
  if (run.applied_at) return { runId: run.id, already: true as const, applied: 0 };
  const report = asJson<ReconcileReport>(run.report);
  await database().prepare(
    "UPDATE finance_reconcile_runs SET approved_at = COALESCE(approved_at, now()), approved_by = ? WHERE id = ?",
  ).bind(input.actorEmail, run.id).run();

  const booking = await database().prepare("SELECT id FROM bookings WHERE event_id = ?").bind(run.event_id).first<{ id: string }>();
  let applied = 0;
  for (const item of report.proposed) {
    const scheduleKey = `planner:${item.plannerId}`.slice(0, 80);
    const existing = await database().prepare(
      "SELECT id FROM payments WHERE event_id = ? AND schedule_key = ?",
    ).bind(run.event_id, scheduleKey).first<{ id: string }>();
    if (existing) continue;
    if (item.kind === "deposit") {
      const deposit = await database().prepare(
        "SELECT id FROM payments WHERE event_id = ? AND kind = 'deposit' AND status IN ('due', 'paid') LIMIT 1",
      ).bind(run.event_id).first<{ id: string }>();
      if (deposit) continue;
    }
    const id = crypto.randomUUID();
    if (item.action === "insert_due") {
      await database().prepare(
        `INSERT INTO payments (id, event_id, booking_id, label, amount_cents, due_on, status, method, provider_ref, schedule_key, kind)
         VALUES (?, ?, ?, ?, ?, ?, 'due', '', '', ?, ?)`,
      ).bind(id, run.event_id, booking?.id ?? null, item.label, item.amountCents, item.dueOn, scheduleKey, item.kind).run();
      applied += 1;
    } else {
      const providerRef = `offline:${item.evidenceRef}`.slice(0, 160);
      await database().prepare(
        `INSERT INTO payments (id, event_id, booking_id, label, amount_cents, due_on, status, method, provider_ref, schedule_key, kind, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, 'paid', 'offline', ?, ?, ?, now())`,
      ).bind(id, run.event_id, booking?.id ?? null, item.label, item.amountCents, item.dueOn, providerRef, scheduleKey, item.kind).run();
      await writeReceipt(id, run.event_id, providerRef, item.amountCents);
      applied += 1;
    }
  }
  await database().prepare("UPDATE finance_reconcile_runs SET applied_at = now(), dry_run = false WHERE id = ?").bind(run.id).run();
  await audit({
    actorEmail: input.actorEmail,
    action: "finance_reconcile_applied",
    entity: "finance_reconcile_runs",
    subjectId: run.id,
    ip: input.ip,
    after: { eventId: run.event_id, applied },
  });
  return { runId: run.id, already: false as const, applied };
}
