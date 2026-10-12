"use client";

import { useMemo, useState } from "react";
import { fillMergeTags, money, songKinds, totals, type AdminData, type PlannerData } from "@/lib/planner";
import { inLibrary, mostRequested, musicCategories, musicGenres, musicLibrary } from "@/lib/music-db";
import { api, Empty, Field, fmtDate, newId, RowTools, Section, Select, SignaturePad, Text, useListOps } from "./ui";

export type Bundle = {
  code: string;
  guestCode: string;
  guestPassword: string;
  data: PlannerData;
  admin: AdminData;
  requests: { id: string; created_at: string; guest_name: string; title: string; artist: string; note: string; status: string }[];
  messages: { id: string; created_at: string; sender: "client" | "mb"; body: string; read_at: string | null }[];
  paymentsOnline: boolean;
};

type SetSection = <K extends keyof PlannerData>(section: K, value: PlannerData[K]) => void;
type Props = { bundle: Bundle; set: SetSection; reload: () => Promise<void>; go: (tab: string) => void };

// ---------- Overview ----------

export function Overview({ bundle, go }: Props) {
  const { data, admin, messages, requests } = bundle;
  const t = totals(admin);
  const days = data.details.eventDate ? Math.ceil((new Date(`${data.details.eventDate}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)) / 864e5) : null;
  const next = data.checklist.filter((c) => !c.done).slice(0, 4);
  const unread = messages.filter((m) => m.sender === "mb" && !m.read_at).length;
  const toSign = admin.documents.filter((d) => d.status === "sent").length;
  const pending = requests.filter((r) => r.status === "pending").length;
  const nextPayment = admin.payments.find((p) => p.status === "due");

  return (
    <Section eyebrow="Overview" title={days === null ? "Set your date" : days > 0 ? `${days} days to go` : days === 0 ? "Today is the day" : "Thank you for celebrating with us"}>
      {admin.noteForClient && <div className="pl-note">{admin.noteForClient}</div>}
      <div className="pl-grid">
        <button className="pl-card pl-stat" onClick={() => go("Checklist")}>
          <div className="pl-k">Up next</div>
          {next.length ? next.map((c) => <div className="pl-mini" key={c.id}>{c.text}{c.due && <small> · {c.due} out</small>}</div>) : <p>Everything is checked off.</p>}
        </button>
        <button className="pl-card pl-stat" onClick={() => go("Payments")}>
          <div className="pl-k">Balance</div>
          <h3>{money(t.balance)}</h3>
          <small>{nextPayment ? `${nextPayment.label} ${money(nextPayment.amount)}${nextPayment.due ? ` due ${fmtDate(nextPayment.due)}` : ""}` : t.total ? "Paid in full" : "Invoice coming soon"}</small>
        </button>
        <button className="pl-card pl-stat" onClick={() => go("Documents")}>
          <div className="pl-k">Documents</div>
          <h3>{toSign}</h3>
          <small>{toSign ? "waiting for your signature" : "nothing to sign"}</small>
        </button>
        <button className="pl-card pl-stat" onClick={() => go("Messages")}>
          <div className="pl-k">Messages</div>
          <h3>{unread}</h3>
          <small>{unread ? "new from MB" : "all caught up"}</small>
        </button>
        <button className="pl-card pl-stat" onClick={() => go("Music")}>
          <div className="pl-k">Music</div>
          <h3>{data.songs.length}</h3>
          <small>{data.songs.filter((s) => s.kind === "Must play").length} must-play · {data.songs.filter((s) => s.kind === "Do not play").length} do-not-play</small>
        </button>
        <button className="pl-card pl-stat" onClick={() => go("Guest requests")}>
          <div className="pl-k">Guest requests</div>
          <h3>{requests.length}</h3>
          <small>{pending} waiting for review</small>
        </button>
        <button className="pl-card pl-stat" onClick={() => go("Guests")}>
          <div className="pl-k">RSVPs</div>
          <h3>{data.guests.filter((g) => g.rsvp === "Yes").reduce((n, g) => n + g.party, 0)}</h3>
          <small>attending of {data.guests.reduce((n, g) => n + g.party, 0)} invited</small>
        </button>
        <button className="pl-card pl-stat" onClick={() => go("Timeline")}>
          <div className="pl-k">Timeline</div>
          <h3>{data.timeline.length}</h3>
          <small>moments planned</small>
        </button>
      </div>
    </Section>
  );
}

// ---------- Event details & contact info ----------

export function Details({ bundle, set }: Props) {
  const d = bundle.data.details;
  const up = (patch: Partial<typeof d>) => set("details", { ...d, ...patch });
  const f = (key: keyof typeof d, label: string, type = "text", wide = false) => (
    <Field label={label} wide={wide}>
      <Text type={type} value={d[key]} onChange={(v) => up({ [key]: v } as Partial<typeof d>)} />
    </Field>
  );
  return (
    <Section eyebrow="Event details" title="The essentials" intro="Keep these current so the whole team is working from the same information." actions={<a className="pl-btn ghost" href="/api/planner/calendar">Add to calendar</a>}>
      <h3 className="pl-h3">Your contact information</h3>
      <div className="pl-form">
        {f("clientNames", "Client name(s)", "text", true)}
        {f("email", "Email", "email")}
        {f("phone", "Phone", "tel")}
        {f("altContact", "Day-of contact")}
        {f("altPhone", "Day-of contact phone", "tel")}
        {f("address", "Mailing address", "text", true)}
      </div>
      <h3 className="pl-h3">Event</h3>
      <div className="pl-form">
        {f("eventType", "Event type")}
        {f("eventDate", "Date", "date")}
        {f("startTime", "Start time (e.g. 6:00 PM)")}
        {f("endTime", "End time (e.g. 11:00 PM)")}
        {f("guestCount", "Expected guests")}
        {f("ceremonyLocation", "Ceremony location (if different)")}
      </div>
      <h3 className="pl-h3">Venue</h3>
      <div className="pl-form">
        {f("venueName", "Venue name")}
        {f("venueAddress", "Venue address")}
        {f("venueContact", "Venue coordinator")}
        {f("venuePhone", "Venue phone", "tel")}
        <Field label="Anything else we should know?" wide>
          <Text area value={d.notes} onChange={(v) => up({ notes: v })} />
        </Field>
      </div>
    </Section>
  );
}

// ---------- Planning form ----------

export function PlanningForm({ bundle, set }: Props) {
  const forms = bundle.data.forms;
  const up = (patch: Partial<typeof forms>) => set("forms", { ...forms, ...patch });
  const intros = useListOps(forms.introductions, (introductions) => up({ introductions }));
  const dances = useListOps(forms.dances, (d) => up({ dances: d }));
  return (
    <Section eyebrow="Planning form" title="How the night should feel" intro="Introductions, special dances, and the details your MC needs to get every moment right." actions={<button className="pl-btn ghost" onClick={() => window.print()}>Print</button>}>
      <h3 className="pl-h3">Introductions</h3>
      <p className="pl-intro">List each entrance in order. Add pronunciations below.</p>
      <div className="pl-table">
        {forms.introductions.map((i, n) => (
          <div className="pl-tr" key={i.id}>
            <span className="pl-num">{n + 1}</span>
            <input value={i.names} placeholder="Names as they should be announced" onChange={(e) => intros.update(i.id, { names: e.target.value })} />
            <input value={i.role} placeholder="Role (e.g. Maid of honor)" onChange={(e) => intros.update(i.id, { role: e.target.value })} />
            <input value={i.song} placeholder="Entrance song (optional)" onChange={(e) => intros.update(i.id, { song: e.target.value })} />
            <RowTools onUp={() => intros.move(i.id, -1)} onDown={() => intros.move(i.id, 1)} onRemove={() => intros.remove(i.id)} />
          </div>
        ))}
        {!forms.introductions.length && <Empty>No introductions yet.</Empty>}
      </div>
      <button className="pl-btn ghost no-print" onClick={() => intros.add({ id: newId(), names: "", role: "", song: "" })}>Add introduction</button>

      <h3 className="pl-h3">Special dances & moments</h3>
      <div className="pl-table">
        {forms.dances.map((d) => (
          <div className="pl-tr" key={d.id}>
            <input value={d.moment} placeholder="Moment" onChange={(e) => dances.update(d.id, { moment: e.target.value })} />
            <input value={d.song} placeholder="Song" onChange={(e) => dances.update(d.id, { song: e.target.value })} />
            <input value={d.artist} placeholder="Artist" onChange={(e) => dances.update(d.id, { artist: e.target.value })} />
            <input value={d.notes} placeholder="Notes (fade at 2:30, full song...)" onChange={(e) => dances.update(d.id, { notes: e.target.value })} />
            <RowTools onUp={() => dances.move(d.id, -1)} onDown={() => dances.move(d.id, 1)} onRemove={() => dances.remove(d.id)} />
          </div>
        ))}
      </div>
      <button className="pl-btn ghost no-print" onClick={() => dances.add({ id: newId(), moment: "", song: "", artist: "", notes: "" })}>Add moment</button>

      <h3 className="pl-h3">Music & MC preferences</h3>
      <div className="pl-form">
        <Field label="Cocktail hour style"><Text value={forms.cocktailStyle} placeholder="Jazz, acoustic, lounge..." onChange={(v) => up({ cocktailStyle: v })} /></Field>
        <Field label="Dinner music style"><Text value={forms.dinnerStyle} placeholder="Motown, soft pop..." onChange={(v) => up({ dinnerStyle: v })} /></Field>
        <Field label="Genres you love"><Text value={forms.genresLove} onChange={(v) => up({ genresLove: v })} /></Field>
        <Field label="Genres to avoid"><Text value={forms.genresAvoid} onChange={(v) => up({ genresAvoid: v })} /></Field>
        <Field label="MC style"><Select value={forms.mcStyle} options={["Minimal", "Balanced", "High energy"] as const} onChange={(v) => up({ mcStyle: v })} /></Field>
        <Field label="Volume"><Select value={forms.volume} options={["Soft", "Balanced", "Loud"] as const} onChange={(v) => up({ volume: v })} /></Field>
        <label className="pl-check wide"><input type="checkbox" checked={forms.cleanOnly} onChange={(e) => up({ cleanOnly: e.target.checked })} /> Clean / radio edits only</label>
        <Field label="Announcements (toasts, thank-yous, surprises)" wide><Text area value={forms.announcements} onChange={(v) => up({ announcements: v })} /></Field>
        <Field label="Name pronunciations" wide><Text area value={forms.pronunciations} placeholder="Siobhan = shi-VAWN" onChange={(v) => up({ pronunciations: v })} /></Field>
        <Field label="Cultural or family traditions" wide><Text area value={forms.traditions} onChange={(v) => up({ traditions: v })} /></Field>
      </div>
    </Section>
  );
}

// ---------- Music requests & library ----------

export function Music({ bundle, set, reload }: Props) {
  const songs = bundle.data.songs;
  const ops = useListOps(songs, (next) => set("songs", next));
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [genre, setGenre] = useState("All");
  const [kind, setKind] = useState<(typeof songKinds)[number]>("Must play");
  const [custom, setCustom] = useState({ title: "", artist: "" });
  const [filter, setFilter] = useState<"All" | (typeof songKinds)[number]>("All");

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return musicLibrary.filter((s) => (cat === "All" || s.category === cat) && (genre === "All" || s.genre === genre) && (!term || `${s.title} ${s.artist}`.toLowerCase().includes(term))).slice(0, 60);
  }, [q, cat, genre]);
  const has = (title: string) => songs.some((s) => s.title.toLowerCase() === title.toLowerCase());
  const add = (title: string, artist: string, moment = "") => ops.add({ id: newId(), title, artist, kind, moment, note: "" });
  const shown = filter === "All" ? songs : songs.filter((s) => s.kind === filter);

  return (
    <Section eyebrow="Music" title="Your requests" intro="Search MB's library or add any song. Mark what must play, what can play, and what should never play." actions={<button className="pl-btn ghost" onClick={() => window.print()}>Print list</button>}>
      <div className="pl-tabs-inline no-print">
        {(["All", ...songKinds] as const).map((k) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
            {k} <small>{k === "All" ? songs.length : songs.filter((s) => s.kind === k).length}</small>
          </button>
        ))}
      </div>
      <div className="pl-card">
        {shown.length ? shown.map((s) => (
          <div className="pl-row" key={s.id}>
            <div className="t">
              <strong>{s.title}</strong> <small>{s.artist}</small>
              <div className="pl-sub-inputs no-print">
                <input value={s.moment} placeholder="Moment (optional)" onChange={(e) => ops.update(s.id, { moment: e.target.value })} />
                <input value={s.note} placeholder="Note" onChange={(e) => ops.update(s.id, { note: e.target.value })} />
              </div>
            </div>
            <span className={`pl-tag ${inLibrary(s.title, s.artist) ? "ok" : ""}`} title="Do I have it? checks MB's library">{inLibrary(s.title, s.artist) ? "In MB library" : "We'll source it"}</span>
            <select value={s.kind} onChange={(e) => ops.update(s.id, { kind: e.target.value as typeof s.kind })}>
              {songKinds.map((k) => <option key={k}>{k}</option>)}
            </select>
            {s.id.startsWith("guest-") && <span className="pl-tag">Guest request</span>}
            <RowTools
              onRemove={() => {
                if (!s.id.startsWith("guest-")) return ops.remove(s.id);
                if (!confirm("This song came from an approved guest request. Remove it and decline the request?")) return;
                api("/api/planner/requests", { method: "PATCH", body: { id: s.id.slice(6), status: "declined" } })
                  .then(reload)
                  .catch((e) => alert(e.message));
              }}
            />
          </div>
        )) : <Empty>No songs here yet. Search the library below or add your own.</Empty>}
      </div>

      <div className="pl-split no-print">
        <div className="pl-card">
          <div className="pl-k">Search MB&apos;s library</div>
          <div className="pl-add">
            <input value={q} placeholder="Song or artist" onChange={(e) => setQ(e.target.value)} />
            <select value={cat} onChange={(e) => setCat(e.target.value)}><option>All</option>{musicCategories.map((c) => <option key={c}>{c}</option>)}</select>
            <select value={genre} onChange={(e) => setGenre(e.target.value)}><option>All</option>{musicGenres.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="pl-add">
            <span className="pl-sub">Add as</span>
            <Select value={kind} options={songKinds} onChange={setKind} />
          </div>
          <div className="pl-results">
            {results.map((s) => (
              <div className="pl-row" key={`${s.title}-${s.artist}`}>
                <span className="t"><strong>{s.title}</strong> <small>{s.artist} · {s.genre}</small></span>
                <span className="pl-tag">{s.category}</span>
                <button className="pl-btn sm" disabled={has(s.title)} onClick={() => add(s.title, s.artist, s.category === "Party" ? "" : s.category)}>{has(s.title) ? "Added" : "Add"}</button>
              </div>
            ))}
            {!results.length && <Empty>No matches. Add it as a custom song.</Empty>}
          </div>
          <form className="pl-add" onSubmit={(e) => { e.preventDefault(); if (!custom.title.trim()) return; add(custom.title.trim(), custom.artist.trim()); setCustom({ title: "", artist: "" }); }}>
            <input value={custom.title} placeholder="Custom song title" onChange={(e) => setCustom({ ...custom, title: e.target.value })} />
            <input value={custom.artist} placeholder="Artist" onChange={(e) => setCustom({ ...custom, artist: e.target.value })} />
            <button className="pl-btn">Add song</button>
          </form>
        </div>
        <div className="pl-card">
          <div className="pl-k">Most requested at MB events</div>
          <ol className="pl-chart">
            {mostRequested.map((s) => (
              <li key={s.title}>
                <span className="t"><strong>{s.title}</strong> <small>{s.artist}</small></span>
                <button className="pl-btn sm" disabled={has(s.title)} onClick={() => add(s.title, s.artist)}>{has(s.title) ? "Added" : "Add"}</button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}

// ---------- Guest request system ----------

export function GuestRequests({ bundle, reload }: Props) {
  const [busy, setBusy] = useState("");
  const link = `${typeof window === "undefined" ? "" : window.location.origin}/planner/guest?code=${bundle.guestCode}&pw=${bundle.guestPassword}`;
  const act = async (id: string, body: object | null) => {
    setBusy(id);
    try {
      if (body) await api("/api/planner/requests", { method: "PATCH", body: { id, ...body } });
      else await api(`/api/planner/requests?id=${id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const share = `Request songs for our ${bundle.data.details.eventType || "event"}! Tap to add yours:\n${link}`;
  return (
    <Section eyebrow="Guest requests" title="Let your guests pick songs" intro="Share this link. Guests add requests before the event, and songs you approve go straight into your music list for the DJ.">
      <div className="pl-card pl-share">
        <div><div className="pl-k">Guest link (no password needed)</div><code>{link}</code></div>
        <div><div className="pl-k">Guest code</div><code>{bundle.guestCode}</code></div>
        <div><div className="pl-k">Password</div><code>{bundle.guestPassword}</code></div>
        <button className="pl-btn" onClick={() => navigator.clipboard.writeText(share).then(() => alert("Copied. Paste it into a text, email, or your invitation."))}>Copy invite text</button>
        {!bundle.admin.guestRequestsOpen && <p className="pl-warn">Requests are currently closed. Message MB to reopen them.</p>}
      </div>
      <div className="pl-card">
        {bundle.requests.length ? bundle.requests.map((r) => (
          <div className="pl-row" key={r.id}>
            <span className="t"><strong>{r.title}</strong> <small>{r.artist}</small><br /><small>from {r.guest_name}{r.note && ` · "${r.note}"`}</small></span>
            <span className={`pl-tag ${r.status === "approved" ? "ok" : r.status === "declined" ? "bad" : ""}`}>{r.status}</span>
            <span className="pl-rowtools">
              <button disabled={busy === r.id} onClick={() => act(r.id, { status: "approved" })}>Approve</button>
              <button disabled={busy === r.id} onClick={() => act(r.id, { status: "declined" })}>Decline</button>
              <button disabled={busy === r.id} className="danger" aria-label="Delete" onClick={() => confirm("Delete this request?") && act(r.id, null)}>×</button>
            </span>
          </div>
        )) : <Empty>No guest requests yet.</Empty>}
      </div>
    </Section>
  );
}

// ---------- Timeline ----------

export function Timeline({ bundle, set }: Props) {
  const ops = useListOps(bundle.data.timeline, (next) => set("timeline", next));
  return (
    <Section eyebrow="Timeline" title="Run of show" intro="Edit times and moments. MB uses this as the night's running order." actions={<button className="pl-btn ghost" onClick={() => window.print()}>Print timeline</button>}>
      <div className="pl-table">
        {bundle.data.timeline.map((t) => (
          <div className="pl-tr timeline" key={t.id}>
            <input className="time" value={t.time} placeholder="7:00 PM" onChange={(e) => ops.update(t.id, { time: e.target.value })} />
            <input value={t.what} placeholder="What happens" onChange={(e) => ops.update(t.id, { what: e.target.value })} />
            <input value={t.song} placeholder="Song" onChange={(e) => ops.update(t.id, { song: e.target.value })} />
            <input value={t.who} placeholder="Who's involved" onChange={(e) => ops.update(t.id, { who: e.target.value })} />
            <RowTools onUp={() => ops.move(t.id, -1)} onDown={() => ops.move(t.id, 1)} onRemove={() => ops.remove(t.id)} />
          </div>
        ))}
        {!bundle.data.timeline.length && <Empty>No moments yet.</Empty>}
      </div>
      <button className="pl-btn ghost no-print" onClick={() => ops.add({ id: newId(), time: "", what: "", song: "", who: "" })}>Add moment</button>
    </Section>
  );
}

// ---------- Checklist ----------

export function Checklist({ bundle, set }: Props) {
  const list = bundle.data.checklist;
  const ops = useListOps(list, (next) => set("checklist", next));
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const done = list.filter((c) => c.done).length;
  return (
    <Section eyebrow="Checklist" title={`${done} of ${list.length} done`} intro="Tasks are listed with how far ahead of the event they should be finished.">
      <div className="pl-card">
        {list.map((c) => (
          <div className={`pl-row ${c.done ? "done" : ""}`} key={c.id}>
            <input type="checkbox" checked={c.done} onChange={() => ops.update(c.id, { done: !c.done })} aria-label={c.text} />
            <input className="t plain" value={c.text} onChange={(e) => ops.update(c.id, { text: e.target.value })} />
            <input className="due" value={c.due} placeholder="When" onChange={(e) => ops.update(c.id, { due: e.target.value })} />
            <RowTools onRemove={() => ops.remove(c.id)} />
          </div>
        ))}
        <form className="pl-add no-print" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; ops.add({ id: newId(), text: text.trim(), due, done: false }); setText(""); setDue(""); }}>
          <input value={text} placeholder="Add a task" onChange={(e) => setText(e.target.value)} />
          <input value={due} placeholder="When (e.g. 2 weeks)" onChange={(e) => setDue(e.target.value)} />
          <button className="pl-btn">Add</button>
        </form>
      </div>
    </Section>
  );
}

// ---------- Guest list & RSVP ----------

export function Guests({ bundle, set }: Props) {
  const list = bundle.data.guests;
  const ops = useListOps(list, (next) => set("guests", next));
  const [name, setName] = useState("");
  const [party, setParty] = useState("1");
  const [bulk, setBulk] = useState("");
  const count = (r?: string) => list.filter((g) => !r || g.rsvp === r).reduce((n, g) => n + g.party, 0);
  const exportCsv = () => {
    const rows = [["Name", "Party size", "RSVP", "Table"], ...list.map((g) => [g.name, String(g.party), g.rsvp, g.table])];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "guest-list.csv";
    a.click();
  };
  return (
    <Section eyebrow="Guests" title={`${count("Yes")} attending`} intro={`${count()} invited · ${count("Pending")} pending · ${count("No")} declined`} actions={<><button className="pl-btn ghost" onClick={exportCsv}>Export CSV</button><button className="pl-btn ghost" onClick={() => window.print()}>Print</button></>}>
      <div className="pl-card">
        {list.map((g) => (
          <div className="pl-row" key={g.id}>
            <input className="t plain" value={g.name} onChange={(e) => ops.update(g.id, { name: e.target.value })} />
            <input className="due" type="number" min={1} value={g.party} aria-label="Party size" onChange={(e) => ops.update(g.id, { party: Math.max(1, Number(e.target.value) || 1) })} />
            <input className="due" value={g.table} placeholder="Table" onChange={(e) => ops.update(g.id, { table: e.target.value })} />
            <select value={g.rsvp} onChange={(e) => ops.update(g.id, { rsvp: e.target.value as typeof g.rsvp })}><option>Pending</option><option>Yes</option><option>No</option></select>
            <RowTools onRemove={() => ops.remove(g.id)} />
          </div>
        ))}
        {!list.length && <Empty>No guests yet.</Empty>}
        <form className="pl-add no-print" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; ops.add({ id: newId(), name: name.trim(), party: Math.max(1, Number(party) || 1), rsvp: "Pending", table: "" }); setName(""); setParty("1"); }}>
          <input value={name} placeholder="Guest or household name" onChange={(e) => setName(e.target.value)} />
          <input type="number" min={1} value={party} onChange={(e) => setParty(e.target.value)} aria-label="Party size" style={{ maxWidth: 90 }} />
          <button className="pl-btn">Add guest</button>
        </form>
        <details className="no-print">
          <summary className="pl-link">Paste many guests at once</summary>
          <textarea rows={4} value={bulk} placeholder="One name per line" onChange={(e) => setBulk(e.target.value)} />
          <button className="pl-btn ghost" onClick={() => { const names = bulk.split("\n").map((s) => s.trim()).filter(Boolean); set("guests", [...list, ...names.map((n) => ({ id: newId(), name: n, party: 1, rsvp: "Pending" as const, table: "" }))]); setBulk(""); }}>Add {bulk.split("\n").filter((s) => s.trim()).length} guests</button>
        </details>
      </div>
    </Section>
  );
}

