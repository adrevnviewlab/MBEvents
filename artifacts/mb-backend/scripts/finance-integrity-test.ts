process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@integrity.test";
delete process.env.STRIPE_SECRET_KEY;
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_integrity_phase5";

const { createHmac } = await import("node:crypto");
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
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const {
  acceptProposal,
  applyPlannerReconcile,
  assertStripeTestMode,
  approveCatalogPrice,
  dryRunPlannerReconcile,
  eventLedger,
  handleStripeWebhook,
  publishCatalogPrice,
  recordAdjustment,
  recordOfflinePayment,
  savePackage,
  savePricingRule,
  sendQuote,
} = await import("../lib/finance.ts");
const { cancelBooking } = await import("../lib/calendar.ts");
const { clientMoney } = await import("../lib/planner-server.ts");
const { buildBusinessReport } = await import("../lib/analytics.ts");
const { newAdminData } = await import("../lib/planner.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const actor = "owner@integrity.test";

await saveBusinessSettings({ companyName: "MB Events", timezone: "America/New_York", depositDueDays: 7, actorEmail: actor });

check("live stripe key is refused", (() => {
  try {
    assertStripeTestMode("sk_live_forbidden");
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes("TEST MODE");
  }
})());
check("non-test stripe key is refused", (() => {
  try {
    assertStripeTestMode("rk_test_wrong_prefix");
    return false;
  } catch (error) {
    return error instanceof Error && /TEST MODE|sk_test_/.test(error.message);
  }
})());
assertStripeTestMode("sk_test_ok");
check("test stripe key is accepted", true);

const customerId = await ensureCustomer({ name: "Ivy Client", email: "ivy-integrity@example.com", phone: "5550303" });
const eventId = crypto.randomUUID();
await createEventRecord({
  id: eventId,
  customerId,
  name: "Ivy Wedding",
  eventType: "Wedding",
  eventDate: "2036-09-12",
  startTime: "4:00 PM",
  endTime: "11:00 PM",
});

const pkg = await savePackage({ name: "Integrity", priceCents: 25000, actorEmail: actor });
await approveCatalogPrice({ kind: "package", id: pkg.id, actorEmail: actor });
await publishCatalogPrice({ kind: "package", id: pkg.id, actorEmail: actor });
await savePricingRule({ kind: "deposit", label: "Integrity deposit", amountCents: 7500, percent: null, active: true, actorEmail: actor });
await sendQuote({ eventId, packageId: pkg.id, actorEmail: actor });
const accepted = await acceptProposal({ eventId, acceptedBy: "Ivy Client", actorEmail: "ivy-integrity@example.com" });
const again = await acceptProposal({ eventId, acceptedBy: "Ivy Client", actorEmail: "ivy-integrity@example.com" });
const deposits = await db.prepare("SELECT id, kind, status, amount_cents, schedule_key FROM payments WHERE event_id = ?").bind(eventId).all<{ id: string; kind: string; status: string; amount_cents: number; schedule_key: string }>();
check("deposit created from accepted quote", deposits.results.length === 1 && deposits.results[0]?.kind === "deposit" && deposits.results[0]?.status === "due" && Number(deposits.results[0]?.amount_cents) === 7500, JSON.stringify(deposits.results));
check("no duplicate deposit", again.already === true && again.depositPaymentId === accepted.depositPaymentId && deposits.results.length === 1);

const ledger = await eventLedger(eventId);
check("correct customer balance before payment", ledger.invoiceTotalCents === 25000 && ledger.paidCents === 0 && ledger.dueCents === 7500 && ledger.balanceCents === 25000, JSON.stringify({ paid: ledger.paidCents, due: ledger.dueCents, balance: ledger.balanceCents }));

await db.prepare(
  "INSERT INTO planner_events (id, code, password_hash, guest_code, guest_password, event_id, data, admin_data) VALUES (?, 'MB-INT01', 'x', 'G-INT01', 'y', ?, '{}', ?)",
).bind(eventId, eventId, JSON.stringify({
  ...newAdminData(),
  payments: [{ id: "json-legacy", label: "Travel fee", amount: 50, due: "2036-01-01", status: "paid", paidAt: "2036-01-02", method: "check", ref: "CHK-100" }],
  lineItems: [{ id: "l1", description: "Legacy", qty: 1, price: 250 }],
})).run();

const adminMoney = await clientMoney(eventId, newAdminData());
check("admin and planner show identical ledger balance", adminMoney.source === "ledger" && Math.round(adminMoney.balance * 100) === ledger.balanceCents && Math.round(adminMoney.paid * 100) === ledger.paidCents, JSON.stringify(adminMoney));

const report = await buildBusinessReport(db);
check("reports use real ledger data", report.moneySource.relationalEvents >= 1 && report.depositsCents === 0, JSON.stringify(report.moneySource));

const beforeReconcileCount = (await db.prepare("SELECT count(*)::int AS n FROM payments WHERE event_id = ?").bind(eventId).first<{ n: number }>())?.n ?? 0;
const dry = await dryRunPlannerReconcile({ eventId, actorEmail: actor });
check("dry-run reconcile does not move records", dry.report.proposed.length >= 1 && (await db.prepare("SELECT count(*)::int AS n FROM payments WHERE event_id = ?").bind(eventId).first<{ n: number }>())?.n === beforeReconcileCount, JSON.stringify(dry.report));
const applied = await applyPlannerReconcile({ runId: dry.runId, approve: true, actorEmail: actor });
check("approved reconcile moves planner rows with evidence", applied.applied >= 1, JSON.stringify(applied));
const afterReconcile = await eventLedger(eventId);
check("reconcile preserves deposit and adds evidenced offline row", afterReconcile.payments.some((p) => p.kind === "deposit") && afterReconcile.payments.some((p) => p.hasEvidence && p.status === "paid" && p.label === "Travel fee"), JSON.stringify(afterReconcile.payments));

const depositId = deposits.results[0]!.id;
const noEvidence = await throws(() => recordOfflinePayment({ eventId, paymentId: depositId, method: "check", evidenceRef: "", actorEmail: actor }), "evidence");
check("offline payment requires evidence", noEvidence.includes("evidence"), noEvidence);
const cardLike = await throws(() => recordOfflinePayment({ eventId, paymentId: depositId, method: "card", evidenceRef: "4111111111111111", actorEmail: actor }), "Card");
check("offline payment rejects card numbers", cardLike.includes("Card"), cardLike);
await recordOfflinePayment({ eventId, paymentId: depositId, method: "check", evidenceRef: "CHK-7788", note: "front desk", actorEmail: actor });
const offline = await db.prepare("SELECT status, method, provider_ref, kind FROM payments WHERE id = ?").bind(depositId).first<{ status: string; method: string; provider_ref: string; kind: string }>();
check("offline payment marks due as paid with evidence", offline?.status === "paid" && offline.method === "check" && offline.provider_ref.startsWith("offline:") && offline.kind === "deposit", JSON.stringify(offline));
const offlineAgain = await recordOfflinePayment({ eventId, paymentId: depositId, method: "check", evidenceRef: "CHK-7788", actorEmail: actor });
check("offline payment is idempotent", offlineAgain.already === true);

const failedPayload = JSON.stringify({
  id: "evt_integrity_fail",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_fail", payment_status: "unpaid", amount_total: 1000, metadata: { event_id: eventId, payment_id: crypto.randomUUID() } } },
});
const ts = Math.floor(Date.now() / 1000);
const sig = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET ?? "").update(`${ts}.${failedPayload}`).digest("hex");
await handleStripeWebhook(failedPayload, `t=${ts},v1=${sig}`);
check("failed stripe test payment does not mark paid rows", (await db.prepare("SELECT count(*)::int AS n FROM payments WHERE event_id = ? AND provider_ref = 'cs_test_fail'").bind(eventId).first<{ n: number }>())?.n === 0);

