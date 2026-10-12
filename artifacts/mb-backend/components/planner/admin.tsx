"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { documentTemplates, fillMergeTags, money, totals, type AdminData, type PlannerData } from "@/lib/planner";
import { api, Empty, Field, fmtDate, newId, RowTools, Section, Text, useListOps } from "./ui";
import * as S from "./sections";
import { AdminSignOut } from "@/components/admin-auth";

// ---------- Event list + create ----------

type ListItem = { id: string; code: string; updatedAt: string; clientNames: string; eventType: string; eventDate: string; venueName: string; unread: number; pending: number };
type Lead = { id: string; name: string; email: string; phone: string; event_type: string; event_date: string | null; guest_count: string | null; location: string | null };

export function AdminPlannerList({ leads }: { leads: Lead[] }) {
  const [events, setEvents] = useState<ListItem[] | null>(null);
  const [error, setError] = useState("");
  const [creds, setCreds] = useState<{ id: string; code: string; password: string } | null>(null);
  const blank = { clientNames: "", email: "", phone: "", eventType: "Wedding", eventDate: "", venueName: "", guestCount: "", leadId: "" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(() => api<{ events: ListItem[] }>("/api/admin/planner").then((r) => setEvents(r.events)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const fromLead = (id: string) => {
    const l = leads.find((x) => x.id === id);
    if (!l) return setForm({ ...form, leadId: "" });
    setForm({ clientNames: l.name, email: l.email, phone: l.phone, eventType: l.event_type, eventDate: l.event_date ?? "", venueName: l.location ?? "", guestCount: l.guest_count ?? "", leadId: l.id });
  };
  // /admin/planner?lead=<id> (from a lead profile) pre-fills the create form.
  useEffect(() => {
    const leadId = new URLSearchParams(window.location.search).get("lead");
    const l = leadId ? leads.find((x) => x.id === leadId) : undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time prefill from the URL after hydration
    if (l) setForm({ clientNames: l.name, email: l.email, phone: l.phone, eventType: l.event_type, eventDate: l.event_date ?? "", venueName: l.location ?? "", guestCount: l.guest_count ?? "", leadId: l.id });
  }, [leads]);
  const shown = (events ?? []).filter((e) => !q || `${e.clientNames} ${e.code} ${e.eventType} ${e.venueName}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="pl">
      <div className="pl-wrap">
        <div className="pl-top"><a href="/admin/leads">← Leads</a><span>MB Admin · Client planners</span><span><a href="/admin/staff">Staff</a> · <a href="/">Website ↗</a> · <AdminSignOut /></span></div>
        <header className="pl-hero"><h1>Client planners</h1><p className="pl-intro">Create a portal for each booked client, then manage their music, timeline, documents, and payments.</p></header>

        {creds && (
          <div className="pl-creds" role="status">
            Portal created. Send these to the client (the password is shown only once):<br />
            Link: <code>{window.location.origin}/planner</code><br />
            Event code: <code>{creds.code}</code><br />
            Password: <code>{creds.password}</code><br />
            <button className="pl-btn sm" onClick={() => navigator.clipboard.writeText(`Your MB Events planner is ready!\n${window.location.origin}/planner\nEvent code: ${creds.code}\nPassword: ${creds.password}`)}>Copy message</button>{" "}
            <a className="pl-btn sm ghost" href={`/admin/planner/${creds.id}`}>Open planner</a>
          </div>
        )}

        <Section eyebrow="New" title="Create a client portal">
          <form
            className="pl-card pl-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                setCreds(await api<{ id: string; code: string; password: string }>("/api/admin/planner", { body: form }));
                setForm(blank);
                load();
              } catch (err) {
                alert((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {!!leads.length && (
              <Field label="Start from a lead (optional)" wide>
                <select value={form.leadId} onChange={(e) => fromLead(e.target.value)}>
                  <option value="">None</option>
                  {leads.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.event_type}{l.event_date ? ` · ${l.event_date}` : ""}</option>)}
                </select>
              </Field>
            )}
            <Field label="Client name(s)"><Text value={form.clientNames} onChange={(v) => setForm({ ...form, clientNames: v })} /></Field>
            <Field label="Event type">
              <select value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })}>
                {["Wedding", "Sweet 16", "Quinceañera", "Bar / Bat Mitzvah", "Birthday", "Corporate", "School Event", "Private Party", "Other"].map((t) => <option key={t}>{t}</option>)}
                {form.eventType && !["Wedding", "Sweet 16", "Quinceañera", "Bar / Bat Mitzvah", "Birthday", "Corporate", "School Event", "Private Party", "Other"].includes(form.eventType) && <option>{form.eventType}</option>}
              </select>
            </Field>
            <Field label="Email"><Text type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} /></Field>
            <Field label="Phone"><Text type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></Field>
            <Field label="Event date"><Text type="date" value={form.eventDate} onChange={(v) => setForm({ ...form, eventDate: v })} /></Field>
            <Field label="Venue"><Text value={form.venueName} onChange={(v) => setForm({ ...form, venueName: v })} /></Field>
            <Field label="Guests"><Text value={form.guestCount} onChange={(v) => setForm({ ...form, guestCount: v })} /></Field>
            <div className="wide"><button className="pl-btn" disabled={busy || form.clientNames.trim().length < 2}>{busy ? "Creating..." : "Create portal"}</button></div>
          </form>
        </Section>

        <Section eyebrow="All planners" title={`${events?.length ?? 0} client portal${events?.length === 1 ? "" : "s"}`} actions={<input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />}>
          {error && <p className="pl-warn">{error}</p>}
          <div className="pl-card" style={{ overflowX: "auto" }}>
            {events === null ? <Empty>Loading...</Empty> : shown.length ? (
              <table className="pl-admin-table">
                <thead><tr><th>Client</th><th>Event</th><th>Date</th><th>Venue</th><th>Code</th><th>Inbox</th><th>Updated</th></tr></thead>
                <tbody>
                  {shown.map((e) => (
                    <tr key={e.id}>
                      <td><a href={`/admin/planner/${e.id}`}>{e.clientNames || "Unnamed"}</a></td>
                      <td>{e.eventType}</td>
                      <td>{fmtDate(e.eventDate) || "TBD"}</td>
                      <td>{e.venueName}</td>
                      <td><code>{e.code}</code></td>
                      <td>{e.unread > 0 && <span className="pl-tag bad">{e.unread} new</span>} {e.pending > 0 && <span className="pl-tag">{e.pending} requests</span>}</td>
                      <td>{fmtDate(e.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>No client portals yet.</Empty>}
          </div>
        </Section>
      </div>
    </div>
  );
}

// ---------- Single event manager ----------

type AdminBundle = Omit<S.Bundle, "paymentsOnline"> & { id: string; leadId: string | null };

const ADMIN_TABS = ["Overview", "Invoice & payments", "Documents", "Messages", "Guest requests", "Details", "Planning form", "Music", "Timeline", "Checklist", "Guests", "Team", "Evaluation", "Access"] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

export function AdminPlannerEvent({ id }: { id: string }) {
  const [b, setB] = useState<AdminBundle | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<AdminTab>("Overview");
  const [save, setSave] = useState("");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    try {
      setB(await api<AdminBundle>(`/api/admin/planner/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the request resolves
    load();
  }, [load]);

  const patch = useCallback(async (body: object) => {
    setSave("Saving...");
    try {
      const r = await api<Record<string, unknown>>(`/api/admin/planner/${id}`, { method: "PATCH", body });
      setSave("Saved");
      return r;
    } catch (e) {
      setSave(`Not saved: ${(e as Error).message}`);
      throw e;
    }
  }, [id]);

  // Same debounced pattern as the client portal so admins can edit any section.
  const setSection = useCallback(<K extends keyof PlannerData>(section: K, value: PlannerData[K]) => {
    setB((x) => (x ? { ...x, data: { ...x.data, [section]: value } } : x));
    clearTimeout(timers.current[section]);
    setSave("Saving...");
    timers.current[section] = setTimeout(() => {
      delete timers.current[section];
      patch({ section, value }).catch(() => {});
    }, 700);
  }, [patch]);

  const setAdmin = useCallback((next: AdminData) => {
    setB((x) => (x ? { ...x, admin: next } : x));
    clearTimeout(timers.current.admin);
    setSave("Saving...");
    timers.current.admin = setTimeout(() => {
      delete timers.current.admin;
      patch({ admin: next })
        .then((r) => {
          const locked = (r as { locked?: Pick<AdminData, "documents" | "payments"> }).locked;
          if (!locked || (!locked.documents.length && !locked.payments.length)) return;
          // Pull in signatures / card payments that landed while this tab was open.
          const merge = <T extends { id: string }>(mine: T[], theirs: T[]) => [...mine.map((m) => theirs.find((t) => t.id === m.id) ?? m), ...theirs.filter((t) => !mine.some((m) => m.id === t.id))];
          setB((x) => (x ? { ...x, admin: { ...x.admin, documents: merge(x.admin.documents, locked.documents), payments: merge(x.admin.payments, locked.payments) } } : x));
        })
        .catch(() => {});
    }, 700);
  }, [patch]);

  if (error) return <div className="pl pl-center"><p className="pl-warn">{error}</p><a href="/admin/planner">Back</a></div>;
  if (!b) return <div className="pl pl-center"><p className="pl-sub">Loading...</p></div>;

  const shared = { bundle: { ...b, paymentsOnline: false }, set: setSection, reload: load, go: (t: string) => setTab(t as AdminTab) };
  const badges: Partial<Record<AdminTab, number>> = {
    Messages: b.messages.filter((m) => m.sender === "client" && !m.read_at).length,
    "Guest requests": b.requests.filter((r) => r.status === "pending").length,
  };
  const d = b.data.details;

  return (
    <div className="pl">
      <div className="pl-wrap">
        <div className="pl-top"><a href="/admin/planner">← All planners</a><span className="pl-save">{save}</span><span>{b.code}</span></div>
        <header className="pl-hero">
          <div className="pl-k">MB Admin · {d.eventType}</div>
          <h1>{d.clientNames || "Unnamed client"}</h1>
          <div className="pl-sub">{[fmtDate(d.eventDate), d.venueName, d.phone, d.email].filter(Boolean).join(" · ")}</div>
          {b.leadId && <a href={`/admin/leads/${b.leadId}`}>View original lead</a>}
        </header>
        <div className="pl-layout">
          <nav className="pl-nav">
            {ADMIN_TABS.map((t) => (
              <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
                {t}
                {!!badges[t] && <b>{badges[t]}</b>}
              </button>
            ))}
          </nav>
          <main className="pl-main">
            {tab === "Overview" && <S.Overview {...shared} />}
            {tab === "Invoice & payments" && <AdminInvoice admin={b.admin} setAdmin={setAdmin} />}
            {tab === "Documents" && <AdminDocuments b={b} setAdmin={setAdmin} />}
            {tab === "Messages" && <AdminMessages b={b} reload={load} />}
            {tab === "Guest requests" && <AdminRequests b={b} setAdmin={setAdmin} patch={patch} reload={load} />}
            {tab === "Details" && <S.Details {...shared} />}
            {tab === "Planning form" && <S.PlanningForm {...shared} />}
            {tab === "Music" && <S.Music {...shared} />}
            {tab === "Timeline" && <S.Timeline {...shared} />}
            {tab === "Checklist" && <S.Checklist {...shared} />}
            {tab === "Guests" && <S.Guests {...shared} />}
            {tab === "Team" && <S.Team {...shared} />}
            {tab === "Evaluation" && <AdminEvaluation data={b.data} />}
            {tab === "Access" && <AdminAccess b={b} setAdmin={setAdmin} patch={patch} />}
          </main>
        </div>
      </div>
    </div>
  );
}

function AdminInvoice({ admin, setAdmin }: { admin: AdminData; setAdmin: (a: AdminData) => void }) {
  const items = useListOps(admin.lineItems, (lineItems) => setAdmin({ ...admin, lineItems }));
  const pays = useListOps(admin.payments, (payments) => setAdmin({ ...admin, payments }));
  const t = totals(admin);
  return (
    <Section eyebrow="Invoice" title={`${money(t.total)} total · ${money(t.balance)} due`} intro="Changes appear in the client's portal immediately.">
      <div className="pl-form">
        <Field label="Package name"><Text value={admin.packageName} onChange={(v) => setAdmin({ ...admin, packageName: v })} /></Field>
        <Field label="Tax rate %"><input type="number" min={0} max={30} step="0.001" value={admin.taxRate} onChange={(e) => setAdmin({ ...admin, taxRate: Number(e.target.value) || 0 })} /></Field>
      </div>
      <h3 className="pl-h3">Line items (packages & add-ons)</h3>
      <div className="pl-table">
        {!!admin.lineItems.length && (
          <div className="pl-tr pl-thead" style={{ gridTemplateColumns: "2fr 80px 120px 110px 92px" }}>
            <span>Description</span><span>Qty</span><span>Unit price</span><span>Amount</span><span />
          </div>
        )}
        {admin.lineItems.map((i) => (
          <div className="pl-tr" key={i.id} style={{ gridTemplateColumns: "2fr 80px 120px 110px auto" }}>
            <input value={i.description} placeholder="Description" onChange={(e) => items.update(i.id, { description: e.target.value })} />
            <input type="number" min={0} value={i.qty} aria-label="Quantity" onChange={(e) => items.update(i.id, { qty: Number(e.target.value) || 0 })} />
            <input type="number" min={0} step="0.01" value={i.price} aria-label="Price" onChange={(e) => items.update(i.id, { price: Number(e.target.value) || 0 })} />
            <span>{money(i.qty * i.price)}</span>
            <RowTools onUp={() => items.move(i.id, -1)} onDown={() => items.move(i.id, 1)} onRemove={() => items.remove(i.id)} />
          </div>
        ))}
      </div>
      <button className="pl-btn ghost" onClick={() => items.add({ id: newId(), description: "", qty: 1, price: 0 })}>Add line item</button>

      <h3 className="pl-h3">Payment schedule</h3>
      <div className="pl-table">
        {!!admin.payments.length && (
          <div className="pl-tr pl-thead" style={{ gridTemplateColumns: "1.4fr 110px 150px 110px 1fr 36px" }}>
            <span>Label</span><span>Amount</span><span>Due date</span><span>Status</span><span>Method / reference</span><span />
          </div>
        )}
        {admin.payments.map((p) => (
          <div className="pl-tr" key={p.id} style={{ gridTemplateColumns: "1.4fr 110px 150px 110px 1fr auto" }}>
            <input value={p.label} placeholder="Label (Deposit, Final payment)" onChange={(e) => pays.update(p.id, { label: e.target.value })} />
            <input type="number" min={0} step="0.01" value={p.amount} aria-label="Amount" onChange={(e) => pays.update(p.id, { amount: Number(e.target.value) || 0 })} />
            <input type="date" value={p.due} aria-label="Due date" onChange={(e) => pays.update(p.id, { due: e.target.value })} />
            <select value={p.status} onChange={(e) => pays.update(p.id, { status: e.target.value as "due" | "paid", paidAt: e.target.value === "paid" ? p.paidAt || new Date().toISOString().slice(0, 10) : "" })}>
              <option value="due">Due</option>
              <option value="paid">Paid</option>
            </select>
            <input value={p.method} placeholder="Method / reference (check #, Zelle...)" onChange={(e) => pays.update(p.id, { method: e.target.value })} />
            <RowTools onRemove={() => confirm("Remove this payment?") && pays.remove(p.id)} />
          </div>
        ))}
      </div>
      <div className="pl-add">
        <button className="pl-btn ghost" onClick={() => pays.add({ id: newId(), label: admin.payments.length ? "Final payment" : "Deposit", amount: Math.max(0, admin.payments.length ? Math.round((t.total - admin.payments.reduce((n, x) => n + x.amount, 0)) * 100) / 100 : Math.round(t.total * 0.3)), due: "", status: "due", paidAt: "", method: "", ref: "" })}>Add scheduled payment</button>
        <button className="pl-btn ghost" onClick={() => pays.add({ id: newId(), label: "Payment received", amount: 0, due: "", status: "paid", paidAt: new Date().toISOString().slice(0, 10), method: "", ref: "" })}>Record a payment</button>
      </div>
    </Section>
  );
}

function AdminDocuments({ b, setAdmin }: { b: AdminBundle; setAdmin: (a: AdminData) => void }) {
  const docs = b.admin.documents;
  const [open, setOpen] = useState<string | null>(docs[0]?.id ?? null);
  const [preview, setPreview] = useState(false);
  const doc = docs.find((d) => d.id === open);
  const update = (patch: Partial<AdminData["documents"][number]>) => setAdmin({ ...b.admin, documents: docs.map((d) => (d.id === open ? { ...d, ...patch } : d)) });
  const create = (title: string, body: string) => {
    const next = { id: newId(), title, body, status: "draft" as const, createdAt: new Date().toISOString(), signedName: "", signature: "", signedAt: "", signedIp: "" };
    setAdmin({ ...b.admin, documents: [...docs, next] });
    setOpen(next.id);
  };
  return (
    <Section eyebrow="Documents" title="Contracts, invoices & letters" intro="Merge tags: {{client_name}} {{event_type}} {{event_date}} {{start_time}} {{end_time}} {{venue}} {{guest_count}} {{package}} {{line_items}} {{total}} {{paid}} {{balance}} {{today}}">
      <div className="pl-add">
        {documentTemplates.map((t) => <button key={t.title} className="pl-btn ghost" onClick={() => create(t.title, t.body)}>New {t.title}</button>)}
        <button className="pl-btn ghost" onClick={() => create("Untitled document", "")}>Blank document</button>
      </div>
      <div className="pl-doclist" style={{ marginTop: 14 }}>
        {docs.map((d) => (
          <button key={d.id} className={`pl-card pl-docbtn ${open === d.id ? "on" : ""}`} onClick={() => setOpen(d.id)}>
            <strong>{d.title}</strong>
            <span className={`pl-tag ${d.status === "signed" ? "ok" : ""}`}>{d.status === "signed" ? `Signed ${fmtDate(d.signedAt)}` : d.status === "sent" ? "Awaiting signature" : "Draft (hidden from client)"}</span>
          </button>
        ))}
        {!docs.length && <Empty>No documents yet.</Empty>}
      </div>
      {doc && (
        <div className="pl-card pl-doc">
          {doc.status === "signed" ? (
            <>
              <pre>{doc.body}</pre>
              <div className="pl-signed">
                {/* eslint-disable-next-line @next/next/no-img-element -- signature is a data URL */}
                <img src={doc.signature} alt={`Signature of ${doc.signedName}`} />
                <div>Signed by {doc.signedName} · {new Date(doc.signedAt).toLocaleString("en-US")} · IP {doc.signedIp || "unknown"}</div>
              </div>
              <button className="pl-btn ghost" onClick={() => window.print()}>Print / save as PDF</button>
            </>
          ) : (
            <>
              <div className="pl-form">
                {doc.status === "sent" && <p className="pl-warn wide">Sent to the client. Recall it to draft before editing so they never sign a changing document.</p>}
                <Field label="Title" wide><input value={doc.title} readOnly={doc.status === "sent"} onChange={(e) => update({ title: e.target.value })} /></Field>
                <Field label="Body" wide><textarea rows={18} value={doc.body} readOnly={doc.status === "sent"} onChange={(e) => update({ body: e.target.value })} /></Field>
              </div>
              <div className="pl-add">
                <button className="pl-btn ghost" onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Preview with client details"}</button>
                {doc.status === "draft" ? <button className="pl-btn" onClick={() => update({ status: "sent" })}>Send to client for signature</button> : <button className="pl-btn ghost" onClick={() => update({ status: "draft" })}>Recall to draft</button>}
                <button className="pl-btn danger" onClick={() => { if (confirm("Delete this document?")) { setAdmin({ ...b.admin, documents: docs.filter((d) => d.id !== doc.id) }); setOpen(null); } }}>Delete</button>
              </div>
              {preview && <pre style={{ marginTop: 14 }}>{fillMergeTags(doc.body, b.data, b.admin)}</pre>}
            </>
          )}
        </div>
      )}
    </Section>
  );
}

function AdminMessages({ b, reload }: { b: AdminBundle; reload: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Section eyebrow="Messages" title="Client thread">
      <div className="pl-card pl-thread">
        {b.messages.length ? b.messages.map((m) => (
          <div key={m.id} className={`pl-msg ${m.sender === "mb" ? "client" : "mb"}`}>
            <div>{m.body}</div>
            <small>{m.sender === "mb" ? "MB Events" : b.data.details.clientNames || "Client"} · {new Date(m.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}{m.sender === "mb" && (m.read_at ? " · Read" : " · Unread")}</small>
          </div>
        )) : <Empty>No messages yet.</Empty>}
      </div>
      <div className="pl-add">
        <textarea rows={3} value={text} placeholder="Reply to the client" onChange={(e) => setText(e.target.value)} />
        <button className="pl-btn" disabled={busy || !text.trim()} onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/admin/planner/${b.id}/messages`, { body: { body: text } });
            setText("");
            await reload();
          } catch (e) {
            alert((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>{busy ? "Sending..." : "Send reply"}</button>
      </div>
    </Section>
  );
}

function AdminRequests({ b, setAdmin, patch, reload }: { b: AdminBundle; setAdmin: (a: AdminData) => void; patch: (body: object) => Promise<unknown>; reload: () => Promise<void> }) {
  return (
    <Section eyebrow="Guest requests" title={`${b.requests.length} requests`} actions={<button className="pl-btn ghost" onClick={() => setAdmin({ ...b.admin, guestRequestsOpen: !b.admin.guestRequestsOpen })}>{b.admin.guestRequestsOpen ? "Close requests" : "Reopen requests"}</button>}>
      <p className="pl-intro">Guest link: <code>/planner/guest?code={b.guestCode}&amp;pw={b.guestPassword}</code> · {b.admin.guestRequestsOpen ? "Open" : "Closed"}. Approved songs are added to the client&apos;s music list automatically.</p>
      <div className="pl-card">
        {b.requests.length ? b.requests.map((r) => (
          <div className="pl-row" key={r.id}>
            <span className="t"><strong>{r.title}</strong> <small>{r.artist}</small><br /><small>from {r.guest_name}{r.note && ` · "${r.note}"`}</small></span>
            <span className={`pl-tag ${r.status === "approved" ? "ok" : r.status === "declined" ? "bad" : ""}`}>{r.status}</span>
            <span className="pl-rowtools">
              {(["approved", "declined", "pending"] as const).map((s) => <button key={s} onClick={() => patch({ request: { id: r.id, status: s } }).then(reload).catch(() => {})}>{s}</button>)}
            </span>
          </div>
        )) : <Empty>No guest requests yet.</Empty>}
      </div>
    </Section>
  );
}

function AdminEvaluation({ data }: { data: PlannerData }) {
  const e = data.evaluation;
  return (
    <Section eyebrow="Evaluation" title={e?.submittedAt ? `Received ${fmtDate(e.submittedAt)}` : "Not submitted yet"}>
      {e?.submittedAt ? (
        <div className="pl-card">
          {Object.entries(e.ratings).map(([k, v]) => <div className="pl-row" key={k}><span className="t">{k}</span><span className="pl-stars">{"★".repeat(v)}{"☆".repeat(5 - v)}</span></div>)}
          <p>{e.recommend ? "Would recommend MB Events." : "Would not recommend."}</p>
          {e.comments && <div className="pl-note">{e.comments}</div>}
        </div>
      ) : <Empty>The client can submit feedback from the Evaluation tab in their portal.</Empty>}
    </Section>
  );
}

function AdminAccess({ b, setAdmin, patch }: { b: AdminBundle; setAdmin: (a: AdminData) => void; patch: (body: object) => Promise<unknown> }) {
  const [shown, setShown] = useState("");
  return (
    <Section eyebrow="Access" title="Logins & settings">
      <div className="pl-card">
        <div className="pl-row"><span className="t">Client event code</span><code>{b.code}</code></div>
        <div className="pl-row"><span className="t">Client password</span><button className="pl-btn sm ghost" onClick={async () => {
          if (!confirm("Reset the client's password? They will be signed out everywhere.")) return;
          const r = (await patch({ resetPassword: true })) as { password?: string };
          if (r.password) setShown(`New client password: ${r.password}`);
        }}>Reset password</button></div>
        <div className="pl-row"><span className="t">Guest code / password</span><code>{b.guestCode} / {b.guestPassword}</code><button className="pl-btn sm ghost" onClick={async () => {
          if (!confirm("Reset the guest password? Guests will need the new one.")) return;
          const r = (await patch({ resetGuest: true })) as { guestPassword?: string };
          if (r.guestPassword) setShown(`New guest password: ${r.guestPassword}`);
        }}>Reset guest password</button></div>
        {shown && <div className="pl-creds">{shown}</div>}
      </div>
      <Field label="Note pinned to the client's overview" wide>
        <Text area value={b.admin.noteForClient} onChange={(v) => setAdmin({ ...b.admin, noteForClient: v })} />
      </Field>
      <h3 className="pl-h3">Danger zone</h3>
      <button className="pl-btn danger" onClick={async () => {
        if (!confirm(`Permanently delete ${b.data.details.clientNames}'s planner, messages, and guest requests? This cannot be undone.`)) return;
        try {
          await api(`/api/admin/planner/${b.id}`, { method: "DELETE" });
          window.location.assign(new URL("/admin/planner", window.location.href));
        } catch (e) {
          alert((e as Error).message);
        }
      }}>Delete planner</button>
    </Section>
  );
}