// ---------- Team & vendors ----------

export function Team({ bundle, set }: Props) {
  const ops = useListOps(bundle.data.team, (next) => set("team", next));
  return (
    <Section eyebrow="Team" title="Your vendors" intro="Photographer, florist, planner, venue: everyone MB should coordinate with on the day.">
      <div className="pl-table">
        {bundle.data.team.map((m) => (
          <div className="pl-tr" key={m.id}>
            <input value={m.role} placeholder="Role" onChange={(e) => ops.update(m.id, { role: e.target.value })} />
            <input value={m.name} placeholder="Contact name" onChange={(e) => ops.update(m.id, { name: e.target.value })} />
            <input value={m.company} placeholder="Company" onChange={(e) => ops.update(m.id, { company: e.target.value })} />
            <input value={m.phone} placeholder="Phone" onChange={(e) => ops.update(m.id, { phone: e.target.value })} />
            <input value={m.email} placeholder="Email" onChange={(e) => ops.update(m.id, { email: e.target.value })} />
            <RowTools onRemove={() => ops.remove(m.id)} />
          </div>
        ))}
      </div>
      <button className="pl-btn ghost no-print" onClick={() => ops.add({ id: newId(), name: "", role: "", company: "", phone: "", email: "" })}>Add vendor</button>
    </Section>
  );
}

