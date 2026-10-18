"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/planner/ui";
import type { BusinessReport } from "@/lib/analytics";

function usd(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function moneyCell(value: { recorded: true; cents: number } | { recorded: false; label: string; reason: string }) {
  return value.recorded ? usd(value.cents) : value.label;
}

export function ReportDesk() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    api<BusinessReport>(`/api/admin/report?${params}`)
      .then((body) => { setReport(body); setError(""); })
      .catch((reason: Error) => { setReport(null); setError(reason.message); })
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!report) return;
    const lines = [
      ["Section", "Label", "Value"],
      ["Range", "from", report.range.from || ""],
      ["Range", "to", report.range.to || ""],
      ["Money", "Collected revenue", String(report.revenueCents)],
      ["Money", "Deposits", String(report.depositsCents)],
      ["Money", "Contracted", report.contractedCents == null ? "not recorded" : String(report.contractedCents)],
      ["Money", "Invoice", report.invoice.recorded ? String(report.invoice.cents) : report.invoice.label],
      ["Money", "Outstanding", report.outstanding.recorded ? String(report.outstanding.cents) : report.outstanding.label],
      ["Leads", "Total", String(report.leads.total)],
      ["Leads", "Converted", String(report.leads.converted)],
      ["Leads", "Conversion rate", report.leads.conversionRate == null ? "not recorded" : String(report.leads.conversionRate)],
      ...report.leads.byStage.map((row) => ["Lead stage", row.stage, String(row.count)]),
      ...report.bookingPipeline.map((row) => ["Booking pipeline", row.status, String(row.count)]),
      ["Events", "Upcoming", String(report.eventsTimeline.upcoming)],
      ["Events", "Past", String(report.eventsTimeline.past)],
      ["Events", "Completed", String(report.eventsTimeline.completed)],
      ["Events", "Cancelled", String(report.eventsTimeline.cancelled)],
      ...report.byEventType.map((row) => ["Event type", row.label, `${row.eventCount} events / ${row.revenueCents} cents`]),
      ...(report.profitability.recorded
        ? report.profitability.events.map((row) => ["Profit", row.eventId, String(row.profitCents)])
        : [["Profit", report.profitability.label, report.profitability.reason]]),
      ["Staff", "utilization", report.staffUtilization.recorded
        ? `${report.staffUtilization.assignments} assignments / ${report.staffUtilization.staffAssigned} staff / ${report.staffUtilization.eventsAssigned} events`
        : report.staffUtilization.label],
      ["Equipment", "utilization", report.equipmentUtilization.recorded
        ? `${report.equipmentUtilization.reservations} reservations / ${report.equipmentUtilization.quantityReserved} reserved / ${report.equipmentUtilization.quantityOnHand} on hand`
        : report.equipmentUtilization.label],
    ];
    const csv = lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mb-events-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="pl-hero">
          <div className="pl-k">Reports</div>
          <h1>Analytics</h1>
          <p className="pl-intro">
            Counts and money come from stored rows only. Empty sources stay blank — nothing is invented.
            Live Stripe and live messaging are not enabled from this screen.
          </p>
        </header>

        <div className="of-toolbar">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <button type="button" className="pl-btn ghost" onClick={() => { setFrom(""); setTo(""); }}>Clear dates</button>
          <button type="button" className="pl-btn ghost" onClick={exportCsv} disabled={!report}>Export CSV</button>
          <button type="button" className="pl-btn ghost" onClick={() => window.print()}>Print</button>
          <a className="pl-btn ghost" href="/admin/payments">Payments</a>
        </div>

        {error && <p className="pl-warn" role="alert">{error}</p>}
        {loading && !report ? <p className="pl-empty">Loading report…</p> : null}
        {report ? (
          <>
            <p className="pl-intro">{report.range.note}</p>
            <p className="pl-intro">{report.moneySource.note}</p>

            <section className="pl-card">
              <h2>Leads & conversion</h2>
              <table className="pl-admin-table">
                <tbody>
                  <tr><th>Lead volume</th><td>{report.leads.total}</td></tr>
                  <tr><th>Converted</th><td>{report.leads.converted}</td></tr>
                  <tr><th>Conversion rate</th><td>{report.leads.conversionRate == null ? "not recorded" : `${Math.round(report.leads.conversionRate * 1000) / 10}%`}</td></tr>
                </tbody>
              </table>
              <p className="pl-intro">{report.leads.definition}</p>
              {report.leads.byStage.length ? (
                <table className="pl-admin-table">
                  <thead><tr><th>Stage</th><th>Count</th></tr></thead>
                  <tbody>{report.leads.byStage.map((row) => <tr key={row.stage}><td>{row.stage}</td><td>{row.count}</td></tr>)}</tbody>
                </table>
              ) : <p className="pl-empty">No leads in this range.</p>}
            </section>

            <section className="pl-card">
              <h2>Booking pipeline</h2>
              {report.bookingPipeline.length ? (
                <table className="pl-admin-table">
                  <thead><tr><th>Status</th><th>Count</th></tr></thead>
                  <tbody>{report.bookingPipeline.map((row) => <tr key={row.status}><td>{row.status}</td><td>{row.count}</td></tr>)}</tbody>
                </table>
              ) : <p className="pl-empty">No bookings in this range.</p>}
            </section>

            <section className="pl-card">
              <h2>Events timeline</h2>
              <table className="pl-admin-table">
                <tbody>
                  <tr><th>Upcoming</th><td>{report.eventsTimeline.upcoming}</td></tr>
                  <tr><th>Past (by date)</th><td>{report.eventsTimeline.past}</td></tr>
                  <tr><th>Completed status</th><td>{report.eventsTimeline.completed}</td></tr>
                  <tr><th>Cancelled status</th><td>{report.eventsTimeline.cancelled}</td></tr>
                </tbody>
              </table>
              <p className="pl-intro">{report.eventsTimeline.definition}</p>
            </section>

            <section className="pl-card">
              <h2>Money</h2>
              <table className="pl-admin-table">
                <tbody>
                  <tr><th>Collected (net)</th><td className="of-mono">{usd(report.revenueCents)}</td></tr>
                  <tr><th>Deposits collected</th><td className="of-mono">{usd(report.depositsCents)}</td></tr>
                  <tr><th>Contracted (accepted quotes)</th><td className="of-mono">{report.contractedCents == null ? "not recorded" : usd(report.contractedCents)}</td></tr>
                  <tr><th>Invoice total</th><td className="of-mono">{moneyCell(report.invoice)}</td></tr>
                  <tr><th>Outstanding</th><td className="of-mono">{moneyCell(report.outstanding)}</td></tr>
                  <tr><th>Average booking value</th><td className="of-mono">{report.averageBookingValueCents == null ? "not recorded" : usd(report.averageBookingValueCents)}</td></tr>
                </tbody>
              </table>
            </section>

            <section className="pl-card">
              <h2>Events by type</h2>
              {report.byEventType.length ? (
                <table className="pl-admin-table">
                  <thead><tr><th>Type</th><th>Events</th><th>Collected revenue</th></tr></thead>
                  <tbody>
                    {report.byEventType.map((row) => (
                      <tr key={row.label}><td>{row.label}</td><td>{row.eventCount}</td><td className="of-mono">{usd(row.revenueCents)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="pl-empty">No events in this range.</p>}
            </section>

            <section className="pl-card">
              <h2>Profitability</h2>
              {!report.profitability.recorded ? (
                <p className="pl-empty">{report.profitability.label}. {report.profitability.reason}</p>
              ) : (
                <>
                  <table className="pl-admin-table">
                    <thead><tr><th>Event</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th></tr></thead>
                    <tbody>
                      {report.profitability.events.map((event) => (
                        <tr key={event.eventId}>
                          <td><a href={`/admin/planner/${event.eventId}?room=payments`}>{event.eventId.slice(0, 8)}…</a></td>
                          <td className="of-mono">{usd(event.revenueCents)}</td>
                          <td className="of-mono">{usd(event.costCents)}</td>
                          <td className="of-mono">{usd(event.profitCents)}</td>
                          <td className="of-mono">{event.marginBps == null ? "—" : `${(event.marginBps / 100).toFixed(1)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.profitability.totalProfitCents == null ? (
                    <p className="pl-intro">{report.profitability.missingCostEvents} revenue event(s) lack cost rows. Company profit stays blank.</p>
                  ) : (
                    <p className="pl-intro">
                      Company profit {usd(report.profitability.totalProfitCents)}
                      {report.profitability.totalMarginBps != null ? ` · margin ${(report.profitability.totalMarginBps / 100).toFixed(1)}%` : ""}.
                    </p>
                  )}
                </>
              )}
            </section>

            <section className="pl-card">
              <h2>Staff & equipment</h2>
              <p className="pl-intro">
                {report.staffUtilization.recorded
                  ? `${report.staffUtilization.assignments} assignments · ${report.staffUtilization.staffAssigned} staff · ${report.staffUtilization.eventsAssigned} events.`
                  : `${report.staffUtilization.label}. ${report.staffUtilization.reason}`}
              </p>
              <p className="pl-intro">
                {report.equipmentUtilization.recorded
                  ? `${report.equipmentUtilization.reservations} reservations · ${report.equipmentUtilization.quantityReserved} reserved of ${report.equipmentUtilization.quantityOnHand} on hand for reserved items.`
                  : `${report.equipmentUtilization.label}. ${report.equipmentUtilization.reason}`}
              </p>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
