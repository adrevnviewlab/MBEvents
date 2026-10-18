"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/planner";
import { api, Field, Section, Text } from "./ui";

type Service = { id: string; name: string; description: string; price_cents: number | null; active: boolean; priceApprovedAt: string | null; published: boolean };
type Pack = { id: string; name: string; description: string; price_cents: number | null; active: boolean; priceApprovedAt: string | null; published: boolean; services: { serviceId: string; optional: boolean }[] };
type Rule = { id: string; kind: string; label: string; amountCents: number | null; percent: number | null; active: boolean; definition: { includedMinutes?: number } };
type Catalog = { services: Service[]; packages: Pack[]; rules: Rule[]; canEditServices: boolean; canEditPackages: boolean; canEditRules: boolean; canPublish: boolean };
type PaymentRow = { id: string; label: string; amountCents: number; dueOn: string | null; status: string; kind: string; hasEvidence: boolean };
type Ledger = {
  invoiceTotalCents: number;
  paidCents: number;
  dueCents: number;
  balanceCents: number;
  invoiceStatus: string;
  deposit: { id: string; status: string; amountCents: number; dueOn: string | null; label: string } | null;
  payments: PaymentRow[];
  proposal: { id: string; status: string; title: string } | null;
};
type Budget = {
  layers: {
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
  rows: {
    id: string;
    label: string;
    category: string;
    amountCents: number;
    estimatedCents: number | null;
    varianceCents: number | null;
    notes: string;
    sourceKind: string;
    staffName: string;
    vendorName: string;
  }[];
  canWrite: boolean;
};
type PayoutImport = { assignmentId: string; staffName: string; roleLabel: string; payoutCents: number; imported: boolean };
type FinanceResponse = {
  moneyDetail: string;
  ledger: Ledger | null;
  budget: Budget | null;
  payoutImports: PayoutImport[];
  expenseCategories: string[];
  canQuote: boolean;
  canPay: boolean;
};

const ruleKinds = ["tax", "deposit", "overtime", "travel", "setup", "discount", "adjustment"] as const;
const cents = (dollars: string) => (dollars.trim() === "" ? null : Math.round(Number(dollars) * 100));

export function CatalogPanel() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [packageName, setPackageName] = useState("");
  const [packagePrice, setPackagePrice] = useState("");
  const [packageId, setPackageId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [optional, setOptional] = useState(true);
  const [kind, setKind] = useState<(typeof ruleKinds)[number]>("tax");
  const [ruleLabel, setRuleLabel] = useState("");
  const [rulePercent, setRulePercent] = useState("");
  const [ruleAmount, setRuleAmount] = useState("");
  const [included, setIncluded] = useState("");
  const load = useCallback(() => api<Catalog>("/api/admin/catalog").then(setCatalog).catch(() => setCatalog(null)), []);
  useEffect(() => { load(); }, [load]);
  if (!catalog) return null;
  const visible = catalog.canEditServices || catalog.canEditPackages || catalog.canEditRules || catalog.canPublish || catalog.services.length || catalog.packages.length || catalog.rules.length;
  if (!visible) return null;
  const activeDeposit = catalog.rules.some((rule) => rule.kind === "deposit" && rule.active && (rule.amountCents != null || rule.percent != null));
  const publishedPackage = catalog.packages.some((item) => item.published && item.price_cents != null);
  const run = async (body: object) => {
    try {
      await api("/api/admin/catalog", { body });
      await load();
    } catch (error) {
      alert((error as Error).message);
    }
  };
  const status = (item: { price_cents: number | null; priceApprovedAt: string | null; published: boolean }) => {
    if (item.price_cents == null) return "No price";
    if (item.published) return "Published";
    if (item.priceApprovedAt) return "Approved · not published";
    return "Draft price";
  };
  return (
    <Section eyebrow="Catalog" title="Services, packages, and rules" intro="Prices stay blank until you enter them. Customer quotes use only approved and published prices. Deposit and overtime rules apply only while saved and active. Demo prices never publish themselves.">
      {!activeDeposit && (
        <p className="pl-warn" role="status">
          No active deposit rule. Quote acceptance will stay blocked until Michael saves a deposit amount or percent here — nothing is invented.
        </p>
      )}
      {!publishedPackage && (
        <p className="pl-intro" role="status">
          No published package with a price yet. Approve and publish a package before sending customer quotes.
        </p>
      )}
      <div className="pl-card">
        {catalog.services.map((service) => (
          <div className="pl-row" key={service.id}>
            <span className="t"><strong>{service.name}</strong><br /><small>{status(service)}</small></span>
            <span>{service.price_cents == null ? "No price" : money(service.price_cents / 100)}</span>
            {catalog.canPublish && service.price_cents != null && !service.priceApprovedAt && (
              <button className="pl-btn ghost sm" type="button" onClick={() => run({ action: "approve_price", kind: "service", id: service.id })}>Approve</button>
            )}
            {catalog.canPublish && service.priceApprovedAt && !service.published && (
              <button className="pl-btn ghost sm" type="button" onClick={() => run({ action: "publish_price", kind: "service", id: service.id })}>Publish</button>
            )}
            {catalog.canPublish && service.published && (
              <button className="pl-btn ghost sm" type="button" onClick={() => run({ action: "unpublish_price", kind: "service", id: service.id })}>Unpublish</button>
            )}
          </div>
        ))}
        {!catalog.services.length && <p className="pl-intro">No services yet.</p>}
        {catalog.canEditServices && (
          <div className="pl-add">
            <Text value={serviceName} placeholder="Service name" onChange={setServiceName} />
            <Text value={servicePrice} placeholder="Price (optional)" onChange={setServicePrice} />
            <button className="pl-btn ghost" type="button" onClick={() => run({ action: "save_service", name: serviceName, priceCents: cents(servicePrice) })}>Save service</button>
          </div>
        )}
      </div>
      <div className="pl-card">
        {catalog.packages.map((item) => (
          <div className="pl-row" key={item.id}>
            <span className="t"><strong>{item.name}</strong><br /><small>{item.services.filter((link) => link.optional).length} optional upgrades · {status(item)}</small></span>
            <span>{item.price_cents == null ? "No price" : money(item.price_cents / 100)}</span>
            {catalog.canPublish && item.price_cents != null && !item.priceApprovedAt && (
              <button className="pl-btn ghost sm" type="button" onClick={() => run({ action: "approve_price", kind: "package", id: item.id })}>Approve</button>
            )}
            {catalog.canPublish && item.priceApprovedAt && !item.published && (
              <button className="pl-btn ghost sm" type="button" onClick={() => run({ action: "publish_price", kind: "package", id: item.id })}>Publish</button>
            )}
            {catalog.canPublish && item.published && (
              <button className="pl-btn ghost sm" type="button" onClick={() => run({ action: "unpublish_price", kind: "package", id: item.id })}>Unpublish</button>
            )}
          </div>
        ))}
        {!catalog.packages.length && <p className="pl-intro">No packages yet.</p>}
        {catalog.canEditPackages && (
          <div className="pl-add">
            <Text value={packageName} placeholder="Package name" onChange={setPackageName} />
            <Text value={packagePrice} placeholder="Price (optional)" onChange={setPackagePrice} />
            <button className="pl-btn ghost" type="button" onClick={() => run({ action: "save_package", name: packageName, priceCents: cents(packagePrice) })}>Save package</button>
          </div>
        )}
        {catalog.canEditPackages && !!catalog.packages.length && !!catalog.services.length && (
          <div className="pl-add">
            <select value={packageId} onChange={(event) => setPackageId(event.target.value)} aria-label="Package">
              <option value="">Package</option>
              {catalog.packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select value={serviceId} onChange={(event) => setServiceId(event.target.value)} aria-label="Service">
              <option value="">Service</option>
              {catalog.services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <label className="pl-check"><input type="checkbox" checked={optional} onChange={(event) => setOptional(event.target.checked)} /> Optional upgrade</label>
            <button className="pl-btn ghost" type="button" disabled={!packageId || !serviceId} onClick={() => run({ action: "save_upgrade", packageId, serviceId, optional })}>Attach</button>
          </div>
        )}
      </div>
      <div className="pl-card">
        {catalog.rules.map((rule) => <div className="pl-row" key={rule.id}><span className="t"><strong>{rule.label}</strong><br /><small>{rule.kind}{rule.active ? "" : " · inactive"}</small></span><span>{rule.percent != null ? `${rule.percent}%` : rule.amountCents != null ? money(rule.amountCents / 100) : ""}</span></div>)}
        {!catalog.rules.length && <p className="pl-intro">No pricing rules yet. Tax, deposit, and overtime stay off until you add a rule with an amount or percent Michael supplies.</p>}
        {catalog.canEditRules && (
          <div className="pl-form">
            <Field label="Kind"><select value={kind} onChange={(event) => setKind(event.target.value as (typeof ruleKinds)[number])}>{ruleKinds.map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Label"><Text value={ruleLabel} onChange={setRuleLabel} /></Field>
            <Field label="Percent"><Text value={rulePercent} placeholder="Blank if you use an amount" onChange={setRulePercent} /></Field>
            <Field label="Amount"><Text value={ruleAmount} placeholder="Blank if you use a percent" onChange={setRuleAmount} /></Field>
            {kind === "overtime" && <Field label="Included minutes"><Text value={included} onChange={setIncluded} /></Field>}
            <div className="wide"><button className="pl-btn ghost" type="button" onClick={() => run({ action: "save_rule", kind, label: ruleLabel, amountCents: cents(ruleAmount), percent: rulePercent.trim() === "" ? null : Number(rulePercent), active: true, includedMinutes: included.trim() === "" ? null : Number(included) })}>Save rule</button></div>
          </div>
        )}
      </div>
    </Section>
  );
}

export function EventFinance({ eventId, onChange }: { eventId: string; onChange: () => Promise<void> }) {
  const [finance, setFinance] = useState<FinanceResponse | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [packageId, setPackageId] = useState("");
  const [upgrades, setUpgrades] = useState<string[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [changeAmount, setChangeAmount] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [refundId, setRefundId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [note, setNote] = useState("");
  const [cost, setCost] = useState({ label: "", category: "other", amount: "", estimated: "", notes: "" });
  const [payoutId, setPayoutId] = useState("");
  const load = useCallback(() => {
    api<FinanceResponse>(`/api/admin/planner/${eventId}/finance`).then(setFinance).catch(() => setFinance(null));
    api<Catalog>("/api/admin/catalog").then(setCatalog).catch(() => setCatalog(null));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  if (!finance?.ledger) return null;
  const ledger = finance.ledger;
  const budget = finance.budget;
  const selected = catalog?.packages.find((item) => item.id === packageId);
  const run = async (body: object) => {
    try {
      await api(`/api/admin/planner/${eventId}/finance`, { body });
      await onChange();
      load();
    } catch (error) {
      alert((error as Error).message);
    }
  };
  const printSummary = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Event finance</title>
      <style>body{font:14px/1.4 Georgia,serif;padding:24px;color:#111} h1{font-size:20px} table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left} .mono{font-variant-numeric:tabular-nums}</style>
      </head><body>
      <h1>Event financial summary</h1>
      <p>Invoiced ${money(ledger.invoiceTotalCents / 100)} · Collected ${money(ledger.paidCents / 100)} · Outstanding ${money(ledger.balanceCents / 100)}</p>
      ${budget?.costs.recorded ? `<p>Actual costs ${money((budget.costs.actualCents ?? 0) / 100)}${budget.costs.estimatedCents != null ? ` · Estimated ${money(budget.costs.estimatedCents / 100)} · Variance ${money((budget.costs.varianceCents ?? 0) / 100)}` : " · Estimated not fully recorded"}</p>` : "<p>Costs not recorded</p>"}
      ${budget?.profit.recorded && budget.profit.profitCents != null ? `<p>Profit ${money(budget.profit.profitCents / 100)}${budget.profit.marginBps != null ? ` · Margin ${(budget.profit.marginBps / 100).toFixed(1)}%` : ""}</p>` : `<p>${budget?.profit.reason ?? ""}</p>`}
      <table><thead><tr><th>Payment</th><th>Status</th><th>Amount</th></tr></thead><tbody>
      ${ledger.payments.map((payment) => `<tr><td>${payment.label}</td><td>${payment.kind} · ${payment.status}</td><td class="mono">${money(payment.amountCents / 100)}</td></tr>`).join("")}
      </tbody></table>
      ${budget?.rows.length ? `<table><thead><tr><th>Cost</th><th>Category</th><th>Estimated</th><th>Actual</th></tr></thead><tbody>
      ${budget.rows.map((row) => `<tr><td>${row.label}</td><td>${row.category}</td><td class="mono">${row.estimatedCents == null ? "—" : money(row.estimatedCents / 100)}</td><td class="mono">${money(row.amountCents / 100)}</td></tr>`).join("")}
      </tbody></table>` : ""}
      <p style="margin-top:24px;color:#666">Authoritative payment ledger. Live Stripe is not enabled.</p>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };
  return (
    <div className="pl-card">
      <div className="pl-k">Ledger · {ledger.invoiceStatus}</div>
      <p className="pl-intro">{finance.moneyDetail}</p>
      <div className="pl-rowtools" style={{ marginBottom: 8 }}>
        <button type="button" className="pl-btn ghost sm" onClick={printSummary}>Print summary</button>
      </div>
      <div className="pl-row"><span>Invoiced (sent quote / change orders)</span><strong>{money(ledger.invoiceTotalCents / 100)}</strong></div>
      {budget?.layers.contractedInvoiceCents != null && (
        <div className="pl-row"><span>Contracted (accepted proposal)</span><strong>{money(budget.layers.contractedInvoiceCents / 100)}</strong></div>
      )}
      <div className="pl-row"><span>Balance outstanding</span><strong>{money(ledger.balanceCents / 100)}</strong></div>
      {finance.canQuote && (
        <div className="pl-add">
          <select value={packageId} aria-label="Quote package" onChange={(event) => { setPackageId(event.target.value); setUpgrades([]); }}>
            <option value="">Choose a published package</option>
            {(catalog?.packages ?? []).filter((item) => item.published && item.price_cents != null).map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.price_cents! / 100)}</option>)}
          </select>
          {!(catalog?.packages ?? []).some((item) => item.published && item.price_cents != null) && (
            <p className="pl-intro">No published packages yet. Approve and publish prices in Settings before sending a customer quote.</p>
          )}
          {selected?.services.filter((link) => link.optional).map((link) => {
            const service = catalog?.services.find((item) => item.id === link.serviceId);
            const ready = !!service?.published && service.price_cents != null;
            return <label className="pl-check" key={link.serviceId}><input type="checkbox" disabled={!ready} checked={upgrades.includes(link.serviceId)} onChange={(event) => setUpgrades(event.target.checked ? [...upgrades, link.serviceId] : upgrades.filter((id) => id !== link.serviceId))} />{service?.name ?? "Upgrade"}{ready ? "" : " · not published"}</label>;
          })}
          <button className="pl-btn" type="button" disabled={!packageId} onClick={() => run({ action: "send_quote", packageId, upgradeIds: upgrades })}>Send quote</button>
        </div>
      )}
      {finance.canQuote && ledger.proposal?.status === "accepted" && (
        <div className="pl-add">
          <select value={serviceId} aria-label="Change order service" onChange={(event) => setServiceId(event.target.value)}>
            <option value="">Added service</option>
            {(catalog?.services ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Text value={changeAmount} placeholder="Amount if the service has no price" onChange={setChangeAmount} />
          <button className="pl-btn ghost" type="button" onClick={() => run({ action: "change_order", serviceId: serviceId || null, quantity: 1, unitAmountCents: cents(changeAmount) })}>Send change order</button>
        </div>
      )}
      {finance.canPay && (
        <div className="pl-add">
          <Text value={label} placeholder="Label" onChange={setLabel} />
          <Text value={amount} placeholder="Amount" onChange={setAmount} />
          <Text type="date" value={due} onChange={setDue} />
          <button className="pl-btn ghost" type="button" onClick={() => run({ action: "schedule", label, amountCents: cents(amount), dueOn: due || null })}>Add to schedule</button>
        </div>
      )}
      <div className="pl-row"><span>Received (paid)</span><strong>{money(ledger.paidCents / 100)}</strong></div>
      <div className="pl-row"><span>Still due on schedule</span><strong>{money(ledger.dueCents / 100)}</strong></div>
      {ledger.deposit && (
        <div className="pl-row"><span>Deposit ({ledger.deposit.status})</span><strong>{money(ledger.deposit.amountCents / 100)}</strong></div>
      )}
      {ledger.payments.map((payment) => (
        <div className="pl-row" key={payment.id}>
          <span className="t">
            <strong>{payment.label}</strong>
            <br />
            <small>{payment.kind} · {payment.status}{payment.dueOn ? ` · ${payment.dueOn}` : ""}{payment.hasEvidence ? " · evidenced" : ""}</small>
          </span>
          <span>{money(payment.amountCents / 100)}</span>
          {finance.canPay && payment.status === "due" && <button className="pl-btn ghost sm" type="button" onClick={() => run({ action: "void", paymentId: payment.id })}>Void</button>}
        </div>
      ))}
      {finance.canPay && ledger.payments.some((payment) => payment.status === "due") && (
        <OfflinePayment payments={ledger.payments.filter((payment) => payment.status === "due")} onSave={(body) => run(body)} />
      )}
      {finance.canPay && (
        <div className="pl-add">
          <button className="pl-btn ghost" type="button" onClick={async () => {
            try {
              const result = await api<{ runId: string; report: { proposed: unknown[]; skipped: unknown[]; note: string } }>(`/api/admin/planner/${eventId}/finance`, { body: { action: "reconcile_dry_run" } });
              const ok = window.confirm(`${result.report.note}\n\nProposed: ${result.report.proposed.length}\nSkipped: ${result.report.skipped.length}\n\nApprove and move these rows onto the ledger?`);
              if (!ok) return;
              await api(`/api/admin/planner/${eventId}/finance`, { body: { action: "reconcile_apply", runId: result.runId, approve: true } });
              await onChange();
              load();
            } catch (error) {
              alert((error as Error).message);
            }
          }}>Dry-run planner → ledger reconcile</button>
        </div>
      )}
      {finance.canPay && ledger.payments.some((payment) => payment.status === "paid") && (
        <div className="pl-add">
          <select value={refundId} aria-label="Payment to refund" onChange={(event) => setRefundId(event.target.value)}>
            <option value="">Refund a payment</option>
            {ledger.payments.filter((payment) => payment.status === "paid").map((payment) => <option key={payment.id} value={payment.id}>{payment.label} · {money(payment.amountCents / 100)}</option>)}
          </select>
          <Text value={refundAmount} placeholder="Refund amount" onChange={setRefundAmount} />
          <Text value={note} placeholder="Note" onChange={setNote} />
          <button className="pl-btn ghost" type="button" disabled={!refundId} onClick={() => run({ action: "adjustment", kind: "refund", paymentId: refundId, amountCents: cents(refundAmount), note })}>Record refund</button>
        </div>
      )}

      {budget ? (
        <>
          <h3 className="pl-h3">Event budget</h3>
          <p className="pl-intro">Estimated, contracted, invoiced, and collected stay separate. Profit uses verified actual costs only — never invented.</p>
          <div className="pl-row"><span>Collected</span><strong>{money(budget.layers.collectedCents / 100)}</strong></div>
          <div className="pl-row"><span>Actual costs</span><strong>{budget.costs.recorded ? money((budget.costs.actualCents ?? 0) / 100) : "not recorded"}</strong></div>
          <div className="pl-row"><span>Estimated costs</span><strong>{budget.costs.estimatedCents == null ? "not recorded (every line needs an estimate)" : money(budget.costs.estimatedCents / 100)}</strong></div>
          <div className="pl-row"><span>Budget variance</span><strong>{budget.costs.varianceCents == null ? "not recorded" : money(budget.costs.varianceCents / 100)}</strong></div>
          <div className="pl-row"><span>Profit</span><strong>{budget.profit.recorded && budget.profit.profitCents != null ? money(budget.profit.profitCents / 100) : "not recorded"}</strong></div>
          <div className="pl-row"><span>Margin</span><strong>{budget.profit.marginBps == null ? "not recorded" : `${(budget.profit.marginBps / 100).toFixed(1)}%`}</strong></div>
          <p className="pl-intro">{budget.profit.reason}</p>

          {budget.rows.map((row) => (
            <div className="pl-row" key={row.id}>
              <span className="t">
                <strong>{row.label}</strong>
                <br />
                <small>
                  {row.category}
                  {row.sourceKind !== "manual" ? ` · ${row.sourceKind}` : ""}
                  {row.staffName ? ` · ${row.staffName}` : ""}
                  {row.vendorName ? ` · ${row.vendorName}` : ""}
                  {row.estimatedCents != null ? ` · est ${money(row.estimatedCents / 100)}` : ""}
                  {row.varianceCents != null ? ` · var ${money(row.varianceCents / 100)}` : ""}
                </small>
              </span>
              <span>{money(row.amountCents / 100)}</span>
              {budget.canWrite ? <button className="pl-btn ghost sm" type="button" onClick={() => run({ action: "delete_cost", costId: row.id })}>Remove</button> : null}
            </div>
          ))}

          {budget.canWrite ? (
            <div className="pl-add">
              <Text value={cost.label} placeholder="Cost label" onChange={(v) => setCost({ ...cost, label: v })} />
              <select value={cost.category} aria-label="Expense category" onChange={(event) => setCost({ ...cost, category: event.target.value })}>
                {(finance.expenseCategories ?? ["other"]).map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <Text value={cost.estimated} placeholder="Estimated (optional)" onChange={(v) => setCost({ ...cost, estimated: v })} />
              <Text value={cost.amount} placeholder="Actual amount" onChange={(v) => setCost({ ...cost, amount: v })} />
              <Text value={cost.notes} placeholder="Notes" onChange={(v) => setCost({ ...cost, notes: v })} />
              <button
                className="pl-btn ghost"
                type="button"
                disabled={!cost.label.trim() || cents(cost.amount) == null}
                onClick={() => {
                  run({
                    action: "save_cost",
                    label: cost.label,
                    category: cost.category,
                    amountCents: cents(cost.amount),
                    estimatedCents: cost.estimated.trim() === "" ? null : cents(cost.estimated),
                    notes: cost.notes,
                  }).then(() => setCost({ label: "", category: "other", amount: "", estimated: "", notes: "" }));
                }}
              >
                Add cost
              </button>
            </div>
          ) : null}

          {budget.canWrite && (finance.payoutImports ?? []).some((item) => !item.imported) ? (
            <div className="pl-add">
              <select value={payoutId} aria-label="Import staff payout" onChange={(event) => setPayoutId(event.target.value)}>
                <option value="">Copy approved staff payout into costs</option>
                {(finance.payoutImports ?? []).filter((item) => !item.imported).map((item) => (
                  <option key={item.assignmentId} value={item.assignmentId}>
                    {item.staffName} · {item.roleLabel || "Staff"} · {money(item.payoutCents / 100)}
                  </option>
                ))}
              </select>
              <button className="pl-btn ghost" type="button" disabled={!payoutId} onClick={() => run({ action: "import_staff_payout", assignmentId: payoutId }).then(() => setPayoutId(""))}>
                Import payout
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function OfflinePayment({
  payments,
  onSave,
}: {
  payments: { id: string; label: string; amountCents: number }[];
  onSave: (body: object) => Promise<void>;
}) {
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? "");
  const [method, setMethod] = useState("check");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="pl-add">
      <select value={paymentId} aria-label="Due payment" onChange={(event) => setPaymentId(event.target.value)}>
        {payments.map((payment) => <option key={payment.id} value={payment.id}>{payment.label} · {money(payment.amountCents / 100)}</option>)}
      </select>
      <Text value={method} placeholder="Method (check, cash, transfer)" onChange={setMethod} />
      <Text value={evidenceRef} placeholder="Evidence reference (required)" onChange={setEvidenceRef} />
      <Text value={note} placeholder="Note" onChange={setNote} />
      <button className="pl-btn" type="button" disabled={!paymentId || !evidenceRef.trim()} onClick={() => onSave({ action: "offline", paymentId, method, evidenceRef, note })}>Record offline payment</button>
    </div>
  );
}
