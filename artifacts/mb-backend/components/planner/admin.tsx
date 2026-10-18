"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { documentTemplates, fillMergeTags, money, namedEventTypes, planningBlockIds, type AdminData, type PlannerData } from "@/lib/planner";
import { AdminBooking } from "./calendar";
import { EventFinance } from "./finance-admin";
import { EventOperations } from "@/components/operations/event-operations";
import { api, Empty, Field, fmtDate, newId, RowTools, Section, Text, useListOps } from "./ui";
import * as S from "./sections";

// ---------- Event list + create ----------

type ListItem = { id: string; code: string; updatedAt: string; clientNames: string; eventType: string; eventDate: string; venueName: string; unread: number; pending: number; dueCents?: number | null; paidCents?: number | null; balanceCents?: number | null };
type Lead = { id: string; name: string; email: string; phone: string; event_type: string; event_date: string | null; guest_count: string | null; location: string | null; venue_name: string | null };

export function AdminPlannerList({ leads }: { leads: Lead[] }) {
  const [events, setEvents] = useState<ListItem[] | null>(null);
  const [moneySource, setMoneySource] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [creds, setCreds] = useState<{ id: string; code: string; password: string } | null>(null);
  const blank = { clientNames: "", email: "", phone: "", eventType: "Wedding", eventDate: "", venueName: "", guestCount: "", leadId: "" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(() => api<{ events: ListItem[]; moneySource: string | null }>("/api/admin/planner").then((r) => { setEvents(r.events); setMoneySource(r.moneySource); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const fromLead = (id: string) => {
    const l = leads.find((x) => x.id === id);
    if (!l) return setForm({ ...form, leadId: "" });
    setForm({ clientNames: l.name, email: l.email, phone: l.phone, eventType: l.event_type, eventDate: l.event_date ?? "", venueName: l.venue_name || l.location || "", guestCount: l.guest_count ?? "", leadId: l.id });
  };
  // /admin/planner?lead=<id> (from a lead profile) pre-fills the create form.
  useEffect(() => {
    const leadId = new URLSearchParams(window.location.search).get("lead");
    const l = leadId ? leads.find((x) => x.id === leadId) : undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time prefill from the URL after hydration
    if (l) setForm({ clientNames: l.name, email: l.email, phone: l.phone, eventType: l.event_type, eventDate: l.event_date ?? "", venueName: l.venue_name || l.location || "", guestCount: l.guest_count ?? "", leadId: l.id });
  }, [leads]);
  const shown = (events ?? []).filter((e) => !q || `${e.clientNames} ${e.code} ${e.eventType} ${e.venueName}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="of-ecr-list-header">
          <h1>Events & bookings</h1>
          <p>Create a client portal, then open the Event Control Room for booking, planning, guests, and payments.</p>
        </header>

        {creds && (
          <div className="pl-creds" role="status">
            Portal created.<br />
            Link: <code>{window.location.origin}/planner?code={creds.code}</code><br />
            {process.env.NODE_ENV !== "development" && <>Password: <code>{creds.password}</code><br /></>}
            <button className="pl-btn sm" onClick={() => navigator.clipboard.writeText(process.env.NODE_ENV === "development" ? `${window.location.origin}/planner?code=${creds.code}` : `Your MB Events planner is ready!\n${window.location.origin}/planner\nEvent code: ${creds.code}\nPassword: ${creds.password}`)}>Copy message</button>{" "}
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
                {[...namedEventTypes].map((t) => <option key={t}>{t}</option>)}
                {form.eventType && !(namedEventTypes as readonly string[]).includes(form.eventType) && <option>{form.eventType}</option>}
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

        <Section eyebrow="All events" title={`${events?.length ?? 0} client portal${events?.length === 1 ? "" : "s"}`} actions={<input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />}>
          {error && <p className="pl-warn">{error}</p>}
          <div className="pl-card" style={{ overflowX: "auto" }}>
            {events === null ? <Empty>Loading...</Empty> : shown.length ? (
              <>
              {moneySource === "ledger" && <p className="pl-intro">Due, paid, and balance use the payment ledger only: the sent quote, succeeded payments, refunds, and cancellation credits.</p>}
              <table className="pl-admin-table">
                <thead><tr><th>Client</th><th>Event</th><th>Date</th><th>Venue</th><th>Code</th>{moneySource === "ledger" && <><th>Due</th><th>Paid</th><th>Balance</th></>}<th>Inbox</th><th>Updated</th></tr></thead>
                <tbody>
                  {shown.map((e) => (
                    <tr key={e.id}>
                      <td><a href={`/admin/planner/${e.id}`}>{e.clientNames || "Unnamed"}</a></td>
                      <td>{e.eventType}</td>
                      <td>{fmtDate(e.eventDate) || "TBD"}</td>
                      <td>{e.venueName}</td>
                      <td><code>{e.code}</code></td>
                      {moneySource === "ledger" && <><td>{e.dueCents == null ? "—" : money(e.dueCents / 100)}</td><td>{e.paidCents == null ? "—" : money(e.paidCents / 100)}</td><td>{e.balanceCents == null ? "—" : money(e.balanceCents / 100)}</td></>}
                      <td>{e.unread > 0 && <span className="pl-tag bad">{e.unread} new</span>} {e.pending > 0 && <span className="pl-tag">{e.pending} requests</span>}</td>
                      <td>{fmtDate(e.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
            ) : <Empty>No client portals yet.</Empty>}
          </div>
        </Section>
      </div>
    </div>
  );
}

type TemplateDraft = {
  id: string;
  eventType: string;
  name: string;
  checklist: { text: string; due: string }[];
  timeline: { time: string; what: string }[];
  dances: { moment: string }[];
  blocks: string[];
  published: boolean;
};

const blockLabel: Record<string, string> = {
  details: "Details",
  forms: "Planning form",
  songs: "Music",
  requests: "Guest requests",
  timeline: "Timeline",
  checklist: "Checklist",
  guests: "Guests",
  team: "Team",
  documents: "Documents",
  payments: "Payments",
  messages: "Messages",
  evaluation: "Evaluation",
};

function linesOf(items: { text?: string; due?: string; time?: string; what?: string; moment?: string }[], kind: "checklist" | "timeline" | "dances") {
  if (kind === "checklist") return items.map((item) => item.due ? `${item.text} | ${item.due}` : item.text ?? "").join("\n");
  if (kind === "timeline") return items.map((item) => item.time ? `${item.time} | ${item.what}` : item.what ?? "").join("\n");
  return items.map((item) => item.moment ?? "").join("\n");
}

function parseChecklist(text: string) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [label, due = ""] = line.split("|").map((part) => part.trim());
    return { text: label, due };
  });
}

function parseTimeline(text: string) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [time, what = ""] = line.split("|").map((part) => part.trim());
    return line.includes("|") ? { time, what } : { time: "", what: time };
  });
}

function parseDances(text: string) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((moment) => ({ moment }));
}

export function TemplatesPanel() {
  const [templates, setTemplates] = useState<TemplateDraft[] | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ templates: TemplateDraft[] }>("/api/admin/planner/templates").then((r) => setTemplates(r.templates)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await api(`/api/admin/planner/templates/${draft.id}`, { method: "PATCH", body: draft });
      setDraft(null);
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section eyebrow="Templates" title="Planning templates" intro="New portals copy the published template for that event type. Editing one does not change a portal that already exists.">
      {error && <p className="pl-warn">{error}</p>}
      <div className="pl-add">
        <button className="pl-btn ghost" onClick={async () => {
          setBusy(true);
          try {
            const created = await api<TemplateDraft>("/api/admin/planner/templates", { body: { eventType: "Wedding", name: "Wedding planning", published: false } });
            setDraft(created);
            await load();
          } catch (e) {
            alert((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>New template</button>
      </div>
      <div className="pl-card" style={{ overflowX: "auto" }}>
        {templates === null ? <Empty>Loading...</Empty> : templates.length ? (
          <table className="pl-admin-table">
            <thead><tr><th>Name</th><th>Event</th><th>Status</th><th /></tr></thead>
            <tbody>
              {templates.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.eventType}</td>
                  <td>{item.published ? "Published" : "Draft"}</td>
                  <td><button className="pl-btn sm ghost" onClick={() => setDraft(item)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No templates yet.</Empty>}
      </div>
      {draft && (
        <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Name"><Text value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} /></Field>
          <Field label="Event type">
            <select value={draft.eventType} onChange={(e) => setDraft({ ...draft, eventType: e.target.value })}>
              {[...namedEventTypes].map((t) => <option key={t}>{t}</option>)}
              {!(namedEventTypes as readonly string[]).includes(draft.eventType) && <option>{draft.eventType}</option>}
            </select>
          </Field>
          <Field label="Checklist (task | when)" wide><Text area value={linesOf(draft.checklist, "checklist")} onChange={(v) => setDraft({ ...draft, checklist: parseChecklist(v) })} /></Field>
          <Field label="Timeline (time | what)" wide><Text area value={linesOf(draft.timeline, "timeline")} onChange={(v) => setDraft({ ...draft, timeline: parseTimeline(v) })} /></Field>
          <Field label="Dance moments" wide><Text area value={linesOf(draft.dances, "dances")} onChange={(v) => setDraft({ ...draft, dances: parseDances(v) })} /></Field>
          <div className="wide">
            <div className="pl-k">Sections</div>
            {planningBlockIds.map((block) => (
              <label className="pl-check" key={block}>
                <input type="checkbox" checked={draft.blocks.includes(block)} onChange={(e) => setDraft({ ...draft, blocks: e.target.checked ? [...draft.blocks, block] : draft.blocks.filter((item) => item !== block) })} />
                {blockLabel[block]}
              </label>
            ))}
          </div>
          <label className="pl-check"><input type="checkbox" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} /> Published</label>
          <div className="wide pl-add">
            <button className="pl-btn" disabled={busy}>{busy ? "Saving..." : "Save template"}</button>
            <button className="pl-btn ghost" type="button" onClick={() => setDraft(null)}>Close</button>
          </div>
        </form>
      )}
    </Section>
  );
}

// ---------- Single event manager ----------

type AdminBundle = Omit<S.Bundle, "paymentsOnline"> & {
  id: string;
  eventId?: string | null;
  leadId: string | null;
};

type Room =
  | "overview"
  | "client"
  | "timeline"
  | "music"
  | "staff"
  | "equipment"
  | "guests"
  | "documents"
  | "payments"
  | "activity";

/** Stable room ids for deep links (`?room=`). Labels match Control Room IA. */
const ROOM_GROUPS: { label: string; rooms: readonly [Room, string][] }[] = [
  { label: "Overview", rooms: [["overview", "Overview"]] },
  {
    label: "Planning",
    rooms: [
      ["client", "Planning"],
      ["music", "Music"],
      ["timeline", "Timeline"],
    ],
  },
  { label: "Guests", rooms: [["guests", "Guests"]] },
  {
    label: "Staff & equipment",
    rooms: [
      ["staff", "Staff"],
      ["equipment", "Equipment"],
    ],
  },
  {
    label: "Finances & files",
    rooms: [
      ["payments", "Finances"],
      ["documents", "Files"],
      ["activity", "Activity"],
    ],
  },
];

const ROOMS: readonly [Room, string][] = ROOM_GROUPS.flatMap((group) => group.rooms);

type WorkflowSnap = {
  bookingStatus: string;
  nextAction: string;
  leadId: string | null;
  customerId: string | null;
  proposalStatus: string | null;
  depositStatus: string;
  depositLabel: string | null;
  depositAmountCents: number | null;
  depositDueOn: string | null;
  holdUntil: string | null;
  holdExpired: boolean;
  coordinatorName: string;
  eventDate: string | null;
  startTime: string;
  endTime: string;
  venueName: string;
  location: string;
  eventType: string;
  name: string;
};

type TrackStep = { id: string; label: string; done: boolean; current: boolean };

function isRoom(value: string | null): value is Room {
  return ROOMS.some(([id]) => id === value);
}

function roomFor(name: string): Room {
  const alias: Record<string, Room> = {
    Checklist: "timeline",
    Payments: "payments",
    "Invoice & payments": "payments",
    Finances: "payments",
    proposal: "payments",
    Proposal: "payments",
    quote: "payments",
    Documents: "documents",
    Files: "documents",
    Messages: "activity",
    Music: "music",
    "Guest requests": "music",
    Guests: "guests",
    Timeline: "timeline",
    Details: "client",
    Access: "client",
    Planning: "client",
    "Planning form": "client",
    Team: "guests",
    Evaluation: "documents",
    Overview: "overview",
    booking: "overview",
  };
  return alias[name] ?? (isRoom(name) ? name : "overview");
}

/** Visual sales track from real workflow fields — not a separate status system. */
function buildTrack(wf: WorkflowSnap | null, readiness: string): TrackStep[] {
  const labels = [
    "Inquiry", "Date hold", "Quote", "Quote accepted", "Deposit due",
    "Owner approval", "Confirmed booking", "Planning", "Completed",
  ];
  if (!wf) {
    return labels.map((label, i) => ({ id: String(i), label, done: false, current: i === 0 }));
  }
  const confirmed = wf.bookingStatus === "confirmed" || wf.bookingStatus === "completed";
  const completed = wf.bookingStatus === "completed";
  const holdDone = confirmed || (!!wf.holdUntil && !wf.holdExpired);
  const quoteSent = !!wf.proposalStatus && wf.proposalStatus !== "draft";
  const quoteAccepted = wf.proposalStatus === "accepted";
  const depositDone = wf.depositStatus === "paid" || (confirmed && wf.depositStatus !== "due");
  const steps: TrackStep[] = [
    { id: "inquiry", label: "Inquiry", done: true, current: false },
    { id: "hold", label: "Date hold", done: holdDone, current: false },
    { id: "quote", label: "Quote", done: quoteSent, current: false },
    { id: "accepted", label: "Quote accepted", done: quoteAccepted, current: false },
    { id: "deposit", label: "Deposit due", done: depositDone, current: false },
    { id: "approval", label: "Owner approval", done: confirmed, current: false },
    { id: "confirmed", label: "Confirmed booking", done: confirmed, current: false },
    { id: "planning", label: "Planning", done: confirmed && (readiness === "ready" || completed), current: false },
    { id: "completed", label: "Completed", done: completed, current: false },
  ];
  const firstOpen = steps.find((step) => !step.done);
  if (firstOpen) firstOpen.current = true;
  else if (steps.length) steps[steps.length - 1]!.current = true;
  return steps;
}

function nextActionButtons(
  wf: WorkflowSnap | null,
  readiness: string,
  canWriteBookings: boolean,
  plannerId: string,
  bookingEventId: string | null,
) {
  if (!wf) return [] as { label: string; href?: string; room?: Room; primary?: boolean }[];
  const actions: { label: string; href?: string; room?: Room; primary?: boolean }[] = [];
  const confirmed = wf.bookingStatus === "confirmed" || wf.bookingStatus === "completed";
  if (!wf.eventDate) actions.push({ label: "Set event date", room: "overview", primary: true });
  else if (!(confirmed || (!!wf.holdUntil && !wf.holdExpired))) {
    actions.push({ label: "Set date hold", room: "overview", primary: true });
  } else if (!wf.proposalStatus || wf.proposalStatus === "draft") {
    actions.push({ label: "Send / review quote", room: "payments", primary: true });
  } else if (wf.proposalStatus === "sent") {
    actions.push({ label: "Review sent quote", room: "payments", primary: true });
  } else if (wf.proposalStatus === "accepted" && wf.depositStatus === "due") {
    actions.push({ label: "Review deposit", room: "payments", primary: true });
  } else if (!confirmed && canWriteBookings) {
    actions.push({ label: "Confirm booking (owner)", room: "overview", primary: true });
  } else if (!confirmed && !canWriteBookings) {
    actions.push({ label: "Owner approval required", room: "overview", primary: true });
  } else if (confirmed && readiness !== "ready") {
    actions.push({ label: "Assign staff", room: "staff", primary: true });
    actions.push({ label: "Reserve equipment", room: "equipment" });
    actions.push({ label: "Complete planning checklist", room: "timeline" });
  } else if (confirmed) {
    actions.push({ label: "Open timeline", room: "timeline", primary: true });
    actions.push({ label: "Manage guests", room: "guests" });
  }
  if (wf.leadId) actions.push({ label: "Open CRM lead", href: `/admin/leads/${wf.leadId}` });
  const calId = bookingEventId || plannerId;
  actions.push({ label: "Open calendar", href: `/admin/calendar?event=${encodeURIComponent(calId)}` });
  actions.push({ label: "MB Invites", href: "/admin/invitations" });
  return actions;
}

export function AdminPlannerEvent({ id }: { id: string }) {
  const [b, setB] = useState<AdminBundle | null>(null);
  const [error, setError] = useState("");
  const [room, setRoom] = useState<Room>("overview");
  const [save, setSave] = useState("");
  const [templates, setTemplates] = useState<{ id: string; name: string; eventType: string }[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowSnap | null>(null);
  const [readiness, setReadiness] = useState("unset");
  const [canWriteBookings, setCanWriteBookings] = useState(false);
  const [canReadPayments, setCanReadPayments] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const bookingEventId = b?.eventId || null;

  const load = useCallback(async () => {
    try {
      setB(await api<AdminBundle>(`/api/admin/planner/${id}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the request resolves
    load();
  }, [load]);
  useEffect(() => {
    api<{ templates: { id: string; name: string; eventType: string }[] }>("/api/admin/planner/templates").then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);
  useEffect(() => {
    api<{ permissions: Record<string, boolean> }>("/api/admin/session")
      .then((body) => {
        setCanWriteBookings(body.permissions["bookings.write"] === true);
        setCanReadPayments(body.permissions["payments.read"] === true);
      })
      .catch(() => {
        setCanWriteBookings(false);
        setCanReadPayments(false);
      });
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- room comes from the URL after hydration
    const params = new URLSearchParams(window.location.search);
    const value = params.get("room");
    if (value) setRoom(roomFor(value));
    if (params.get("focus") === "booking" && !value) setRoom("overview");
  }, []);
  useEffect(() => {
    const calendarId = bookingEventId || id;
    Promise.all([
      api<{
        bookingStatus: string;
        name: string;
        eventType: string;
        eventDate: string | null;
        startTime: string;
        endTime: string;
        venueName: string;
        location: string;
        coordinatorName: string;
        holdUntil: string | null;
        holdExpired: boolean;
        workflow: {
          nextAction: string;
          leadId: string | null;
          customerId: string | null;
          proposalStatus: string | null;
          depositStatus: string;
          depositLabel: string | null;
          depositAmountCents: number | null;
          depositDueOn: string | null;
          holdUntil: string | null;
          holdExpired: boolean;
          bookingStatus: string;
        };
      }>(`/api/admin/calendar/${calendarId}`).catch(() => null),
      api<{ readiness: string }>(`/api/admin/operations?eventId=${encodeURIComponent(calendarId)}`).catch(() => null),
    ]).then(([booking, ops]) => {
      if (ops?.readiness) setReadiness(ops.readiness);
      if (!booking?.workflow) return;
      const wf = booking.workflow;
      setWorkflow({
        bookingStatus: booking.bookingStatus,
        nextAction: wf.nextAction || "",
        leadId: wf.leadId,
        customerId: wf.customerId,
        proposalStatus: wf.proposalStatus,
        depositStatus: wf.depositStatus,
        depositLabel: wf.depositLabel,
        depositAmountCents: wf.depositAmountCents,
        depositDueOn: wf.depositDueOn,
        holdUntil: booking.holdUntil ?? wf.holdUntil,
        holdExpired: booking.holdExpired ?? wf.holdExpired,
        coordinatorName: booking.coordinatorName || "",
        eventDate: booking.eventDate,
        startTime: booking.startTime || "",
        endTime: booking.endTime || "",
        venueName: booking.venueName || "",
        location: booking.location || "",
        eventType: booking.eventType || "",
        name: booking.name || "",
      });
    });
  }, [id, bookingEventId, save]);

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
          const merge = <T extends { id: string }>(mine: T[], theirs: T[]) => [...mine.map((m) => theirs.find((t) => t.id === m.id) ?? m), ...theirs.filter((t) => !mine.some((m) => m.id === t.id))];
          setB((x) => (x ? { ...x, admin: { ...x.admin, documents: merge(x.admin.documents, locked.documents), payments: merge(x.admin.payments, locked.payments) } } : x));
        })
        .catch(() => {});
    }, 700);
  }, [patch]);

  if (error) {
    return (
      <div className="pl">
        <div className="pl-wrap">
          <p className="of-state of-state-error" role="alert">{error}</p>
          <a className="pl-btn sm ghost" href="/admin/planner">Back to events</a>
        </div>
      </div>
    );
  }
  if (!b) {
    return (
      <div className="pl">
        <div className="pl-wrap"><p className="of-state" role="status">Loading control room…</p></div>
      </div>
    );
  }

  const openRoom = (name: string) => {
    const next = roomFor(name);
    setRoom(next);
    const url = new URL(window.location.href);
    url.searchParams.set("room", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };
  const shared = { bundle: { ...b, paymentsOnline: false }, set: setSection, reload: load, go: openRoom };
  const badges: Partial<Record<Room, number>> = {
    activity: b.messages.filter((m) => m.sender === "client" && !m.read_at).length,
    music: b.requests.filter((r) => r.status === "pending").length,
  };
  const d = b.data.details;
  const opsId = bookingEventId || id;
  const leadId = b.leadId || workflow?.leadId || null;
  const eventTitle = workflow?.name || d.clientNames || "Event";
  const clientName = d.clientNames || "Unnamed client";
  const when = [fmtDate(workflow?.eventDate || d.eventDate), [workflow?.startTime, workflow?.endTime].filter(Boolean).join("–")].filter(Boolean).join(" · ");
  const place = [workflow?.venueName || d.venueName, workflow?.location || d.address].filter(Boolean).join(" · ");
  const readinessLabel = readiness === "ready" ? "Ready" : readiness === "not_ready" ? "Not ready" : "Unset";
  const track = buildTrack(workflow, readiness);
  const actions = nextActionButtons(workflow, readiness, canWriteBookings, id, bookingEventId);

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="of-ecr-header">
          <div className="of-ecr-header-top">
            <div>
              <p className="of-ecr-kicker">Event control room · <span className="of-mono">{b.code}</span></p>
              <h1>{eventTitle}</h1>
              <p className="of-ecr-meta">
                <span>{clientName}</span>
                {(workflow?.eventType || d.eventType) ? <span>{workflow?.eventType || d.eventType}</span> : null}
                {when ? <span>{when}</span> : <span>Date TBD</span>}
                {place ? <span>{place}</span> : null}
                {workflow?.coordinatorName ? <span>Coordinator: {workflow.coordinatorName}</span> : null}
              </p>
            </div>
            <div className="of-ecr-header-actions">
              {leadId ? <a className="pl-btn sm ghost" href={`/admin/leads/${leadId}`}>CRM lead</a> : null}
              <a className="pl-btn sm ghost" href={`/admin/calendar?event=${encodeURIComponent(opsId)}`}>Calendar</a>
              <a className="pl-btn sm ghost" href="/admin/clients">Clients</a>
              <a className="pl-btn sm ghost" href={`/admin/planner/${id}/operations`}>Full operations</a>
              <a className="pl-btn sm" href="/admin/planner">All events</a>
            </div>
          </div>

          <div className="of-control-strip">
            <span className={`of-pill of-pill-${workflow?.bookingStatus || "unknown"}`}>Booking: {workflow?.bookingStatus || "…"}</span>
            <span className={`of-pill of-pill-${readiness || "unset"}`}>Ops: {readinessLabel}</span>
            {workflow?.proposalStatus ? <span className="of-pill">Quote: {workflow.proposalStatus}</span> : null}
            {workflow?.depositStatus && workflow.depositStatus !== "none" ? <span className="of-pill">Deposit: {workflow.depositStatus}</span> : null}
            {workflow?.nextAction ? <span className="of-next"><strong>Next:</strong> {workflow.nextAction}</span> : null}
            {save ? <span className="of-save">{save}</span> : null}
          </div>

          <ol className="of-ecr-track" aria-label="Booking workflow">
            {track.map((step) => (
              <li key={step.id} className={`${step.done ? "is-done" : ""}${step.current ? " is-current" : ""}`}>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
          <p className="of-ecr-fine">Visual progress only. Quote acceptance and deposit payment never confirm a booking — owner confirmation does.</p>
        </header>

        <nav className="of-ecr-nav" aria-label="Event sections">
          {ROOM_GROUPS.map((group) => (
            <div className="of-ecr-nav-group" key={group.label}>
              <p className="of-ecr-nav-label">{group.label}</p>
              <div className="of-rooms">
                {group.rooms.map(([roomId, label]) => (
                  <button
                    key={roomId}
                    type="button"
                    className={`of-surface${room === roomId ? " is-on" : ""}`}
                    aria-current={room === roomId ? "true" : undefined}
                    onClick={() => openRoom(roomId)}
                  >
                    {label}
                    {!!badges[roomId] && <span className="of-badge">{badges[roomId]}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <main className="pl-main of-ecr-main">
          {room === "overview" && (
            <>
              <section className="of-panel of-ecr-actions">
                <div className="of-panel-head">
                  <h2>Next actions</h2>
                </div>
                <p className="of-ecr-fine">{workflow?.nextAction || "Loading next action…"}</p>
                <div className="of-ecr-action-row">
                  {actions.map((action) => (
                    action.href ? (
                      <a key={action.label} className={action.primary ? "pl-btn sm" : "pl-btn sm ghost"} href={action.href}>{action.label}</a>
                    ) : (
                      <button key={action.label} type="button" className={action.primary ? "pl-btn sm" : "pl-btn sm ghost"} onClick={() => action.room && openRoom(action.room)}>{action.label}</button>
                    )
                  ))}
                </div>
              </section>

              <AdminBooking eventId={opsId} part="booking" />

              <div className="of-ecr-grid">
                <section className="of-panel">
                  <div className="of-panel-head"><h2>Important dates</h2></div>
                  <dl className="of-ecr-dl">
                    <div><dt>Event</dt><dd>{when || "TBD"}</dd></div>
                    <div><dt>Hold</dt><dd>{workflow?.holdUntil ? `${workflow.holdExpired ? "Expired" : "Until"} ${workflow.holdUntil.slice(0, 16).replace("T", " ")}` : "None"}</dd></div>
                    <div><dt>Deposit due</dt><dd>{workflow?.depositDueOn || (workflow?.depositStatus === "due" ? "On ledger" : "—")}</dd></div>
                  </dl>
                </section>
                <section className="of-panel">
                  <div className="of-panel-head"><h2>Readiness</h2><a href={`/admin/planner/${id}/operations`}>Open</a></div>
                  <p><span className={`of-pill of-pill-${readiness}`}>{readinessLabel}</span></p>
                  <EventOperations eventId={opsId} embedded slice="readiness" />
                </section>
              </div>

              <div className="pl-card">
                <div className="pl-k">Planning template</div>
                <div className="pl-add">
                  <select value={templateId} aria-label="Planning template" onChange={(e) => setTemplateId(e.target.value)}>
                    <option value="">Choose a template</option>
                    {templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.eventType}</option>)}
                  </select>
                  <button className="pl-btn ghost" disabled={!templateId} onClick={() => {
                    if (!confirm("Apply this template to empty sections? Saved answers stay.")) return;
                    patch({ applyTemplate: templateId }).then(() => load()).catch((e) => alert((e as Error).message));
                  }}>Apply to empty sections</button>
                </div>
              </div>
              <S.Overview {...shared} />
              <div className="of-panel" style={{ marginTop: 14 }}>
                <div className="of-panel-head"><h2>Recent activity</h2></div>
                <AdminBooking eventId={opsId} part="history" />
              </div>
            </>
          )}
          {room === "client" && (
            <>
              <S.Details {...shared} />
              <S.PlanningForm {...shared} />
              <S.Checklist {...shared} />
              <AdminMessages b={b} reload={load} />
              <AdminAccess b={b} setAdmin={setAdmin} patch={patch} reload={load} />
            </>
          )}
          {room === "timeline" && (
            <>
              <div className="of-panel of-tl-note no-print" style={{ marginBottom: 14 }}>
                <div className="of-panel-head">
                  <h2>Event schedule</h2>
                </div>
                <p className="of-ecr-fine">
                  This is the same run-of-show stored on the planner event. Staff briefs and the client portal read these moments — there is no separate copy.
                  Use templates from the Planning room to seed by event type. Print for a paper schedule.
                </p>
              </div>
              <S.Timeline {...shared} />
              <EventOperations eventId={opsId} embedded slice="site" />
            </>
          )}
          {room === "music" && (
            <>
              <S.Music {...shared} />
              <AdminRequests b={b} setAdmin={setAdmin} patch={patch} reload={load} />
            </>
          )}
          {room === "staff" && <EventOperations eventId={opsId} embedded slice="staff" />}
          {room === "equipment" && <EventOperations eventId={opsId} embedded slice="equipment" />}
          {room === "guests" && (
            <>
              <div className="of-panel" style={{ marginBottom: 14 }}>
                <div className="of-panel-head">
                  <h2>Invitations</h2>
                  <a href="/admin/invitations">MB Invites</a>
                </div>
                <p className="of-ecr-fine">Guest directory, RSVP filters, check-in, and the seating planner live here and under MB Invites.</p>
              </div>
              <S.Guests {...shared} />
              <S.Team {...shared} />
              <EventOperations eventId={opsId} embedded slice="vendors" />
            </>
          )}
          {room === "documents" && (
            <>
              <AdminDocuments b={b} setAdmin={setAdmin} />
              <AdminEvaluation data={b.data} />
            </>
          )}
          {room === "payments" && (
            canReadPayments
              ? <AdminInvoice eventId={opsId} admin={b.admin} setAdmin={setAdmin} reload={load} />
              : <p className="of-state of-state-error" role="alert">You do not have permission to view financial data.</p>
          )}
          {room === "activity" && (
            <>
              <AdminMessages b={b} reload={load} />
              <AdminBooking eventId={opsId} part="history" />
              <EventOperations eventId={opsId} embedded slice="incidents" />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function AdminInvoice({ eventId, admin, setAdmin, reload }: { eventId: string; admin: AdminData; setAdmin: (a: AdminData) => void; reload: () => Promise<void> }) {
  const items = useListOps(admin.lineItems, (lineItems) => setAdmin({ ...admin, lineItems }));
  const pays = useListOps(admin.payments, (payments) => setAdmin({ ...admin, payments }));
  return (
    <Section eyebrow="Invoice" title="Ledger, budget & planner document" intro="Office, customer, and reports use the payment ledger above. Event costs and profit appear only from recorded rows — never invented. The planner document below is a draft schedule only — it cannot mark money paid. Use Offline payment or Stripe TEST MODE on the ledger, or run a dry-run reconcile before migrating historical rows. Live Stripe is not enabled.">
      <EventFinance eventId={eventId} onChange={reload} />
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

      <h3 className="pl-h3">Planner draft schedule (not the ledger)</h3>
      <p className="pl-intro">Status stays due here. Paid money is recorded only on the ledger with Stripe evidence or an authorized offline entry.</p>
      <div className="pl-table">
        {!!admin.payments.length && (
          <div className="pl-tr pl-thead" style={{ gridTemplateColumns: "1.4fr 110px 150px 110px 1fr 36px" }}>
            <span>Label</span><span>Amount</span><span>Due date</span><span>Status</span><span>Method / reference</span><span />
          </div>
        )}
        {admin.payments.map((p) => (
          <div className="pl-tr" key={p.id} style={{ gridTemplateColumns: "1.4fr 110px 150px 110px 1fr auto" }}>
            <input value={p.label} placeholder="Label" onChange={(e) => pays.update(p.id, { label: e.target.value })} />
            <input type="number" min={0} step="0.01" value={p.amount} aria-label="Amount" onChange={(e) => pays.update(p.id, { amount: Number(e.target.value) || 0 })} />
            <input type="date" value={p.due} aria-label="Due date" onChange={(e) => pays.update(p.id, { due: e.target.value })} />
            <select value="due" disabled aria-label="Status">
              <option value="due">Due (ledger records paid)</option>
            </select>
            <input value={p.method} placeholder="Draft note / reference" onChange={(e) => pays.update(p.id, { method: e.target.value, ref: e.target.value, status: "due", paidAt: "" })} />
            <RowTools onRemove={() => confirm("Remove this draft row?") && pays.remove(p.id)} />
          </div>
        ))}
      </div>
      <div className="pl-add">
        <button className="pl-btn ghost" onClick={() => pays.add({ id: newId(), label: admin.payments.length ? "Final payment" : "Scheduled payment", amount: 0, due: "", status: "due", paidAt: "", method: "", ref: "" })}>Add draft schedule row</button>
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
      <p className="pl-intro">Guest link: <code>{b.guestPath}</code> · {b.admin.guestRequestsOpen ? "Open" : "Closed"}. Approved songs are added to the client&apos;s music list automatically.</p>
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

function AdminAccess({ b, setAdmin, patch, reload }: { b: AdminBundle; setAdmin: (a: AdminData) => void; patch: (body: object) => Promise<unknown>; reload: () => Promise<void> }) {
  const [shown, setShown] = useState("");
  return (
    <Section eyebrow="Access" title="Logins & settings">
      <div className="pl-card">
        <div className="pl-row"><span className="t">Client planner</span><a href={`/planner?code=${b.code}`}>{b.code}</a></div>
        {process.env.NODE_ENV !== "development" && <div className="pl-row"><span className="t">Client password</span><button className="pl-btn sm ghost" onClick={async () => {
          if (!confirm("Reset the client's password? They will be signed out everywhere.")) return;
          const r = (await patch({ resetPassword: true })) as { password?: string };
          if (r.password) setShown(`New client password: ${r.password}`);
        }}>Reset password</button></div>}
        <div className="pl-row"><span className="t">Guest requests</span><a href={`/planner/guest?code=${b.guestCode}`}>{b.guestCode}</a><button className="pl-btn sm ghost" onClick={async () => {
          if (!confirm("Issue a new guest link? Old guest links stop working. Share the new link from the client portal.")) return;
          const r = (await patch({ resetGuest: true })) as { guestPassword?: string; guestPath?: string };
          await reload();
          if (r.guestPath) setShown(`New guest link: ${r.guestPath}. Do not put passwords in URLs.`);
          else setShown("Guest access rotated. Share the new guest link from the client portal.");
        }}>Reset guest access</button></div>
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