// Schedule a balance due for a successful stripe test payment
const balanceId = crypto.randomUUID();
await db.prepare(
  "INSERT INTO payments (id, event_id, label, amount_cents, status, kind, schedule_key) VALUES (?, ?, 'Balance', 5000, 'due', 'balance', 'balance-1')",
).bind(balanceId, eventId).run();
const paidPayload = JSON.stringify({
  id: "evt_integrity_ok",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_ok",
      payment_status: "paid",
      amount_total: 5000,
      payment_intent: "pi_test_ok",
      metadata: { event_id: eventId, payment_id: balanceId },
    },
  },
});
const ts2 = Math.floor(Date.now() / 1000);
const sig2 = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET ?? "").update(`${ts2}.${paidPayload}`).digest("hex");
const first = await handleStripeWebhook(paidPayload, `t=${ts2},v1=${sig2}`);
const second = await handleStripeWebhook(paidPayload, `t=${ts2},v1=${sig2}`);
const paidRow = await db.prepare("SELECT status, provider_ref FROM payments WHERE id = ?").bind(balanceId).first<{ status: string; provider_ref: string }>();
check("successful stripe test payment marks the due row paid", first.status === 200 && paidRow?.status === "paid" && paidRow.provider_ref === "cs_test_ok", JSON.stringify(paidRow));
check("duplicate webhook stays one paid row", second.status === 200 && (await db.prepare("SELECT count(*)::int AS n FROM payments WHERE provider_ref = 'cs_test_ok'").first<{ n: number }>())?.n === 1);

await recordAdjustment({ eventId, paymentId: balanceId, kind: "refund", amountCents: 1000, note: "partial", actorEmail: actor });
const afterRefund = await eventLedger(eventId);
const refundAdjust = await db.prepare("SELECT COALESCE(SUM(amount_cents),0)::int AS n FROM payment_adjustments WHERE event_id = ? AND kind = 'refund'").bind(eventId).first<{ n: number }>();
check("refund adjustment increases outstanding balance", afterRefund.balanceCents === afterRefund.invoiceTotalCents - afterRefund.paidCents + Number(refundAdjust?.n ?? 0), String(afterRefund.balanceCents));

await cancelBooking(eventId, { email: actor, userId: null }, "canceled after payments");
const afterCancel = await eventLedger(eventId);
const history = await db.prepare("SELECT count(*)::int AS n FROM booking_history WHERE event_id = ? AND action = 'cancel'").bind(eventId).first<{ n: number }>();
check("cancellation retains financial history", afterCancel.payments.length >= 2 && afterCancel.paidCents > 0 && Number(history?.n) >= 1, JSON.stringify({ payments: afterCancel.payments.length, paid: afterCancel.paidCents, history: history?.n }));

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
