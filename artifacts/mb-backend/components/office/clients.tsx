"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/planner/ui";

type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  eventCount: number;
  leadCount: number;
  activeBookingCount: number;
  latestEventDate: string | null;
  latestEventId: string | null;
  latestPlannerId: string | null;
  latestEventName: string;
  balanceCents: number | null;
  openFollowUps: number;
};

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function OfficeClients() {
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      api<{ customers: Customer[] }>(`/api/admin/clients?q=${encodeURIComponent(q)}`)
        .then((body) => { setCustomers(body.customers); setError(""); })
        .catch((reason: Error) => { setCustomers([]); setError(reason.message); });
    }, 200);
    return () => clearTimeout(handle);
  }, [q]);

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="of-crm-header">
          <div>
            <p className="of-ecr-kicker">Directory</p>
            <h1>Clients</h1>
            <p>Search customers from the shared customers table. Open a profile for events, balances, notes, and planner access.</p>
          </div>
          <div className="of-crm-header-actions">
            <a className="pl-btn sm ghost" href="/admin/leads">Leads</a>
            <a className="pl-btn sm ghost" href="/admin/calendar">Calendar</a>
          </div>
        </header>
        {error && <p className="of-state of-state-error" role="alert">{error}</p>}
        <div className="of-toolbar">
          <input
            className="of-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, or phone"
            aria-label="Search clients"
          />
        </div>
        {customers === null ? <p className="pl-empty">Loading…</p> : null}
        {customers && !customers.length ? (
          <div className="of-empty">
            <h2>No clients yet</h2>
            <p>Customers appear when an inquiry is saved or an event is booked. Leads stay in CRM until then.</p>
            <p><a className="pl-btn" href="/admin/leads">Open leads</a></p>
          </div>
        ) : null}
        {customers && customers.length ? (
          <div className="of-table-wrap">
            <table className="of-table of-client-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>Events</th>
                  <th>Active</th>
                  <th>Follow-ups</th>
                  {customers.some((row) => row.balanceCents != null) ? <th>Balance</th> : null}
                  <th>Latest event</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <a className="of-client-name" href={`/admin/clients/${customer.id}`}>
                        <strong>{customer.name}</strong>
                      </a>
                    </td>
                    <td><small>{[customer.email, customer.phone].filter(Boolean).join(" · ") || "—"}</small></td>
                    <td>{customer.eventCount}</td>
                    <td>{customer.activeBookingCount}</td>
                    <td>{customer.openFollowUps}</td>
                    {customers.some((row) => row.balanceCents != null) ? (
                      <td>
                        <small className={customer.balanceCents && customer.balanceCents > 0 ? "of-client-balance-due" : ""}>
                          {customer.balanceCents == null ? "—" : money(customer.balanceCents)}
                        </small>
                      </td>
                    ) : null}
                    <td>
                      <small>
                        {customer.latestEventName || "—"}
                        {customer.latestEventDate ? ` · ${customer.latestEventDate}` : ""}
                      </small>
                    </td>
                    <td className="of-row-actions">
                      <a className="pl-btn ghost" href={`/admin/clients/${customer.id}`}>Profile</a>
                      {customer.latestPlannerId ? (
                        <a className="pl-btn ghost" href={`/admin/planner/${customer.latestPlannerId}`}>Control room</a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
