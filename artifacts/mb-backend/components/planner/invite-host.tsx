"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, Empty, Section } from "./ui";

type Question = { id: string; label: string };
type Invitation = {
  slug: string;
  title: string;
  message: string;
  mode: "public" | "private" | "invite_only";
  published: boolean;
  plusOneCap: number;
  rsvpDeadline: string | null;
  involvesMinors: boolean;
  theme: { color: string; accent: string; image: string };
  questions: Question[];
};
type Guest = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  partySize: number;
  table: string;
  tableId: string | null;
  seats: number;
  isMinor: boolean;
  rsvp: string;
  plusOnes: number;
  note: string;
  answers: { questionId: string; value: string }[];
  checkedInAt: string | null;
  tokenIssued?: boolean;
};
type Table = {
  id: string;
  label: string;
  capacity: number;
  seated: number;
  remaining: number;
  posX: number;
  posY: number;
};
type Media = { id: string; status: string; file_id: string; filename: string; content_type?: string };
type Job = { id: string; channel: string; status: string; attempt_count: number; last_error: string; subject: string; to_address: string };
type Issued = { inviteUrl: string; checkInUrl: string; qrSvg: string; token: string };
type View = {
  invitation?: Invitation;
  guests: Guest[];
  tables?: Table[];
  media?: Media[];
  jobs?: Job[];
  shareUrl?: string;
};

type Tab = "guests" | "seating" | "invite";
type RsvpFilter = "all" | "yes" | "no" | "pending" | "checked" | "unchecked" | "unassigned";

export function invitationHeadcount(guests: { rsvp: string; partySize: number; plusOnes: number }[]) {
  const people = (guest: { partySize: number; plusOnes: number; rsvp: string }) => guest.partySize + (guest.rsvp === "yes" ? guest.plusOnes : 0);
  const sum = (status?: string) => guests.filter((guest) => !status || guest.rsvp === status).reduce((total, guest) => total + people(guest), 0);
  return { attending: sum("yes"), invited: sum(), pending: sum("pending"), declined: sum("no") };
}

function localInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stamp(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function InviteManager({ eventId, expected }: { eventId?: string; expected?: string }) {
  const base = eventId ? `/api/admin/events/${eventId}/invites` : "/api/planner/invites";
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [name, setName] = useState("");
  const [party, setParty] = useState("1");
  const [isMinor, setIsMinor] = useState(false);
  const [bulk, setBulk] = useState("");
  const [draft, setDraft] = useState<Invitation | null>(null);
  const [question, setQuestion] = useState("");
  const [deadline, setDeadline] = useState("");
  const [job, setJob] = useState({ channel: "email", kind: "reminder", to: "", subject: "", body: "", when: "" });
  const [tab, setTab] = useState<Tab>("guests");
  const [q, setQ] = useState("");
  const [rsvpFilter, setRsvpFilter] = useState<RsvpFilter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [tableLabel, setTableLabel] = useState("");
  const [tableCap, setTableCap] = useState("8");
  const [assignTableId, setAssignTableId] = useState("");
  const [dragGuest, setDragGuest] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await api<View>(base);
    setView(next);
    if (next.invitation) {
      setDraft(next.invitation);
      setDeadline(localInput(next.invitation.rsvpDeadline));
    }
    setError("");
  }, [base]);

  useEffect(() => {
    let gone = false;
    load().catch((err: Error) => {
      if (!gone) setError(err.message);
    });
    return () => {
      gone = true;
    };
  }, [load]);

  const saveGuest = async (guest: Guest, patch: object) => {
    await api(`${base}/guests/${guest.id}`, { method: "PATCH", body: patch });
    await load();
  };

  const guests = view?.guests ?? [];
  const tables = view?.tables ?? [];
  const headcount = invitationHeadcount(guests);
  const manage = Boolean(draft && view?.invitation);
  const checkedIn = guests.filter((guest) => guest.checkedInAt).length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return guests.filter((guest) => {
      if (rsvpFilter === "yes" && guest.rsvp !== "yes") return false;
      if (rsvpFilter === "no" && guest.rsvp !== "no") return false;
      if (rsvpFilter === "pending" && guest.rsvp !== "pending") return false;
      if (rsvpFilter === "checked" && !guest.checkedInAt) return false;
      if (rsvpFilter === "unchecked" && guest.checkedInAt) return false;
      if (rsvpFilter === "unassigned" && guest.tableId) return false;
      if (!needle) return true;
      const hay = [guest.name, guest.email, guest.phone, guest.table, guest.note, ...guest.answers.map((a) => a.value)].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [guests, q, rsvpFilter]);

  const unassigned = guests.filter((guest) => !guest.tableId);

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const selectFiltered = () => setSelected(filtered.map((guest) => guest.id));
  const clearSelected = () => setSelected([]);

  const assignSelected = async (tableId: string | null) => {
    if (!selected.length) return;
    await api(`${base}/assign`, { body: { guestIds: selected, tableId } });
    setSelected([]);
    await load();
  };

  const dropOnTable = async (tableId: string) => {
    if (!dragGuest || !manage) return;
    try {
      await api(`${base}/assign`, { body: { guestIds: [dragGuest], tableId } });
      setDragGuest(null);
      await load();
    } catch (err) {
      alert((err as Error).message);
      setDragGuest(null);
    }
  };

  if (error) return <Section eyebrow="Guests" title="Invitation"><p className="pl-warn" role="alert">{error}</p></Section>;
  if (!view || (view.invitation && !draft)) return <Section eyebrow="Guests" title="Invitation"><p className="pl-sub">Loading...</p></Section>;

  const saveInvitation = async (published?: boolean) => {
    if (!draft) return;
    await api(base, {
      method: "PATCH",
      body: {
        title: draft.title,
        message: draft.message,
        mode: draft.mode,
        published: published ?? draft.published,
        plusOneCap: Number(draft.plusOneCap) || 0,
        rsvpDeadline: deadline ? new Date(deadline).toISOString() : null,
        themeColor: draft.theme.color,
        themeAccent: draft.theme.accent,
        themeImage: draft.theme.image,
        questions: draft.questions,
        involvesMinors: draft.involvesMinors,
        slug: draft.slug,
      },
    });
    await load();
  };

  const questionLabel = (id: string) => draft?.questions.find((item) => item.id === id)?.label || "Answer";

  return (
    <Section
      eyebrow="Guests"
      title={`${headcount.attending} attending`}
      intro={`${headcount.invited} invited · ${headcount.pending} pending · ${headcount.declined} declined · ${checkedIn} checked in${expected?.trim() ? ` · ${expected.trim()} expected` : ""}`}
      actions={
        <span className="pl-rowtools no-print">
          {draft?.published ? <a className="pl-btn ghost" href={`/invite/${draft.slug}`} target="_blank" rel="noreferrer">Share link</a> : null}
          <button className="pl-btn ghost" type="button" onClick={() => window.print()}>Print seating</button>
        </span>
      }
    >
      <div className="inv-tabs no-print" role="tablist" aria-label="Guest tools">
        {([
          ["guests", "Guest directory"],
          ["seating", "Seating"],
          ["invite", "Invitation"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-on" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {issued && (
        <div className="pl-card no-print" role="status">
          <div className="pl-k">Guest link, shown once</div>
          <code>{issued.inviteUrl}</code>
          <div className="pl-k">Check-in link</div>
          <code>{issued.checkInUrl}</code>
          {issued.qrSvg && <div dangerouslySetInnerHTML={{ __html: issued.qrSvg }} />}
          <button className="pl-btn ghost" type="button" onClick={() => navigator.clipboard.writeText(issued.inviteUrl)}>Copy link</button>
        </div>
      )}

      {tab === "guests" && (
        <>
          <div className="inv-toolbar no-print">
            <input className="inv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, note, dietary…" aria-label="Search guests" />
            <select value={rsvpFilter} onChange={(e) => setRsvpFilter(e.target.value as RsvpFilter)} aria-label="Filter guests">
              <option value="all">All RSVP</option>
              <option value="yes">Attending</option>
              <option value="pending">Pending</option>
              <option value="no">Declined</option>
              <option value="checked">Checked in</option>
              <option value="unchecked">Not checked in</option>
              <option value="unassigned">Unassigned seats</option>
            </select>
            {manage ? (
              <>
                <button className="pl-btn ghost" type="button" onClick={selectFiltered}>Select shown</button>
                <button className="pl-btn ghost" type="button" onClick={clearSelected} disabled={!selected.length}>Clear</button>
                <select value={assignTableId} onChange={(e) => setAssignTableId(e.target.value)} aria-label="Assign table" disabled={!selected.length}>
                  <option value="">Assign to…</option>
                  {tables.map((table) => (
                    <option key={table.id} value={table.id}>{table.label} ({table.remaining} left)</option>
                  ))}
                </select>
                <button className="pl-btn ghost" type="button" disabled={!selected.length || !assignTableId} onClick={() => assignSelected(assignTableId).catch((err) => alert(err.message))}>Assign</button>
                <button className="pl-btn ghost" type="button" disabled={!selected.length} onClick={() => assignSelected(null).catch((err) => alert(err.message))}>Unassign</button>
              </>
            ) : null}
          </div>

          <div className="inv-summary no-print">
            <button type="button" className={rsvpFilter === "all" ? "is-on" : ""} onClick={() => setRsvpFilter("all")}>All {guests.length}</button>
            <button type="button" className={rsvpFilter === "yes" ? "is-on" : ""} onClick={() => setRsvpFilter("yes")}>Yes {guests.filter((g) => g.rsvp === "yes").length}</button>
            <button type="button" className={rsvpFilter === "pending" ? "is-on" : ""} onClick={() => setRsvpFilter("pending")}>Pending {guests.filter((g) => g.rsvp === "pending").length}</button>
            <button type="button" className={rsvpFilter === "no" ? "is-on" : ""} onClick={() => setRsvpFilter("no")}>No {guests.filter((g) => g.rsvp === "no").length}</button>
            <button type="button" className={rsvpFilter === "checked" ? "is-on" : ""} onClick={() => setRsvpFilter("checked")}>Checked in {checkedIn}</button>
          </div>

          <div className="pl-card inv-directory">
            {filtered.map((guest) => (
              <article className="inv-guest" key={guest.id}>
                <div className="inv-guest-top">
                  {manage ? (
                    <label className="inv-check">
                      <input type="checkbox" checked={selected.includes(guest.id)} onChange={() => toggleSelect(guest.id)} aria-label={`Select ${guest.name}`} />
                    </label>
                  ) : null}
                  <input
                    className="t plain inv-name"
                    value={guest.name}
                    aria-label="Guest name"
                    disabled={!manage}
                    onChange={(event) => setView({ ...view, guests: guests.map((item) => item.id === guest.id ? { ...item, name: event.target.value } : item) })}
                    onBlur={() => manage && saveGuest(guest, { name: guest.name }).catch((err) => alert(err.message))}
                  />
                  <span className={`pl-tag ${guest.rsvp === "yes" ? "ok" : guest.rsvp === "no" ? "warn" : ""}`}>{guest.rsvp}</span>
                  <span className={`pl-tag ${guest.checkedInAt ? "ok" : ""}`}>{guest.checkedInAt ? `In ${stamp(guest.checkedInAt)}` : "Not in"}</span>
                </div>
                <div className="inv-guest-meta">
                  <label>Party
                    <input className="due" type="number" min={1} value={guest.partySize} disabled={!manage}
                      onChange={(event) => setView({ ...view, guests: guests.map((item) => item.id === guest.id ? { ...item, partySize: Math.max(1, Number(event.target.value) || 1) } : item) })}
                      onBlur={() => manage && saveGuest(guest, { partySize: guest.partySize }).catch((err) => alert(err.message))} />
                  </label>
                  <label>+1s
                    <input className="due" type="number" min={0} value={guest.plusOnes} disabled={!manage}
                      onChange={(event) => setView({ ...view, guests: guests.map((item) => item.id === guest.id ? { ...item, plusOnes: Math.max(0, Number(event.target.value) || 0) } : item) })}
                      onBlur={() => manage && saveGuest(guest, { plusOnes: guest.plusOnes }).catch((err) => alert(err.message))} />
                  </label>
                  <label>RSVP
                    <select value={guest.rsvp} disabled={!manage} onChange={(event) => {
                      const rsvp = event.target.value;
                      setView({ ...view, guests: guests.map((item) => item.id === guest.id ? { ...item, rsvp } : item) });
                      if (manage) saveGuest(guest, { rsvp }).catch((err) => alert(err.message));
                    }}>
                      <option value="pending">Pending</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <label>Table
                    <select
                      value={guest.tableId || ""}
                      disabled={!manage}
                      onChange={(event) => {
                        const tableId = event.target.value || null;
                        saveGuest(guest, { tableId }).catch((err) => alert(err.message));
                      }}
                    >
                      <option value="">Unassigned</option>
                      {tables.map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}
                    </select>
                  </label>
                  <label className="pl-inline">
                    <input type="checkbox" checked={guest.isMinor} disabled={!manage} aria-label="Guest is a minor"
                      onChange={(event) => {
                        const next = event.target.checked;
                        setView({ ...view, guests: guests.map((item) => item.id === guest.id ? { ...item, isMinor: next } : item) });
                        if (manage) saveGuest(guest, { isMinor: next }).catch((err) => alert(err.message));
                      }} />
                    Minor
                  </label>
                </div>
                {(guest.email || guest.phone) ? <p className="inv-contact"><small>{[guest.email, guest.phone].filter(Boolean).join(" · ")}</small></p> : null}
                <label className="inv-note">Dietary / notes
                  <input
                    value={guest.note}
                    disabled={!manage}
                    placeholder="Allergies, access needs…"
                    onChange={(event) => setView({ ...view, guests: guests.map((item) => item.id === guest.id ? { ...item, note: event.target.value } : item) })}
                    onBlur={() => manage && saveGuest(guest, { note: guest.note }).catch((err) => alert(err.message))}
                  />
                </label>
                {guest.answers.length ? (
                  <ul className="inv-answers">
                    {guest.answers.map((answer) => (
                      <li key={answer.questionId}><strong>{questionLabel(answer.questionId)}</strong> {answer.value}</li>
                    ))}
                  </ul>
                ) : null}
                {manage ? (
                  <div className="pl-rowtools no-print">
                    <button type="button" onClick={async () => { try { setIssued(await api<Issued>(`${base}/guests/${guest.id}`, { method: "POST", body: {} })); } catch (err) { alert((err as Error).message); } }}>New link / QR</button>
                    <button type="button" className="danger" aria-label="Delete" onClick={async () => { if (!confirm("Delete this guest?")) return; try { await api(`${base}/guests/${guest.id}`, { method: "DELETE" }); await load(); } catch (err) { alert((err as Error).message); } }}>Delete</button>
                  </div>
                ) : null}
              </article>
            ))}
            {!filtered.length && <Empty>No guests match.</Empty>}
          </div>

          {manage && (
            <form className="pl-add no-print" onSubmit={async (event) => {
              event.preventDefault();
              if (!name.trim()) return;
              try {
                setIssued(await api<Issued>(`${base}/guests`, { body: { name: name.trim(), partySize: Math.max(1, Number(party) || 1), isMinor } }));
                setName("");
                setParty("1");
                setIsMinor(false);
                await load();
              } catch (err) {
                alert((err as Error).message);
              }
            }}>
              <input value={name} placeholder="Guest or household name" onChange={(event) => setName(event.target.value)} />
              <input type="number" min={1} value={party} onChange={(event) => setParty(event.target.value)} aria-label="Party size" style={{ maxWidth: 90 }} />
              <label className="pl-inline"><input type="checkbox" checked={isMinor} onChange={(event) => setIsMinor(event.target.checked)} /> Minor</label>
              <button className="pl-btn">Add guest</button>
            </form>
          )}
          {manage && (
            <details className="no-print">
              <summary className="pl-link">Paste many guests at once</summary>
              <textarea rows={4} value={bulk} placeholder="One name per line" onChange={(event) => setBulk(event.target.value)} />
              <button className="pl-btn ghost" type="button" onClick={async () => {
                const names = bulk.split("\n").map((item) => item.trim()).filter(Boolean);
                try {
                  for (const item of names) await api(`${base}/guests`, { body: { name: item } });
                  setBulk("");
                  setIssued(null);
                  await load();
                } catch (err) {
                  alert((err as Error).message);
                }
              }}>Add {bulk.split("\n").filter((item) => item.trim()).length} guests</button>
            </details>
          )}
        </>
      )}

      {tab === "seating" && (
        <>
          {manage && (
            <form className="pl-add no-print" onSubmit={async (event) => {
              event.preventDefault();
              if (!tableLabel.trim()) return;
              try {
                await api(`${base}/tables`, { body: { label: tableLabel.trim(), capacity: Math.max(1, Number(tableCap) || 8) } });
                setTableLabel("");
                setTableCap("8");
                await load();
              } catch (err) {
                alert((err as Error).message);
              }
            }}>
              <input value={tableLabel} placeholder="Table name" onChange={(e) => setTableLabel(e.target.value)} />
              <input type="number" min={1} max={200} value={tableCap} onChange={(e) => setTableCap(e.target.value)} aria-label="Capacity" style={{ maxWidth: 90 }} />
              <button className="pl-btn">Add table</button>
            </form>
          )}

          <div className="inv-seat-layout">
            <aside className="inv-unassigned no-print">
              <h3 className="pl-h3">Unassigned ({unassigned.length})</h3>
              {unassigned.length ? unassigned.map((guest) => (
                <button
                  type="button"
                  key={guest.id}
                  className="inv-chip"
                  draggable={manage}
                  onDragStart={() => setDragGuest(guest.id)}
                  onDragEnd={() => setDragGuest(null)}
                >
                  {guest.name} · {guest.seats}
                </button>
              )) : <Empty>Everyone is seated.</Empty>}
            </aside>

            <div className="inv-floor" aria-label="Seating floor plan">
              {tables.length ? tables.map((table) => {
                const seatedGuests = guests.filter((guest) => guest.tableId === table.id);
                const over = table.seated > table.capacity;
                return (
                  <div
                    key={table.id}
                    className={`inv-table${over ? " is-over" : ""}`}
                    style={{ left: table.posX, top: table.posY }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropOnTable(table.id)}
                  >
                    <header>
                      {manage ? (
                        <input
                          className="t plain"
                          value={table.label}
                          aria-label="Table label"
                          onChange={(event) => setView({ ...view!, tables: tables.map((item) => item.id === table.id ? { ...item, label: event.target.value } : item) })}
                          onBlur={async () => {
                            try {
                              await api(`${base}/tables/${table.id}`, { method: "PATCH", body: { label: table.label } });
                              await load();
                            } catch (err) {
                              alert((err as Error).message);
                              await load();
                            }
                          }}
                        />
                      ) : <strong>{table.label}</strong>}
                      <small className={over ? "inv-over" : ""}>{table.seated}/{table.capacity}</small>
                    </header>
                    {manage ? (
                      <label className="inv-cap no-print">Cap
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={table.capacity}
                          onChange={(event) => setView({ ...view!, tables: tables.map((item) => item.id === table.id ? { ...item, capacity: Math.max(1, Number(event.target.value) || 1) } : item) })}
                          onBlur={async () => {
                            try {
                              await api(`${base}/tables/${table.id}`, { method: "PATCH", body: { capacity: table.capacity } });
                              await load();
                            } catch (err) {
                              alert((err as Error).message);
                              await load();
                            }
                          }}
                        />
                      </label>
                    ) : null}
                    <ul>
                      {seatedGuests.map((guest) => (
                        <li
                          key={guest.id}
                          draggable={manage}
                          onDragStart={() => setDragGuest(guest.id)}
                          onDragEnd={() => setDragGuest(null)}
                        >
                          {guest.name} <small>{guest.seats}</small>
                          {manage ? (
                            <button type="button" className="no-print" aria-label="Unassign" onClick={() => api(`${base}/assign`, { body: { guestIds: [guest.id], tableId: null } }).then(load).catch((err) => alert(err.message))}>×</button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {manage ? (
                      <button type="button" className="pl-btn ghost sm no-print" onClick={async () => {
                        if (!confirm(`Delete table ${table.label}? Guests become unassigned.`)) return;
                        try {
                          await api(`${base}/tables/${table.id}`, { method: "DELETE" });
                          await load();
                        } catch (err) {
                          alert((err as Error).message);
                        }
                      }}>Delete table</button>
                    ) : null}
                  </div>
                );
              }) : <Empty>Add tables to start seating.</Empty>}
            </div>
          </div>

          <div className="inv-print-only" aria-hidden={false}>
            <h2>Seating arrangement</h2>
            {tables.map((table) => (
              <section key={table.id}>
                <h3>{table.label} <small>({table.seated}/{table.capacity})</small></h3>
                <ul>
                  {guests.filter((guest) => guest.tableId === table.id).map((guest) => (
                    <li key={guest.id}>{guest.name} — {guest.seats} seat{guest.seats === 1 ? "" : "s"}{guest.note ? ` · ${guest.note}` : ""}</li>
                  ))}
                </ul>
              </section>
            ))}
            {unassigned.length ? (
              <section>
                <h3>Unassigned</h3>
                <ul>{unassigned.map((guest) => <li key={guest.id}>{guest.name}</li>)}</ul>
              </section>
            ) : null}
          </div>
        </>
      )}

      {tab === "invite" && draft && (
        <>
          <form className="pl-card pl-form no-print" onSubmit={async (event) => { event.preventDefault(); try { await saveInvitation(); } catch (err) { alert((err as Error).message); } }}>
            <div className="inv-status">
              <span className={`pl-tag ${draft.published ? "ok" : ""}`}>{draft.published ? "Published" : "Draft"}</span>
              <span className="pl-tag">{draft.mode.replace("_", " ")}</span>
              {draft.published ? <a href={`/invite/${draft.slug}`} target="_blank" rel="noreferrer">/invite/{draft.slug}</a> : <small>Publish to share the public link</small>}
            </div>
            <label className="pl-field"><span>Title</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <label className="pl-field wide"><span>Message</span><textarea rows={3} value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} /></label>
            <label className="pl-field"><span>Who can open it</span>
              <select value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value as Invitation["mode"] })}>
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="invite_only">Invite only</option>
              </select>
            </label>
            <label className="pl-field"><span>Link</span><input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></label>
            <label className="pl-field"><span>Plus-one cap</span><input type="number" min={0} max={49} value={draft.plusOneCap} onChange={(event) => setDraft({ ...draft, plusOneCap: Number(event.target.value) || 0 })} /></label>
            <label className="pl-field"><span>RSVP deadline</span><input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
            <label className="pl-field"><span>Color</span><input value={draft.theme.color} placeholder="#112233" onChange={(event) => setDraft({ ...draft, theme: { ...draft.theme, color: event.target.value } })} /></label>
            <label className="pl-field"><span>Accent</span><input value={draft.theme.accent} placeholder="#c9b07a" onChange={(event) => setDraft({ ...draft, theme: { ...draft.theme, accent: event.target.value } })} /></label>
            <label className="pl-field wide"><span>Image link</span><input value={draft.theme.image} placeholder="https://" onChange={(event) => setDraft({ ...draft, theme: { ...draft.theme, image: event.target.value } })} /></label>
            <label className="pl-field wide"><input type="checkbox" checked={draft.involvesMinors} onChange={(event) => setDraft({ ...draft, involvesMinors: event.target.checked })} /> This event includes minors</label>
            {draft.questions.map((item) => (
              <div className="pl-row" key={item.id}>
                <input className="t plain" value={item.label} aria-label="Question" onChange={(event) => setDraft({ ...draft, questions: draft.questions.map((question) => question.id === item.id ? { ...question, label: event.target.value } : question) })} />
                <button type="button" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((question) => question.id !== item.id) })}>×</button>
              </div>
            ))}
            <div className="pl-add wide">
              <input value={question} placeholder="Question for guests (dietary, song, etc.)" onChange={(event) => setQuestion(event.target.value)} />
              <button type="button" className="pl-btn ghost" onClick={() => { if (!question.trim()) return; setDraft({ ...draft, questions: [...draft.questions, { id: crypto.randomUUID(), label: question.trim() }] }); setQuestion(""); }}>Add question</button>
            </div>
            <button className="pl-btn" type="submit">Save invitation</button>
            <button className="pl-btn ghost" type="button" onClick={async () => { try { await saveInvitation(!draft.published); } catch (err) { alert((err as Error).message); } }}>{draft.published ? "Unpublish" : "Publish"}</button>
          </form>

          {manage && (
            <div className="pl-card no-print">
              <h3 className="pl-h3">Photos</h3>
              {view.media?.length ? view.media.map((item) => {
                const preview = `${base}/media/${item.file_id}`;
                const type = item.content_type ?? "";
                return (
                  <div className="pl-row" key={item.id}>
                    {type.startsWith("video/") ? <video controls src={preview} style={{ maxWidth: 240 }} /> : type.startsWith("image/") ? <img alt={item.filename} src={preview} style={{ maxWidth: 160, maxHeight: 120, objectFit: "cover" }} /> : null}
                    <span className="t">{item.filename}</span>
                    <span className={`pl-tag ${item.status === "approved" ? "ok" : ""}`}>{item.status}</span>
                    {item.status === "pending" && (
                      <span className="pl-rowtools">
                        <button type="button" onClick={async () => { await api(`${base}/media`, { body: { id: item.id, status: "approved" } }); await load(); }}>Approve</button>
                        <button type="button" onClick={async () => { await api(`${base}/media`, { body: { id: item.id, status: "rejected" } }); await load(); }}>Reject</button>
                      </span>
                    )}
                  </div>
                );
              }) : <Empty>No guest photos yet.</Empty>}
            </div>
          )}

          {manage && (
            <form className="pl-card pl-form no-print" onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api(`${base}/jobs`, { body: { channel: job.channel, kind: job.kind, to: job.to, subject: job.subject, body: job.body, nextAttemptAt: job.when ? new Date(job.when).toISOString() : "" } });
                setJob({ channel: "email", kind: "reminder", to: "", subject: "", body: "", when: "" });
                await load();
              } catch (err) {
                alert((err as Error).message);
              }
            }}>
              <h3 className="pl-h3">Schedule a message</h3>
              <p className="pl-intro">Email reminders can also be queued automatically when a guest with an email is added. SMS stays off until Michael approves. Minors are excluded from the guest picker below.</p>
              <label className="pl-field"><span>Channel</span>
                <select value={job.channel} onChange={(event) => setJob({ ...job, channel: event.target.value })}>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </label>
              <label className="pl-field"><span>Kind</span>
                <select value={job.kind} onChange={(event) => setJob({ ...job, kind: event.target.value })}>
                  <option value="invite">Invite</option>
                  <option value="reminder">Reminder</option>
                </select>
              </label>
              <label className="pl-field"><span>Guest</span>
                <select value="" onChange={(event) => {
                  const guest = guests.find((item) => item.id === event.target.value);
                  if (!guest || guest.isMinor) return setJob({ ...job, to: "" });
                  setJob({ ...job, to: job.channel === "sms" ? guest.phone || "" : guest.email || "" });
                }}>
                  <option value="">Type an address</option>
                  {guests.filter((guest) => !guest.isMinor).map((guest) => <option key={guest.id} value={guest.id}>{guest.name}</option>)}
                </select>
              </label>
              <label className="pl-field"><span>To</span><input value={job.to} onChange={(event) => setJob({ ...job, to: event.target.value })} /></label>
              <label className="pl-field"><span>Subject</span><input value={job.subject} onChange={(event) => setJob({ ...job, subject: event.target.value })} /></label>
              <label className="pl-field wide"><span>Message</span><textarea rows={3} value={job.body} onChange={(event) => setJob({ ...job, body: event.target.value })} /></label>
              <label className="pl-field"><span>When</span><input type="datetime-local" value={job.when} onChange={(event) => setJob({ ...job, when: event.target.value })} /></label>
              <button className="pl-btn" type="submit">Schedule</button>
              <button className="pl-btn ghost" type="button" onClick={async () => { try { await api(`${base}/jobs`, { body: { run: true } }); await load(); } catch (err) { alert((err as Error).message); } }}>Send due</button>
              {view.jobs?.map((item) => (
                <div className="pl-row" key={item.id}>
                  <span className="t"><strong>{item.subject}</strong> <small>{item.to_address}</small></span>
                  <span className={`pl-tag ${item.status === "sent" ? "ok" : ""}`}>{item.status}</span>
                  {item.last_error && <small>{item.last_error}</small>}
                </div>
              ))}
            </form>
          )}
        </>
      )}
    </Section>
  );
}