// ---------- Documents & e-signature ----------

export function Documents({ bundle, reload }: Props) {
  const docs = bundle.admin.documents;
  const [open, setOpen] = useState<string | null>(docs.find((d) => d.status === "sent")?.id ?? null);
  const [name, setName] = useState("");
  const [sig, setSig] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const doc = docs.find((d) => d.id === open);
  const sign = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      await api("/api/planner/sign", { body: { docId: doc.id, name, signature: sig, agree } });
      await reload();
      setName(""); setSig(""); setAgree(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section eyebrow="Documents" title="Agreements & invoices" intro="Read, sign, and print your documents.">
      {!docs.length && <Empty>MB hasn&apos;t shared any documents yet.</Empty>}
      <div className="pl-doclist no-print">
        {docs.map((d) => (
          <button key={d.id} className={`pl-card pl-docbtn ${open === d.id ? "on" : ""}`} onClick={() => setOpen(d.id)}>
            <strong>{d.title}</strong>
            <span className={`pl-tag ${d.status === "signed" ? "ok" : ""}`}>{d.status === "signed" ? `Signed ${fmtDate(d.signedAt)}` : "Needs signature"}</span>
          </button>
        ))}
      </div>
      {doc && (
        <article className="pl-card pl-doc">
          <pre>{doc.status === "signed" ? doc.body : fillMergeTags(doc.body, bundle.data, bundle.admin)}</pre>
          {doc.status === "signed" ? (
            <div className="pl-signed">
                {/* eslint-disable-next-line @next/next/no-img-element -- signature is a data URL */}
              <img src={doc.signature} alt={`Signature of ${doc.signedName}`} />
              <div>Signed by {doc.signedName} on {new Date(doc.signedAt).toLocaleString("en-US")}</div>
            </div>
          ) : (
            <div className="pl-signbox no-print">
              <Field label="Type your full legal name"><Text value={name} onChange={setName} /></Field>
              <div className="pl-field wide"><span>Draw your signature</span><SignaturePad onChange={setSig} /></div>
              <label className="pl-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree to sign this document electronically and to its terms.</label>
              <button className="pl-btn" disabled={busy || !agree || name.trim().length < 2 || !sig} onClick={sign}>{busy ? "Signing..." : "Sign document"}</button>
            </div>
          )}
          <button className="pl-btn ghost no-print" onClick={() => window.print()}>Print / save as PDF</button>
        </article>
      )}
    </Section>
  );
}

