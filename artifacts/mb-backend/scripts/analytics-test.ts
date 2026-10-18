process.env.DATABASE_URL = "pglite:memory";

const { getDatabase } = await import("../lib/env.ts");
const { buildBusinessReport, isDepositLabel } = await import("../lib/analytics.ts");
const { createEventRecord, ensureCustomer } = await import("../lib/records.ts");

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

const db = getDatabase();
if (!db) throw new Error("database did not open");

const empty = await buildBusinessReport(db);
check("empty report does not throw", !!empty);
check("empty revenue is zero", empty.revenueCents === 0, String(empty.revenueCents));
check("empty deposits are zero", empty.depositsCents === 0, String(empty.depositsCents));
check("empty average is not zero", empty.averageBookingValueCents === null, String(empty.averageBookingValueCents));
check("empty cost is not recorded", empty.profitability.recorded === false && empty.profitability.label === "cost not recorded");
check("empty report has no profit", !("profitCents" in empty.profitability) && !("margin" in empty.profitability));
check("empty staff is not recorded", empty.staffUtilization.recorded === false);
check("empty equipment is not recorded", empty.equipmentUtilization.recorded === false);
check("empty referrals are not recorded", empty.referrals.recorded === false);
check("empty guest inquiries are not recorded", empty.guestInquiries.recorded === false);
check("empty repeat customers are zero", empty.repeatCustomers === 0, String(empty.repeatCustomers));
check("deposit label is case insensitive", isDepositLabel("Security DEPOSIT") && !isDepositLabel("Final payment") && !isDepositLabel("Retainer"));

const customerA = await ensureCustomer({ name: "Pat", email: "", phone: "5551000" });
const customerB = await ensureCustomer({ name: "Pat", email: "", phone: "5551001" });
const eventId = crypto.randomUUID();
await createEventRecord({ id: eventId, customerId: customerA, name: "Pat Wedding", eventType: "Wedding", eventDate: "2031-06-01" });
const otherEvent = crypto.randomUUID();
await createEventRecord({ id: otherEvent, customerId: customerB, name: "Pat Party", eventType: "Birthday", eventDate: "2031-07-01" });

const adminData = JSON.stringify({
  payments: [
    { id: "p1", label: "Deposit", amount: 200, due: "", status: "paid", paidAt: "", method: "", ref: "" },
    { id: "p2", label: "Final payment", amount: 800, due: "", status: "paid", paidAt: "", method: "", ref: "" },
    { id: "p3", label: "Security deposit", amount: 50, due: "", status: "due", paidAt: "", method: "", ref: "" },
  ],
  lineItems: [{ id: "l1", description: "DJ", qty: 1, price: 1000 }],
});
await db.prepare(
  "INSERT INTO planner_events (id, code, password_hash, guest_code, guest_password, event_id, data, admin_data) VALUES (?, 'MB-ANLYT1', 'x', 'G-ANLYT1', 'x', ?, '{}', ?)",
).bind(crypto.randomUUID(), eventId, adminData).run();

const fromJson = await buildBusinessReport(db);
check("json source is disclosed", fromJson.moneySource.plannerJsonEvents === 1 && fromJson.moneySource.relationalEvents === 0, fromJson.moneySource.note);
check("json deposits are label based", fromJson.depositsCents === 20000, String(fromJson.depositsCents));
check("json due deposit is excluded", fromJson.revenueCents === 100000, String(fromJson.revenueCents));
check("json still has no profit", fromJson.profitability.recorded === false && !("profitCents" in fromJson.profitability) && !("margin" in fromJson.profitability));

await db.prepare("INSERT INTO payments (id, event_id, label, amount_cents, status, kind) VALUES (?, ?, 'Security DEPOSIT', 10000, 'paid', 'deposit')").bind(crypto.randomUUID(), eventId).run();
await db.prepare("INSERT INTO payments (id, event_id, label, amount_cents, status, kind) VALUES (?, ?, 'Final balance', 40000, 'paid', 'balance')").bind(crypto.randomUUID(), eventId).run();
await db.prepare("INSERT INTO payments (id, event_id, label, amount_cents, status, kind) VALUES (?, ?, 'Other due', 99999, 'due', 'other')").bind(crypto.randomUUID(), eventId).run();
await db.prepare("INSERT INTO payment_adjustments (id, event_id, kind, amount_cents) VALUES (?, ?, 'refund', 5000)").bind(crypto.randomUUID(), eventId).run();

