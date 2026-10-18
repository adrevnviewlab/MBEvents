process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@budget.test";

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

const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const budget = await import("../lib/event-budget.ts");
const {
  acceptProposal,
  addSchedulePayment,
  approveCatalogPrice,
  eventLedger,
  publishCatalogPrice,
  savePackage,
  savePricingRule,
  sendQuote,
} = await import("../lib/finance.ts");
const { createAssignment } = await import("../lib/operations.ts");
const { buildBusinessReport } = await import("../lib/analytics.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const actor = "owner@budget.test";

const customerId = await ensureCustomer({ name: "Budget Client", email: "budget@example.com" });
const eventId = crypto.randomUUID();
await createEventRecord({
  id: eventId,
  customerId,
  name: "Budget Gala",
  eventType: "Gala",
  eventDate: "2037-04-12",
  startTime: "18:00",
  endTime: "23:00",
});

const empty = await budget.eventBudgetSummary(eventId, "manager");
check("profit blank without costs", !empty.profit.recorded && empty.costs.actualCents === null);
check("estimated invoice layer not invented", empty.layers.estimatedInvoiceCents === null);

const pack = await savePackage({ name: "Budget Pack", description: "", priceCents: 200_000, actorEmail: actor });
await approveCatalogPrice({ kind: "package", id: pack.id, actorEmail: actor });
await publishCatalogPrice({ kind: "package", id: pack.id, actorEmail: actor });
await savePricingRule({
  kind: "deposit",
  label: "Deposit",
  amountCents: 50_000,
  percent: null,
  active: true,
  actorEmail: actor,
});
await sendQuote({ eventId, packageId: pack.id, actorEmail: actor });
await acceptProposal({ eventId, acceptedBy: "Budget Client", actorEmail: actor });

const ledger = await eventLedger(eventId);
check("deposit created once on accept", ledger.deposit?.amountCents === 50_000 && ledger.deposit?.status === "due");
check("duplicate deposit schedule rejected", await throws(() => addSchedulePayment({
  eventId,
  label: "Another deposit",
  amountCents: 10_000,
  kind: "deposit",
  actorEmail: actor,
})));
check("second accept does not create another deposit", (await acceptProposal({ eventId, acceptedBy: "Budget Client", actorEmail: actor })).already === true
  && (await db.prepare("SELECT count(*)::int AS n FROM payments WHERE event_id = ? AND kind = 'deposit' AND status <> 'void'").bind(eventId).first<{ n: number }>())?.n === 1);

await budget.saveEventCost({
  actorRole: "manager",
  actorEmail: actor,
  actorUserId: null,
  eventId,
  label: "Venue fee",
  category: "venue",
  amountCents: 80_000,
  estimatedCents: 75_000,
});
await budget.saveEventCost({
  actorRole: "manager",
  actorEmail: actor,
  actorUserId: null,
  eventId,
  label: "DJ",
  category: "staff",
  amountCents: 40_000,
  estimatedCents: 40_000,
});

const withCosts = await budget.eventBudgetSummary(eventId, "manager");
check("actual costs sum recorded rows", withCosts.costs.actualCents === 120_000);
check("estimated costs when every line has estimate", withCosts.costs.estimatedCents === 115_000);
check("variance is actual minus estimated", withCosts.costs.varianceCents === 5_000);
check("profit uses collected net minus actual", withCosts.profit.profitCents === -120_000, JSON.stringify(withCosts.profit));
check("invoiced and contracted distinguished", withCosts.layers.invoicedCents === 200_000 && withCosts.layers.contractedInvoiceCents === 200_000);

const staffUser = crypto.randomUUID();
const staffId = crypto.randomUUID();
await db.prepare("INSERT INTO users (id, email, name, role) VALUES (?, 'dj@budget.test', 'DJ', 'staff')").bind(staffUser).run();
await db.prepare("INSERT INTO staff (id, user_id, name, email, profile_type) VALUES (?, ?, 'DJ', 'dj@budget.test', 'dj')").bind(staffId, staffUser).run();
const assignmentId = await createAssignment({
  actorRole: "coordinator",
  eventId,
  staffId,
  roleLabel: "DJ",
  payoutCents: 15_000,
});
await budget.importStaffPayoutCost({
  actorRole: "manager",
  actorEmail: actor,
  actorUserId: null,
  eventId,
  assignmentId: assignmentId!,
});
check("duplicate staff payout import rejected", await throws(() => budget.importStaffPayoutCost({
  actorRole: "manager",
  actorEmail: actor,
  actorUserId: null,
  eventId,
  assignmentId: assignmentId!,
})));

const afterImport = await budget.eventBudgetSummary(eventId, "manager");
check("staff payout appears as staff cost", afterImport.rows.some((row) => row.sourceKind === "staff_payout" && row.amountCents === 15_000));

await budget.saveEventCost({
  actorRole: "manager",
  actorEmail: actor,
  actorUserId: null,
  eventId,
  label: "Misc",
  category: "other",
  amountCents: 1_000,
  estimatedCents: null,
});
const partial = await budget.eventBudgetSummary(eventId, "manager");
check("estimated stays blank when any line lacks estimate", partial.costs.estimatedCents === null && partial.costs.varianceCents === null);

const desk = await budget.listFinanceDesk("manager", { status: "deposit_due" });
check("finance desk filters deposit due", desk.events.some((row) => row.id === eventId && row.depositStatus === "due"));

const report = await buildBusinessReport(db);
check(
  "analytics profit includes margin field when costs exist",
  report.profitability.recorded === true
    && report.profitability.events.some((row) => row.eventId === eventId && "marginBps" in row),
);

check("sales cannot write costs", await throws(() => budget.saveEventCost({
  actorRole: "sales",
  actorEmail: "sales@budget.test",
  actorUserId: null,
  eventId,
  label: "Nope",
  category: "other",
  amountCents: 100,
})));

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