// ---------- Invoice & payments ----------

export function Payments({ bundle }: Props) {
  const { admin } = bundle;
  const t = totals(admin);
  const [busy, setBusy] = useState("");
  const status = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("payment");
  const pay = async (paymentId: string) => {
    setBusy(paymentId);
    try {
      const { url } = await api<{ url: string }>("/api/planner/pay", { body: { paymentId } });
      window.location.assign(url);
    } catch (e) {
      alert((e as Error).message);
      setBusy("");
    }
  };
  return (
    <Section eyebrow="Payments" title={t.balance > 0 ? `${money(t.balance)} remaining` : t.total ? "Paid in full" : "Your invoice"} actions={<button className="pl-btn ghost" onClick={() => window.print()}>Print invoice</button>}>
      {status === "success" && <p className="pl-ok">Payment received. Thank you!</p>}
      {status === "pending" && <p className="pl-warn">Your payment is processing. It will show here once confirmed.</p>}
      {status === "error" && <p className="pl-warn">We couldn&apos;t confirm that payment. If you were charged, message MB.</p>}
      <div className="pl-card">
        <div className="pl-k">{admin.packageName || "Package"}</div>
        {admin.lineItems.length ? (
          <table className="pl-invoice">
            <tbody>
              {admin.lineItems.map((i) => <tr key={i.id}><td>{i.description}{i.qty !== 1 && ` x${i.qty}`}</td><td>{money(i.qty * i.price)}</td></tr>)}
              {admin.taxRate > 0 && <tr><td>Tax ({admin.taxRate}%)</td><td>{money(t.total - t.subtotal)}</td></tr>}
              <tr className="total"><td>Total</td><td>{money(t.total)}</td></tr>
              <tr><td>Paid</td><td>{money(t.paid)}</td></tr>
              <tr className="total"><td>Balance</td><td>{money(t.balance)}</td></tr>
            </tbody>
          </table>
        ) : <Empty>MB will add your package details here.</Empty>}
      </div>
      <h3 className="pl-h3">Payment schedule & history</h3>
      <div className="pl-card">
        {admin.payments.length ? admin.payments.map((p) => (
          <div className="pl-row" key={p.id}>
            <span className="t"><strong>{p.label}</strong><br /><small>{p.status === "paid" ? `Paid ${fmtDate(p.paidAt)}${p.method ? ` · ${p.method}` : ""}` : p.due ? `Due ${fmtDate(p.due)}` : "Due"}</small></span>
            <span>{money(p.amount)}</span>
            {p.status === "paid" ? <span className="pl-tag ok">Paid</span> : bundle.paymentsOnline ? <button className="pl-btn sm" disabled={busy === p.id} onClick={() => pay(p.id)}>{busy === p.id ? "Opening..." : "Pay now"}</button> : <span className="pl-tag">Due</span>}
          </div>
        )) : <Empty>No payments scheduled yet.</Empty>}
        {!bundle.paymentsOnline && admin.payments.some((p) => p.status === "due") && <p className="pl-intro">To pay, call (855) 627-6863 or message MB. Online card payments will appear here once enabled.</p>}
      </div>
    </Section>
  );
}