const mixed = await buildBusinessReport(db);
check("relational source replaces json for that event", mixed.plannerJsonCollectedCents === 0 && mixed.relationalCollectedCents === 50000, JSON.stringify({ json: mixed.plannerJsonCollectedCents, relational: mixed.relationalCollectedCents }));
check("revenue subtracts adjustments", mixed.revenueCents === 45000, String(mixed.revenueCents));
check("deposits use structured kind not due rows", mixed.depositsCents === 10000, String(mixed.depositsCents));
check("package is not recorded", mixed.byPackage.length === 1 && mixed.byPackage[0]?.label === "not recorded" && mixed.byPackage[0]?.revenueCents === 45000, JSON.stringify(mixed.byPackage));
check("profit still absent before costs", mixed.profitability.recorded === false && !("margin" in mixed.profitability) && !("profitCents" in mixed.profitability));

await db.prepare("INSERT INTO event_costs (id, event_id, label, amount_cents) VALUES (?, ?, 'Staff', 12000)").bind(crypto.randomUUID(), eventId).run();
const withCost = await buildBusinessReport(db);
const profit = withCost.profitability;
check("profit is revenue minus recorded cost", profit.recorded === true && profit.events.length === 1 && profit.events[0]?.profitCents === 33000 && profit.totalProfitCents === 33000, JSON.stringify(profit));
check("margin uses verified costs only", profit.recorded === true && !("margin" in profit) && profit.events[0]?.marginBps === Math.round((33000 / 45000) * 10_000) && profit.totalMarginBps === Math.round((33000 / 45000) * 10_000), JSON.stringify(profit));

const named = await buildBusinessReport(db);
check("same name is not a repeat customer", named.repeatCustomers === 0, String(named.repeatCustomers));
const third = crypto.randomUUID();
await createEventRecord({ id: third, customerId: customerA, name: "Pat Second", eventType: "Wedding", eventDate: "2032-06-01" });
const repeats = await buildBusinessReport(db);
check("repeat customers use the customer link", repeats.repeatCustomers === 1, String(repeats.repeatCustomers));

const proposalId = crypto.randomUUID();
await db.prepare("INSERT INTO proposals (id, event_id, title, status) VALUES (?, ?, 'Signature', 'sent')").bind(proposalId, eventId).run();
await db.prepare("INSERT INTO packages (id, name, price_cents) VALUES (?, 'Signature', 80000)").bind(crypto.randomUUID()).run();
const packageId = (await db.prepare("SELECT id FROM packages WHERE name = 'Signature'").first<{ id: string }>())!.id;
await db.prepare("UPDATE proposals SET package_id = ? WHERE id = ?").bind(packageId, proposalId).run();
await db.prepare("INSERT INTO proposal_versions (id, proposal_id, number, kind, snapshot, sent_at) VALUES (?, ?, 1, 'quote', ?::jsonb, now())")
  .bind(crypto.randomUUID(), proposalId, JSON.stringify({ invoiceTotalCents: 80000, packageName: "Signature", lines: [], charges: [] })).run();
const quoted = await buildBusinessReport(db);
check("sent quote records the invoice and outstanding balance", quoted.invoice.recorded === true && quoted.invoice.cents === 80000 && quoted.outstanding.recorded === true && quoted.outstanding.cents === 80000 - 50000 + 5000, JSON.stringify({ invoice: quoted.invoice, outstanding: quoted.outstanding }));
check("quote package names the collected revenue", quoted.byPackage.some((row) => row.label === "Signature" && row.revenueCents === 45000), JSON.stringify(quoted.byPackage));

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
