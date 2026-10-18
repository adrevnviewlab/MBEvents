import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_URL = "pglite:memory";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_finance_phase4";
process.env.MB_FILE_STORAGE = "local";
const fileDir = await mkdtemp(join(tmpdir(), "mb-finance-"));
process.env.MB_FILE_DIR = fileDir;

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

async function throws(run: () => Promise<unknown>) {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
}

function stripeHeader(payload: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const {
  acceptProposal,
  eventLedger,
  handleStripeWebhook,
  listPricingRules,
  quoteTotals,
  recordAdjustment,
  approveCatalogPrice,
  publishCatalogPrice,
  savePackage,
  savePricingRule,
  saveService,
  sendChangeOrder,
  sendQuote,
  upsertSignedContract,
} = await import("../lib/finance.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const actor = "finance-test@example.com";

async function publishPackage(id: string) {
  await approveCatalogPrice({ kind: "package", id, actorEmail: actor });
  await publishCatalogPrice({ kind: "package", id, actorEmail: actor });
}

async function publishService(id: string) {
  await approveCatalogPrice({ kind: "service", id, actorEmail: actor });
  await publishCatalogPrice({ kind: "service", id, actorEmail: actor });
}

async function count(table: string, where = "", arg?: string) {
  const row = await db!.prepare(`SELECT COUNT(*)::int AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`).bind(...(arg ? [arg] : [])).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

check("no seeded packages", (await count("packages")) === 0);
check("no seeded services", (await count("services")) === 0);
check("no seeded pricing rules", (await count("pricing_rules")) === 0);

const bare = quoteTotals({ lines: [{ quantity: 1, unitAmountCents: null }, { quantity: 1, unitAmountCents: 10000 }], rules: [] });
check("missing price is not a zero line", bare.pricedCount === 1 && bare.invoiceTotalCents === 10000 && bare.charges.length === 0 && bare.deposit === null);
const overtimeAbsent = quoteTotals({
  lines: [{ quantity: 1, unitAmountCents: 10000 }],
  rules: [],
  durationMinutes: 420,
});
check("no overtime rule means no overtime", overtimeAbsent.charges.length === 0);

const leadId = crypto.randomUUID();
await db.prepare("INSERT INTO leads (id, source, name, email, phone, event_type, event_date) VALUES (?, 'contact', 'Casey Client', 'casey-finance@example.com', '5551234567', 'Wedding', '2031-06-14')").bind(leadId).run();
const customerId = await ensureCustomer({ name: "Casey Client", email: "casey-finance@example.com", phone: "5551234567" });
const eventId = crypto.randomUUID();
await createEventRecord({ id: eventId, customerId, leadId, name: "Casey Wedding", eventType: "Wedding", eventDate: "2031-06-14", startTime: "4:00 PM", endTime: "11:00 PM", guestCount: "120" });
const bookingBefore = await db.prepare("SELECT status FROM bookings WHERE event_id = ?").bind(eventId).all<{ status: string }>();
check("explicit booking path creates one unconfirmed booking", bookingBefore.results.length === 1 && (bookingBefore.results[0]?.status === "pending" || bookingBefore.results[0]?.status === "tentative"), bookingBefore.results.map((row) => row.status).join(","));

const unpriced = await savePackage({ name: "Evening", priceCents: null, actorEmail: actor });
check("package without a price is not sent as $0", await throws(() => sendQuote({ eventId, packageId: unpriced.id, actorEmail: actor })));
check("rejected quote writes no items", (await count("proposal_items")) === 0);

await db.prepare("UPDATE packages SET price_cents = 18000 WHERE id = ?").bind(unpriced.id).run();
check("unpublished package is not quoted", await throws(() => sendQuote({ eventId, packageId: unpriced.id, actorEmail: actor })));
await publishPackage(unpriced.id);
const sent = await sendQuote({ eventId, packageId: unpriced.id, actorEmail: actor });
await db.prepare("UPDATE packages SET price_cents = 99900 WHERE id = ?").bind(unpriced.id).run();
const item = await db.prepare("SELECT unit_amount_cents FROM proposal_items WHERE proposal_id = ?").bind(sent.proposalId).first<{ unit_amount_cents: number }>();
const version = await db.prepare("SELECT snapshot FROM proposal_versions WHERE id = ?").bind(sent.versionId).first<{ snapshot: unknown }>();
const snapshot = typeof version?.snapshot === "string" ? JSON.parse(version.snapshot) : version?.snapshot;
check("quote snapshots the package price", Number(item?.unit_amount_cents) === 18000 && snapshot?.invoiceTotalCents === 18000 && snapshot?.lines?.[0]?.unitAmountCents === 18000, JSON.stringify({ item, snapshot }));

check("change order before acceptance is refused", await throws(() => sendChangeOrder({ eventId, description: "Lighting", quantity: 1, unitAmountCents: 4000, actorEmail: actor })));
check("missing deposit rule blocks acceptance", await throws(() => acceptProposal({ eventId, acceptedBy: "Casey Client", actorEmail: actor })));
check("blocked acceptance creates no payment", (await count("payments", "event_id = ?", eventId)) === 0);
const stillSent = await db.prepare("SELECT status FROM proposals WHERE event_id = ?").bind(eventId).first<{ status: string }>();
check("blocked acceptance leaves proposal unaccepted", stillSent?.status === "sent", stillSent?.status);

await savePricingRule({ kind: "deposit", label: "Event deposit", amountCents: null, percent: 20, active: true, actorEmail: actor });
await db.prepare("UPDATE packages SET price_cents = 18000 WHERE id = ?").bind(unpriced.id).run();
const withRule = await sendQuote({ eventId, packageId: unpriced.id, actorEmail: actor });
check("sent quote freezes the deposit suggestion", withRule.deposit?.amountCents === 3600, JSON.stringify(withRule.deposit));
const accepted = await acceptProposal({ eventId, acceptedBy: "Casey Client", actorEmail: actor });
const depositRows = await db.prepare("SELECT id, status, amount_cents, schedule_key FROM payments WHERE event_id = ?").bind(eventId).all<{ id: string; status: string; amount_cents: number; schedule_key: string }>();
check("acceptance creates one deposit due", depositRows.results.length === 1 && depositRows.results[0]?.status === "due" && Number(depositRows.results[0]?.amount_cents) === 3600 && !!accepted.depositPaymentId, JSON.stringify(depositRows.results));
const bookingAfterAccept = await db.prepare("SELECT status FROM bookings WHERE event_id = ?").bind(eventId).first<{ status: string }>();
check("acceptance does not confirm the booking", bookingAfterAccept?.status === "tentative" || bookingAfterAccept?.status === "pending", bookingAfterAccept?.status);
check("acceptance does not add a booking", (await count("bookings", "event_id = ?", eventId)) === 1);
const acceptedAgain = await acceptProposal({ eventId, acceptedBy: "Casey Client", actorEmail: actor });
check("quote accepted twice stays one deposit", acceptedAgain.already === true && (await count("payments", "event_id = ?", eventId)) === 1 && acceptedAgain.depositPaymentId === accepted.depositPaymentId);

const signed = await upsertSignedContract({
  eventId,
  title: "Entertainment Agreement",
  body: "Signed body",
  signedName: "Casey Client",
  signedIp: "127.0.0.1",
  signature: Uint8Array.from([137, 80, 78, 71]),
  actorEmail: actor,
});
const again = await upsertSignedContract({
  eventId,
  title: "Replacement",
  body: "Should not replace a signed contract",
  signedName: "Someone Else",
  signedIp: "10.0.0.8",
  actorEmail: actor,
});
const contracts = await count("contracts", "event_id = ?", eventId);
const contract = await db.prepare("SELECT signed_name, file_id FROM contracts WHERE event_id = ?").bind(eventId).first<{ signed_name: string; file_id: string | null }>();
check("one signed contract", contracts === 1 && signed.id === again.id && contract?.signed_name === "Casey Client" && !!contract.file_id, JSON.stringify(contract));

const lighting = await saveService({ name: "Lighting", priceCents: 4000, actorEmail: actor });
check("unpublished service is not used on a change order", await throws(() => sendChangeOrder({ eventId, serviceId: lighting.id, quantity: 1, unitAmountCents: null, actorEmail: actor })));
await publishService(lighting.id);
const change = await sendChangeOrder({ eventId, serviceId: lighting.id, quantity: 1, unitAmountCents: null, actorEmail: actor });
await acceptProposal({ eventId, versionId: change.versionId, acceptedBy: "Casey Client", actorEmail: actor });
check("change order does not create a second booking", (await count("bookings", "event_id = ?", eventId)) === 1);
check("change order does not create a second event", (await count("events")) === 1);
const ledgerAfterChange = await eventLedger(eventId);
check("change order adds to the same invoice", ledgerAfterChange.invoiceTotalCents === 22000, String(ledgerAfterChange.invoiceTotalCents));

await savePricingRule({ kind: "tax", label: "Sample tax", amountCents: null, percent: 8, active: true, actorEmail: actor });
const taxed = quoteTotals({ lines: [{ quantity: 1, unitAmountCents: 10000 }], rules: await listPricingRules() });
check("stored tax rule applies", taxed.charges.some((charge) => charge.kind === "tax" && charge.amountCents === 800), JSON.stringify(taxed));
const frozen = await db.prepare("SELECT snapshot FROM proposal_versions WHERE id = ?").bind(sent.versionId).first<{ snapshot: unknown }>();
const frozenSnapshot = typeof frozen?.snapshot === "string" ? JSON.parse(frozen.snapshot) : frozen?.snapshot;
check("later rule does not rewrite the sent quote", frozenSnapshot?.invoiceTotalCents === 18000);

const withDeposit = quoteTotals({ lines: [{ quantity: 1, unitAmountCents: 10000 }], rules: await listPricingRules() });
check("deposit amount comes only from a stored rule", withDeposit.deposit?.amountCents === 2160 && withDeposit.invoiceTotalCents === 10800, JSON.stringify(withDeposit));
const overtime = quoteTotals({
  lines: [{ quantity: 1, unitAmountCents: 10000 }],
  durationMinutes: 420,
  rules: [{ kind: "overtime", label: "Overtime", amountCents: 15000, percent: null, active: true, definition: { includedMinutes: 360 } }],
});
check("overtime uses the stored amount", overtime.charges.some((charge) => charge.amountCents === 15000));
const inactive = quoteTotals({
  lines: [{ quantity: 1, unitAmountCents: 10000 }],
  rules: [{ kind: "tax", label: "Off", amountCents: null, percent: 10, active: false }],
});
check("inactive rule is not applied", inactive.charges.length === 0);

const secret = process.env.STRIPE_WEBHOOK_SECRET;
const depositPaymentId = depositRows.results[0]?.id ?? "";
const payload = JSON.stringify({
  id: "evt_finance_once",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_finance_session",
      payment_status: "paid",
      amount_total: 3600,
      payment_intent: "pi_test_finance",
      metadata: { payment_id: depositPaymentId, event_id: eventId },
    },
  },
});
const dueBeforeWebhook = await count("payments", "event_id = ? AND status = 'due'", eventId);
const bad = await handleStripeWebhook(payload, "t=1,v1=deadbeef");
const missing = await handleStripeWebhook(payload, null);
check("bad webhook signature is rejected", bad.status === 400 && missing.status === 400);
check("rejected webhook writes no paid payment", (await count("payments", "event_id = ? AND status = 'paid'", eventId)) === 0 && (await count("payments", "event_id = ? AND status = 'due'", eventId)) === dueBeforeWebhook);

const header = stripeHeader(payload, secret ?? "");
const first = await handleStripeWebhook(payload, header);
const second = await handleStripeWebhook(payload, header);
const paid = await db.prepare("SELECT id, status, amount_cents, provider_ref FROM payments WHERE event_id = ? AND status = 'paid'").bind(eventId).all<{ id: string; status: string; amount_cents: number; provider_ref: string }>();
check("webhook applied", first.status === 200 && second.status === 200);
check("duplicate webhook creates one paid payment", paid.results.length === 1 && Number(paid.results[0]?.amount_cents) === 3600 && paid.results[0]?.provider_ref === "cs_test_finance_session" && paid.results[0]?.id === depositPaymentId, JSON.stringify(paid.results));
check("webhook does not create a booking", (await count("bookings", "event_id = ?", eventId)) === 1 && (await count("events")) === 1);
const bookingAfterPay = await db.prepare("SELECT status FROM bookings WHERE event_id = ?").bind(eventId).first<{ status: string }>();
check("paying a deposit does not confirm the booking", bookingAfterPay?.status === "tentative" || bookingAfterPay?.status === "pending", bookingAfterPay?.status);
const depositKind = await db.prepare("SELECT kind, schedule_key FROM payments WHERE id = ?").bind(depositPaymentId).first<{ kind: string; schedule_key: string }>();
check("deposit has structured kind", depositKind?.kind === "deposit" && depositKind.schedule_key === "deposit", JSON.stringify(depositKind));
const receipt = await db.prepare("SELECT emailed FROM receipts WHERE event_id = ?").bind(eventId).first<{ emailed: boolean }>();
check("receipt is stored and not marked sent without email", receipt?.emailed === false);

const otherEvent = crypto.randomUUID();
const otherCustomer = await ensureCustomer({ name: "Other", email: "", phone: "5550109" });
await createEventRecord({ id: otherEvent, customerId: otherCustomer, name: "Other", eventType: "Birthday", eventDate: "2031-07-01" });
await db.prepare("INSERT INTO payments (id, event_id, label, amount_cents, status, method, provider_ref) VALUES (?, ?, 'Card', 100, 'paid', 'card', 'cs_dup_finance')").bind(crypto.randomUUID(), otherEvent).run();
check("second payment with the same provider ref is rejected", await throws(() => db.prepare("INSERT INTO payments (id, event_id, label, amount_cents, status, method, provider_ref) VALUES (?, ?, 'Card', 100, 'paid', 'card', 'cs_dup_finance')").bind(crypto.randomUUID(), otherEvent).run()));

const originalId = paid.results[0]?.id ?? "";
await recordAdjustment({ eventId, paymentId: originalId, kind: "refund", amountCents: 2500, note: "returned", actorEmail: actor });
await recordAdjustment({ eventId, kind: "cancellation", amountCents: 1000, note: "credit", actorEmail: actor });
const original = await db.prepare("SELECT status, amount_cents FROM payments WHERE id = ?").bind(originalId).first<{ status: string; amount_cents: number }>();
const adjustments = await count("payment_adjustments", "event_id = ?", eventId);
check("refund keeps the original payment", original?.status === "paid" && Number(original.amount_cents) === 3600 && adjustments === 2, JSON.stringify(original));

await db.prepare("INSERT INTO planner_events (id, code, password_hash, guest_code, guest_password, event_id, data, admin_data) VALUES (?, 'MB-FIN01', 'x', 'G-FIN01', 'y', ?, '{}', ?)")
  .bind(eventId, eventId, JSON.stringify({ payments: [{ id: "jsonpay", label: "Old", amount: 999999, status: "paid" }] })).run();
const balance = await eventLedger(eventId);
const expected = 22000 - 3600 + 2500 - 1000;
check("outstanding balance uses the ledger only", balance.source === "ledger" && balance.balanceCents === expected && balance.paidCents === 3600, `${balance.balanceCents} vs ${expected}`);

await rm(fileDir, { recursive: true, force: true });
const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