// ---------- Messages ----------

export function Messages({ bundle, reload }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api("/api/planner/messages", { body: { body: text } });
      setText("");
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section eyebrow="Messages" title="Talk to MB" intro="Questions, changes, ideas. Everything stays in one thread with your planning team.">
      <div className="pl-card pl-thread">
        {bundle.messages.length ? bundle.messages.map((m) => (
          <div key={m.id} className={`pl-msg ${m.sender}`}>
            <div>{m.body}</div>
            <small>{m.sender === "mb" ? "MB Events" : "You"} · {new Date(m.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</small>
          </div>
        )) : <Empty>No messages yet. Say hello!</Empty>}
      </div>
      <div className="pl-add">
        <textarea rows={3} value={text} placeholder="Write a message" onChange={(e) => setText(e.target.value)} />
        <button className="pl-btn" disabled={busy || !text.trim()} onClick={send}>{busy ? "Sending..." : "Send"}</button>
      </div>
    </Section>
  );
}

// ---------- Evaluation ----------

const AREAS = ["Overall experience", "DJ & music", "MC & announcements", "Lighting & production", "Planning & communication"];

export function Evaluation({ bundle, reload }: Props) {
  const existing = bundle.data.evaluation;
  const [ratings, setRatings] = useState<Record<string, number>>(existing?.ratings ?? {});
  const [comments, setComments] = useState(existing?.comments ?? "");
  const [recommend, setRecommend] = useState(existing?.recommend ?? true);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/planner/evaluation", { body: { ratings, comments, recommend } });
      await reload();
      alert("Thank you! Your feedback was sent to MB.");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section eyebrow="Evaluation" title="How did we do?" intro={existing?.submittedAt ? `Thanks for your feedback on ${fmtDate(existing.submittedAt)}. You can update it anytime.` : "After your event, tell us how the night went."}>
      <div className="pl-card">
        {AREAS.map((area) => (
          <div className="pl-row" key={area}>
            <span className="t">{area}</span>
            <span className="pl-stars" role="radiogroup" aria-label={area}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} role="radio" aria-checked={ratings[area] === n} className={n <= (ratings[area] ?? 0) ? "on" : ""} onClick={() => setRatings({ ...ratings, [area]: n })}>★</button>
              ))}
            </span>
          </div>
        ))}
        <label className="pl-check"><input type="checkbox" checked={recommend} onChange={(e) => setRecommend(e.target.checked)} /> I would recommend MB Events</label>
        <Field label="Comments" wide><Text area value={comments} onChange={setComments} /></Field>
        <button className="pl-btn" disabled={busy || AREAS.some((a) => !ratings[a])} onClick={submit}>{existing?.submittedAt ? "Update feedback" : "Send feedback"}</button>
      </div>
    </Section>
  );
}
