"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Field, Text } from "@/components/planner/ui";

const profileTypes = ["dj", "mc", "dancer", "coordinator", "technician", "other"] as const;

type RosterItem = {
  id: string;
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  profileType: string;
  active: boolean;
  hasLogin: boolean;
  skills: string[];
  upcomingAssignments: number;
  openBlocks: number;
  conflictCount: number;
  rateCents: number | null;
};

type Profile = RosterItem & {
  canSeeContact: boolean;
  canWrite: boolean;
  money: boolean;
  assignments: {
    id: string;
    eventId: string;
    eventName: string;
    eventDate: string | null;
    roleLabel: string;
    status: string;
    callTime: string;
    startsAt: string | null;
    endsAt: string | null;
    internalNotes: string;
    payoutCents: number | null;
    href: string;
    blockConflict: boolean;
  }[];
  blocks: { id: string; startsAt: string; endsAt: string; note: string }[];
  tasks: { id: string; title: string; done: boolean; eventId: string; eventName: string; href: string }[];
  briefLinks: { eventId: string; eventName: string; href: string; operationsHref: string }[];
};

const blank = {
  name: "",
  email: "",
  phone: "",
  jobTitle: "",
  profileType: "other",
  skills: "",
  rateCents: "",
  active: true,
};

function roleLabel(type: string) {
  if (type === "dj") return "DJ";
  if (type === "mc") return "MC";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function CrewDesk({ initialPersonId = "" }: { initialPersonId?: string }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<RosterItem[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [money, setMoney] = useState(false);
  const [open, setOpen] = useState<Profile | null>(null);
  const [edit, setEdit] = useState(blank);
  const [create, setCreate] = useState(blank);
  const [showCreate, setShowCreate] = useState(false);
  const [block, setBlock] = useState({ startsAt: "", endsAt: "", note: "" });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback((query = q) => {
    api<{ people: RosterItem[]; canWrite: boolean; money: boolean }>(`/api/admin/crew?q=${encodeURIComponent(query)}`)
      .then((body) => {
        setPeople(body.people);
        setCanWrite(body.canWrite);
        setMoney(body.money);
        setError("");
      })
      .catch((reason: Error) => {
        setPeople([]);
        setError(reason.message);
      });
  }, [q]);

  useEffect(() => {
    const handle = setTimeout(() => load(q), 200);
    return () => clearTimeout(handle);
  }, [q, load]);

  const choose = useCallback(async (id: string) => {
    setError("");
    setStatus("");
    try {
      const body = await api<{ person: Profile }>(`/api/admin/crew/${id}`);
      setOpen(body.person);
      setEdit({
        name: body.person.name,
        email: body.person.email,
        phone: body.person.phone,
        jobTitle: body.person.jobTitle,
        profileType: body.person.profileType,
        skills: body.person.skills.join(", "),
        rateCents: body.person.rateCents === null || body.person.rateCents === undefined ? "" : String(body.person.rateCents),
        active: body.person.active,
      });
      const url = new URL(window.location.href);
      url.searchParams.set("person", id);
      url.searchParams.delete("tab");
      window.history.replaceState({}, "", url.toString());
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    if (initialPersonId) void choose(initialPersonId);
  }, [initialPersonId, choose]);

  const saveCreate = async () => {
    setError("");
    setStatus("");
    try {
      const body = await api<{ id: string; people: RosterItem[] }>("/api/admin/crew", {
        body: {
          ...create,
          skills: create.skills,
          rateCents: create.rateCents === "" ? null : Number(create.rateCents),
        },
      });
      setPeople(body.people);
      setCreate(blank);
      setShowCreate(false);
      setStatus("Person added to the roster. Login accounts are managed separately under Logins.");
      await choose(body.id);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const saveOpen = async () => {
    if (!open) return;
    setError("");
    setStatus("");
    try {
      const body = await api<{ person: Profile }>(`/api/admin/crew/${open.id}`, {
        method: "PATCH",
        body: {
          ...edit,
          skills: edit.skills,
          rateCents: money ? (edit.rateCents === "" ? null : Number(edit.rateCents)) : undefined,
        },
      });
      setOpen(body.person);
      setStatus("Roster profile saved.");
      load();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const sendBlock = async () => {
    if (!open) return;
    setError("");
    try {
      const body = await api<{ person: Profile }>(`/api/admin/crew/${open.id}`, {
        method: "PATCH",
        body: { action: "block", ...block },
      });
      setOpen(body.person);
      setBlock({ startsAt: "", endsAt: "", note: "" });
      load();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const removeBlock = async (blockId: string) => {
    if (!open) return;
    const body = await api<{ person: Profile }>(`/api/admin/crew/${open.id}`, {
      method: "PATCH",
      body: { action: "removeBlock", blockId },
    });
    setOpen(body.person);
    load();
  };

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="pl-hero">
          <div className="pl-k">Operations</div>
          <h1>Staff roster</h1>
          <p className="pl-intro">
            Directory of DJs, MCs, technicians, coordinators, and crew. Assignments and gear stay on each event&apos;s control room.
            Overlap checks are enforced when you book someone — staff is never required before owner booking confirmation.
          </p>
        </header>
        {error && <p className="pl-warn" role="alert">{error}</p>}
        {status && <p className="pl-intro">{status}</p>}

        <div className="of-toolbar">
          <input className="of-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role, email" aria-label="Search staff" />
          <a className="pl-btn ghost" href="/admin/planner">Events</a>
          {canWrite ? (
            <button type="button" className="pl-btn" onClick={() => setShowCreate((value) => !value)}>
              {showCreate ? "Close" : "Add person"}
            </button>
          ) : null}
        </div>

        {showCreate && canWrite ? (
          <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); void saveCreate(); }}>
            <Field label="Name"><Text value={create.name} onChange={(v) => setCreate({ ...create, name: v })} /></Field>
            <Field label="Email"><Text value={create.email} onChange={(v) => setCreate({ ...create, email: v })} /></Field>
            <Field label="Phone"><Text value={create.phone} onChange={(v) => setCreate({ ...create, phone: v })} /></Field>
            <Field label="Job title"><Text value={create.jobTitle} onChange={(v) => setCreate({ ...create, jobTitle: v })} /></Field>
            <Field label="Role">
              <select value={create.profileType} onChange={(e) => setCreate({ ...create, profileType: e.target.value })}>
                {profileTypes.map((type) => <option key={type} value={type}>{roleLabel(type)}</option>)}
              </select>
            </Field>
            <Field label="Skills" wide><Text value={create.skills} onChange={(v) => setCreate({ ...create, skills: v })} placeholder="Comma-separated" /></Field>
            {money ? <Field label="Rate (cents)"><Text value={create.rateCents} onChange={(v) => setCreate({ ...create, rateCents: v })} /></Field> : null}
            <div className="wide"><button className="pl-btn" disabled={!create.name.trim()}>Save to roster</button></div>
          </form>
        ) : null}

        {!people.length && !error ? <p className="pl-empty">Loading…</p> : null}
        {people.length ? (
          <div className="of-table-wrap">
            <table className="of-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Schedule</th>
                  <th>Conflicts</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.id} className={open?.id === person.id ? "is-active" : ""}>
                    <td>
                      <button type="button" className="of-linkish" onClick={() => void choose(person.id)}>
                        <strong>{person.name}</strong>
                      </button>
                      {!person.active ? <small> · Inactive</small> : null}
                      {person.hasLogin ? <small> · Login</small> : null}
                    </td>
                    <td>{roleLabel(person.profileType)}{person.jobTitle ? ` · ${person.jobTitle}` : ""}</td>
                    <td>{person.upcomingAssignments} upcoming · {person.openBlocks} blocks</td>
                    <td>{person.conflictCount ? <span className="pl-warn">{person.conflictCount} block overlap</span> : "Clear"}</td>
                    <td>{[person.email, person.phone].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {open ? (
          <section className="of-panel" style={{ marginTop: 18 }}>
            <div className="of-panel-head">
              <h2>{open.name}</h2>
              <button type="button" className="pl-btn ghost" onClick={() => setOpen(null)}>Close</button>
            </div>
            {open.conflictCount ? (
              <p className="pl-warn" role="status">Availability block overlaps {open.conflictCount} assignment{open.conflictCount === 1 ? "" : "s"}. Overlapping event shifts are still blocked by the booking engine.</p>
            ) : null}

            {open.canWrite ? (
              <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); void saveOpen(); }}>
                <Field label="Name"><Text value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} /></Field>
                <Field label="Email"><Text value={edit.email} onChange={(v) => setEdit({ ...edit, email: v })} /></Field>
                <Field label="Phone"><Text value={edit.phone} onChange={(v) => setEdit({ ...edit, phone: v })} /></Field>
                <Field label="Job title"><Text value={edit.jobTitle} onChange={(v) => setEdit({ ...edit, jobTitle: v })} /></Field>
                <Field label="Role">
                  <select value={edit.profileType} onChange={(e) => setEdit({ ...edit, profileType: e.target.value })}>
                    {profileTypes.map((type) => <option key={type} value={type}>{roleLabel(type)}</option>)}
                  </select>
                </Field>
                <Field label="Skills" wide><Text value={edit.skills} onChange={(v) => setEdit({ ...edit, skills: v })} /></Field>
                {money ? <Field label="Rate (cents)"><Text value={edit.rateCents} onChange={(v) => setEdit({ ...edit, rateCents: v })} /></Field> : null}
                <label className="pl-row wide">
                  <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
                  <span className="t">Active on roster</span>
                </label>
                <div className="wide"><button className="pl-btn">Save profile</button></div>
              </form>
            ) : (
              <p className="pl-intro">
                {[open.email, open.phone, open.jobTitle].filter(Boolean).join(" · ") || "Contact hidden or not entered."}
                {" · "}{roleLabel(open.profileType)}
                {open.skills.length ? ` · ${open.skills.join(", ")}` : ""}
              </p>
            )}

            <h3 className="pl-h3">Event schedule</h3>
            <div className="pl-card">
              {open.assignments.length ? open.assignments.map((item) => (
                <div className="pl-row" key={item.id}>
                  <span className="t">
                    <a href={item.href}><strong>{item.eventName}</strong></a>
                    <small>
                      {" "}
                      {[item.roleLabel, item.status, item.eventDate, item.callTime ? `call ${item.callTime}` : "", item.startsAt ? `${item.startsAt} → ${item.endsAt}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                      {item.blockConflict ? " · Conflict with availability block" : ""}
                      {item.internalNotes ? ` · ${item.internalNotes}` : ""}
                    </small>
                  </span>
                </div>
              )) : <p className="pl-empty">No assignments yet.</p>}
            </div>

            <h3 className="pl-h3">Assigned tasks</h3>
            <div className="pl-card">
              {open.tasks.length ? open.tasks.map((task) => (
                <div className="pl-row" key={task.id}>
                  <span className="t">
                    <a href={task.href}>{task.title}</a>
                    <small> · {task.eventName}{task.done ? " · Done" : ""}</small>
                  </span>
                </div>
              )) : <p className="pl-empty">No checklist items assigned to this person.</p>}
            </div>

            <h3 className="pl-h3">Briefing & timeline</h3>
            <div className="pl-card">
              {open.briefLinks.length ? open.briefLinks.map((link) => (
                <div className="pl-row" key={link.eventId}>
                  <span className="t">
                    <strong>{link.eventName}</strong>
                    <small>
                      {" "}
                      <a href={link.href}>Staff room</a>
                      {" · "}
                      <a href={link.operationsHref}>Full operations</a>
                    </small>
                  </span>
                </div>
              )) : <p className="pl-empty">Assign this person to an event to open briefing and timeline from the control room.</p>}
            </div>

            <h3 className="pl-h3">Availability calendar</h3>
            {open.canWrite ? (
              <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); void sendBlock(); }}>
                <Field label="Unavailable from"><input type="datetime-local" value={block.startsAt} onChange={(e) => setBlock({ ...block, startsAt: e.target.value })} /></Field>
                <Field label="Unavailable until"><input type="datetime-local" value={block.endsAt} onChange={(e) => setBlock({ ...block, endsAt: e.target.value })} /></Field>
                <Field label="Note" wide><Text value={block.note} onChange={(v) => setBlock({ ...block, note: v })} /></Field>
                <div className="wide"><button className="pl-btn ghost" disabled={!block.startsAt || !block.endsAt}>Add block</button></div>
              </form>
            ) : null}
            <div className="pl-card">
              {open.blocks.length ? open.blocks.map((item) => (
                <div className="pl-row" key={item.id}>
                  <span className="t"><small>{item.startsAt} → {item.endsAt}{item.note ? ` · ${item.note}` : ""}</small></span>
                  {open.canWrite ? <button type="button" onClick={() => void removeBlock(item.id)}>Remove</button> : null}
                </div>
              )) : <p className="pl-empty">No availability blocks recorded.</p>}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
