"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/planner/ui";

type Profile = {
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string;
    marketingOptIn: boolean | null;
    createdAt: string;
    updatedAt: string;
  };
  permissions: {
    canWrite: boolean;
    showPayments: boolean;
    showProposals: boolean;
    showContracts: boolean;
    showComms: boolean;
    showTasks: boolean;
    canPlanner: boolean;
  };
  finance: { hasLedger: boolean; balanceCents: number; paidCents: number; dueCents: number } | null;
  events: {
    id: string;
    name: string;
    eventType: string;
    eventDate: string | null;
    eventStatus: string;
    bookingStatus: string;
    href: string;
    balanceCents: number | null;
  }[];
  activeBookings: {
    id: string;
    name: string;
    eventDate: string | null;
    bookingStatus: string;
    holdUntil: string | null;
    href: string;
  }[];
  pastEvents: { id: string; name: string; eventDate: string | null; href: string }[];
  leads: {
    id: string;
    name: string;
    stage: string;
    eventType: string;
    eventDate: string | null;
    href: string;
  }[];
  internalNotes: { leadId: string; leadName: string; body: string; createdAt: string }[];
  followUps: {
    id: string;
    title: string;
    dueOn: string | null;
    done: boolean;
    context: string;
    href: string;
    overdue: boolean;
    assigneeName: string | null;
  }[];
  quotes: {
    id: string;
    title: string;
    status: string;
    eventName: string;
    kind: string | null;
    href: string;
  }[];
  contracts: {
    id: string;
    title: string;
    status: string;
    eventName: string;
    signedAt: string | null;
    href: string;
  }[];
  payments: {
    id: string;
    label: string;
    amountCents: number;
    dueOn: string | null;
    status: string;
    eventName: string;
    href: string;
  }[];
  plannerAccess: {
    eventId: string;
    eventName: string;
    plannerId: string;
    code: string;
    hasPassword: boolean;
    hasGuestAccess: boolean;
    href: string;
    resetAllowed: boolean;
  }[];
  communications: {
    id: string;
    source: string;
    channel: string;
    label: string;
    status: string;
    createdAt: string;
    detail: string;
  }[];
  duplicates: {
    id: string;
    name: string;
    email: string;
    phone: string;
    eventCount: number;
    leadCount: number;
    reason: string;
  }[];
  nextActions: { label: string; detail: string; href: string; tone?: string }[];
  quickLinks: { label: string; href: string }[];
};

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function stamp(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ClientProfile({ profile: initial }: { profile: Profile }) {
  const router = useRouter();
  const profile = initial;
  const [name, setName] = useState(initial.customer.name);
  const [email, setEmail] = useState(initial.customer.email);
  const [phone, setPhone] = useState(initial.customer.phone);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetCreds, setResetCreds] = useState<{ plannerId: string; password: string } | null>(null);

  const save = async () => {
    if (!profile.permissions.canWrite) return;
    setBusy(true);
    setStatus("");
    try {
      await api(`/api/admin/clients/${profile.customer.id}`, {
        method: "PATCH",
        body: { name, email, phone },
      });
      setStatus("Contact saved.");
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const merge = async (customerId: string) => {
    if (!profile.permissions.canWrite) return;
    if (!window.confirm("Merge this duplicate into the current client? Their events and leads move here.")) return;
    setBusy(true);
    setStatus("");
    try {
      await api(`/api/admin/clients/${profile.customer.id}/merge`, { body: { customerId } });
      setStatus("Customers merged.");
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetPlanner = async (plannerId: string) => {
    if (!profile.permissions.canPlanner) return;
    if (!window.confirm("Reset the client planner password? They will need the new code to sign in.")) return;
    setBusy(true);
    setStatus("");
    setResetCreds(null);
    try {
      const body = await api<{ password?: string }>(`/api/admin/planner/${plannerId}`, {
        method: "PATCH",
        body: { resetPassword: true },
      });
      if (body.password) setResetCreds({ plannerId, password: body.password });
      setStatus("Planner password reset.");
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const { customer, permissions, finance } = profile;

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="of-crm-header">
          <div>
            <p className="of-ecr-kicker">Client · Directory</p>
            <h1>{customer.name}</h1>
            <p className="of-ecr-meta">
              {customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : <span>No email</span>}
              {customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : null}
              <span>{profile.events.length} event{profile.events.length === 1 ? "" : "s"}</span>
              <span>{profile.leads.length} lead{profile.leads.length === 1 ? "" : "s"}</span>
            </p>
          </div>
          <div className="of-crm-header-actions">
            {profile.quickLinks.map((link) => (
              <a className="pl-btn sm ghost" href={link.href} key={link.href + link.label}>{link.label}</a>
            ))}
          </div>
        </header>

        {status ? <p className={`of-state${status.includes("saved") || status.includes("merged") || status.includes("reset") ? "" : " of-state-error"}`} role="status">{status}</p> : null}

        {profile.nextActions.length ? (
          <section className="of-panel of-client-next">
            <div className="of-panel-head"><h2>Next actions</h2></div>
            <div className="of-client-actions">
              {profile.nextActions.map((action) => (
                <a
                  className={`of-queue-row${action.tone === "urgent" ? " is-urgent" : action.tone === "warn" ? " is-warn" : ""}`}
                  href={action.href}
                  key={`${action.label}-${action.href}`}
                >
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <div className="of-client-grid">
          <section className="of-panel">
            <div className="of-panel-head"><h2>Contact</h2></div>
            {permissions.canWrite ? (
              <div className="of-client-form">
                <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
                <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></label>
                <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
                <p className="of-client-fine">
                  Marketing: {customer.marketingOptIn == null ? "Not answered" : customer.marketingOptIn ? "Opted in" : "Opted out"}
                </p>
                <button className="pl-btn sm" type="button" disabled={busy} onClick={save}>Save contact</button>
              </div>
            ) : (
              <dl className="of-ecr-dl">
                <div><dt>Name</dt><dd>{customer.name}</dd></div>
                <div><dt>Email</dt><dd>{customer.email || "—"}</dd></div>
                <div><dt>Phone</dt><dd>{customer.phone || "—"}</dd></div>
              </dl>
            )}
          </section>

          {finance ? (
            <section className="of-panel">
              <div className="of-panel-head"><h2>Balances</h2></div>
              <div className="of-client-kpis">
                <div><small>Outstanding</small><strong>{money(finance.balanceCents)}</strong></div>
                <div><small>Paid</small><strong>{money(finance.paidCents)}</strong></div>
                <div><small>Open due</small><strong>{money(finance.dueCents)}</strong></div>
              </div>
              {!finance.hasLedger ? <p className="pl-empty">No invoices or payments yet.</p> : null}
            </section>
          ) : null}
        </div>

        <section className="of-panel">
          <div className="of-panel-head"><h2>Active & upcoming bookings</h2></div>
          {profile.activeBookings.length ? (
            <div className="of-table-wrap">
              <table className="of-table">
                <thead><tr><th>Event</th><th>Date</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {profile.activeBookings.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.name}</strong></td>
                      <td><small>{row.eventDate || "TBD"}</small></td>
                      <td><span className="of-pill">{row.bookingStatus}</span></td>
                      <td className="of-row-actions"><a className="pl-btn sm ghost" href={row.href}>Open</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="pl-empty">No active or upcoming bookings.</p>}
        </section>

        <section className="of-panel">
          <div className="of-panel-head"><h2>Event history</h2></div>
          {profile.events.length ? (
            <div className="of-table-wrap">
              <table className="of-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Booking</th>
                    {permissions.showPayments ? <th>Balance</th> : null}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {profile.events.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.name}</strong></td>
                      <td><small>{row.eventType}</small></td>
                      <td><small>{row.eventDate || "TBD"}</small></td>
                      <td><small>{row.bookingStatus || row.eventStatus}</small></td>
                      {permissions.showPayments ? (
                        <td><small>{row.balanceCents == null ? "—" : money(row.balanceCents)}</small></td>
                      ) : null}
                      <td className="of-row-actions"><a className="pl-btn sm ghost" href={row.href}>Control room</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="pl-empty">No events linked yet.</p>}
        </section>

        <div className="of-client-grid">
          {permissions.showProposals ? (
            <section className="of-panel">
              <div className="of-panel-head"><h2>Quotes</h2></div>
              {profile.quotes.length ? profile.quotes.map((row) => (
                <a className="of-queue-row" href={row.href} key={row.id}>
                  <strong>{row.title}</strong>
                  <small>{row.eventName} · {row.status}{row.kind ? ` · ${row.kind}` : ""}</small>
                </a>
              )) : <p className="pl-empty">No quotes yet.</p>}
            </section>
          ) : null}

          {permissions.showContracts ? (
            <section className="of-panel">
              <div className="of-panel-head"><h2>Contracts</h2></div>
              {profile.contracts.length ? profile.contracts.map((row) => (
                <a className="of-queue-row" href={row.href} key={row.id}>
                  <strong>{row.title}</strong>
                  <small>{row.eventName} · {row.status}{row.signedAt ? ` · signed ${stamp(row.signedAt)}` : ""}</small>
                </a>
              )) : <p className="pl-empty">No contracts yet.</p>}
            </section>
          ) : null}
        </div>

        {permissions.showPayments ? (
          <section className="of-panel">
            <div className="of-panel-head"><h2>Invoices & payments</h2></div>
            {profile.payments.length ? (
              <div className="of-table-wrap">
                <table className="of-table">
                  <thead><tr><th>Item</th><th>Event</th><th>Amount</th><th>Due</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {profile.payments.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.label}</strong></td>
                        <td><small>{row.eventName}</small></td>
                        <td>{money(row.amountCents)}</td>
                        <td><small>{row.dueOn ? stamp(row.dueOn) : "—"}</small></td>
                        <td><span className="of-pill">{row.status}</span></td>
                        <td className="of-row-actions"><a className="pl-btn sm ghost" href={row.href}>Open</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="pl-empty">No payment schedule yet.</p>}
          </section>
        ) : null}

        <div className="of-client-grid">
          <section className="of-panel">
            <div className="of-panel-head"><h2>Leads</h2></div>
            {profile.leads.length ? profile.leads.map((lead) => (
              <a className="of-queue-row" href={lead.href} key={lead.id}>
                <strong>{lead.name}</strong>
                <small>{lead.stage} · {lead.eventType}{lead.eventDate ? ` · ${lead.eventDate}` : ""}</small>
              </a>
            )) : <p className="pl-empty">No open leads linked.</p>}
          </section>

          {permissions.showTasks ? (
            <section className="of-panel">
              <div className="of-panel-head"><h2>Follow-ups</h2></div>
              {profile.followUps.length ? profile.followUps.map((task) => (
                <a className={`of-queue-row${task.overdue ? " is-urgent" : ""}`} href={task.href} key={task.id}>
                  <strong>{task.done ? "✓ " : ""}{task.title}</strong>
                  <small>
                    {task.context}
                    {task.dueOn ? ` · ${stamp(task.dueOn)}` : ""}
                    {task.assigneeName ? ` · ${task.assigneeName}` : ""}
                  </small>
                </a>
              )) : <p className="pl-empty">No follow-ups yet.</p>}
            </section>
          ) : null}
        </div>

        <section className="of-panel">
          <div className="of-panel-head">
            <h2>Internal notes</h2>
            <span className="of-client-fine">Staff only · never shown in the client planner</span>
          </div>
          {profile.internalNotes.length ? profile.internalNotes.map((note) => (
            <div className="of-client-note" key={note.leadId + note.createdAt}>
              <strong><a href={`/admin/leads/${note.leadId}`}>{note.leadName}</a></strong>
              <p>{note.body}</p>
            </div>
          )) : <p className="pl-empty">No internal lead notes.</p>}
        </section>

        <section className="of-panel">
          <div className="of-panel-head"><h2>Planner access</h2></div>
          {profile.plannerAccess.length ? (
            <div className="of-table-wrap">
              <table className="of-table">
                <thead><tr><th>Event</th><th>Code</th><th>Access</th><th /></tr></thead>
                <tbody>
                  {profile.plannerAccess.map((row) => (
                    <tr key={row.plannerId}>
                      <td><strong>{row.eventName}</strong></td>
                      <td><code>{row.code || "—"}</code></td>
                      <td>
                        <small>
                          {row.hasPassword ? "Client login set" : "No client password"}
                          {row.hasGuestAccess ? " · Guest access on" : ""}
                        </small>
                        {resetCreds?.plannerId === row.plannerId ? (
                          <p className="of-client-cred" role="status">New password: <code>{resetCreds.password}</code></p>
                        ) : null}
                      </td>
                      <td className="of-row-actions">
                        <a className="pl-btn sm ghost" href={row.href}>Open</a>
                        {row.resetAllowed ? (
                          <button className="pl-btn sm ghost" type="button" disabled={busy} onClick={() => resetPlanner(row.plannerId)}>
                            Reset password
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="pl-empty">No planner portals linked.</p>}
        </section>

        {permissions.showComms ? (
          <section className="of-panel">
            <div className="of-panel-head"><h2>Communication history</h2></div>
            {profile.communications.length ? profile.communications.map((row) => (
              <div className="of-queue-row" key={row.id}>
                <strong>{row.label}</strong>
                <small>{row.channel} · {row.status} · {stamp(row.createdAt)}{row.detail ? ` · ${row.detail}` : ""}</small>
              </div>
            )) : <p className="pl-empty">No messages logged yet.</p>}
          </section>
        ) : null}

        {profile.duplicates.length ? (
          <section className="of-panel" id="duplicates">
            <div className="of-panel-head"><h2>Possible duplicates</h2></div>
            <p className="of-client-fine">Same email, or phone-only matches with no email. Merge moves events and leads here, then removes the duplicate record.</p>
            {profile.duplicates.map((row) => (
              <div className="of-client-dup" key={row.id}>
                <div>
                  <strong><a href={`/admin/clients/${row.id}`}>{row.name}</a></strong>
                  <small>
                    {[row.email, row.phone].filter(Boolean).join(" · ") || "No contact"}
                    {" · "}{row.reason} match · {row.eventCount} events · {row.leadCount} leads
                  </small>
                </div>
                {permissions.canWrite ? (
                  <button className="pl-btn sm ghost" type="button" disabled={busy} onClick={() => merge(row.id)}>
                    Merge into this client
                  </button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
