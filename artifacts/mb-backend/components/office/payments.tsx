"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/planner/ui";

type Money = { recorded: true; cents: number } | { recorded: false; label: string; reason: string };

type Report = {
  moneySource: { note: string };
  revenueCents: number;
  depositsCents: number;
  invoice: Money;
  outstanding: Money;
  profitability?:
    | { recorded: false; label: string; reason: string }
    | { recorded: true; events: { eventId: string; revenueCents: number; costCents: number; profitCents: number; marginBps?: number | null }[]; missingCostEvents: number; totalProfitCents: number | null; totalMarginBps?: number | null };
};

type EventRow = {
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
};

function usd(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function cell(cents: number | null | undefined) {
  return cents == null ? "not recorded" : usd(cents);
}

export function OfficePayments() {
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [reportError, setReportError] = useState("");
  const [listError, setListError] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const loadEvents = useCallback(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    api<{ events: EventRow[] }>(`/api/admin/finance?${params}`)
      .then((body) => { setEvents(body.events); setListError(""); })
      .catch((error: Error) => { setEvents([]); setListError(error.message); });
  }, [q, status, from, to]);

  useEffect(() => {
    api<Report>("/api/admin/report").then(setReport).catch((error: Error) => setReportError(error.message));
  }, []);

  useEffect(() => {
    const handle = setTimeout(loadEvents, 200);
    return () => clearTimeout(handle);
  }, [loadEvents]);

  const outstandingReason = report && !report.outstanding.recorded ? report.outstanding.reason : "";
  const invoiceReason = report && !report.invoice.recorded ? report.invoice.reason : "";
  const sourceNote = report?.moneySource.note ?? "";

  const exportCsv = () => {
    if (!events?.length) return;
    const header = ["Client", "Event date", "Type", "Invoice", "Due", "Paid", "Balance", "Deposit", "Status", "Actual costs", "Profit", "Control room"];
    const lines = events.map((event) => [
      event.clientNames,
      event.eventDate || "",
      event.eventType,
      event.invoiceCents ?? "",
      event.dueCents ?? "",
      event.paidCents ?? "",
      event.balanceCents ?? "",
      event.depositStatus || "",
      event.paymentStatus,
      event.costActualCents ?? "",
      event.profitCents ?? "",
      event.href,
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mb-events-finance.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const printTable = () => {
    window.print();
  };

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="pl-hero">
          <div className="pl-k">Ledger</div>
          <h1>Payments & invoices</h1>
          <p className="pl-intro">
            Company figures come from the business report. Per-event balances come from the authoritative payment ledger.
            Estimated, contracted, invoiced, and collected amounts stay distinct — nothing is invented.
          </p>
        </header>
        {reportError && <p className="pl-warn">{reportError}</p>}
        {report === null && !reportError ? <p className="pl-empty">Loading the report…</p> : report && (
          <div className="pl-card of-table-wrap">
            <table className="pl-admin-table">
              <tbody>
                <tr><th>Revenue (collected net)</th><td className="of-mono">{usd(report.revenueCents)}</td></tr>
                <tr><th>Deposits collected</th><td className="of-mono">{usd(report.depositsCents)}</td></tr>
                <tr><th>Invoice total</th><td className="of-mono">{report.invoice.recorded ? usd(report.invoice.cents) : report.invoice.label}</td></tr>
                <tr><th>Outstanding</th><td className="of-mono">{report.outstanding.recorded ? usd(report.outstanding.cents) : report.outstanding.label}</td></tr>
                {report.profitability?.recorded ? (
                  <tr>
                    <th>Profit (events with costs)</th>
                    <td className="of-mono">
                      {report.profitability.totalProfitCents == null
                        ? `incomplete · ${report.profitability.missingCostEvents} revenue event(s) missing costs`
                        : usd(report.profitability.totalProfitCents)}
                    </td>
                  </tr>
                ) : report.profitability ? (
                  <tr><th>Profit</th><td>{report.profitability.reason}</td></tr>
                ) : null}
              </tbody>
            </table>
            {sourceNote && <p className="pl-intro">{sourceNote}</p>}
            {invoiceReason && invoiceReason !== sourceNote && <p className="pl-intro">{invoiceReason}</p>}
            {outstandingReason && outstandingReason !== sourceNote && outstandingReason !== invoiceReason && <p className="pl-intro">{outstandingReason}</p>}
          </div>
        )}

        <h2 style={{ marginTop: 22 }}>Event balances</h2>
        <div className="of-toolbar">
          <input className="of-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by client or event" aria-label="Search finance" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Payment status">
            <option value="">All statuses</option>
            <option value="deposit_due">Deposit due</option>
            <option value="deposit_paid">Deposit paid</option>
            <option value="due">Schedule due</option>
            <option value="outstanding">Outstanding balance</option>
            <option value="paid">Paid in full</option>
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <button type="button" className="pl-btn ghost" onClick={exportCsv} disabled={!events?.length}>Export CSV</button>
          <button type="button" className="pl-btn ghost" onClick={printTable}>Print</button>
        </div>
        {listError && <p className="pl-warn">{listError}</p>}
        <div className="pl-card of-table-wrap">
          {events === null && !listError ? <p className="pl-empty">Loading events…</p> : events && events.length ? (
            <table className="pl-admin-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Due</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Deposit</th>
                  <th>Costs</th>
                  <th>Profit</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td><a href={event.href}>{event.clientNames || "Unnamed"}</a></td>
                    <td>{event.eventDate || "TBD"}</td>
                    <td className="of-mono">{cell(event.invoiceCents)}</td>
                    <td className="of-mono">{cell(event.dueCents)}</td>
                    <td className="of-mono">{cell(event.paidCents)}</td>
                    <td className="of-mono">{cell(event.balanceCents)}</td>
                    <td>{event.depositStatus || "—"}</td>
                    <td className="of-mono">{cell(event.costActualCents)}</td>
                    <td className="of-mono">{cell(event.profitCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="pl-empty">No events match these filters.</p>}
        </div>
      </div>
    </div>
  );
}
