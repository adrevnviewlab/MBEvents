"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminSignOut } from "@/components/admin-auth";
import { api, Section } from "@/components/planner/ui";

const profileTypes = ["dj", "mc", "dancer", "coordinator", "technician", "other"] as const;

type Brief = {
  profile: null | { id: string; name: string; email: string; phone: string; profileType: string; skills: string[] };
  blocks: { id: string; startsAt: string; endsAt: string; note: string }[];
  events: {
    id: string;
    name: string;
    eventType: string;
    eventDate: string | null;
    startTime: string;
    endTime: string;
    loadInInstructions: string;
    setupSchedule: string;
    breakdownSchedule: string;
    venueName: string;
    venueAddress: string;
    assignment: { id: string; roleLabel: string; status: string; callTime: string };
    crew: { name: string; phone: string; email: string; profileType: string; roleLabel: string }[];
    vendors: { name: string; category: string; contactName: string; email: string; phone: string; role: string }[];
    checklist: { id: string; title: string; done: boolean }[];
    packing: { id: string; label: string; packed: boolean }[];
    reservations: { id: string; equipmentName: string; quantity: number; returnedAt: string | null; damageNotes: string }[];
    incidents: { id: string; body: string; createdAt: string }[];
    runOfShow?: {
      timeline: { time: string; endTime?: string; what: string; song: string; who: string; kind?: string; notes?: string }[];
      mustPlay: { title: string; artist: string; moment: string }[];
      doNotPlay: { title: string; artist: string }[];
      specialMoments: { title: string; artist: string; moment: string }[];
      mcNotes: string;
    };
  }[];
};

const shown = (value: string) => value.trim() || "Not entered yet.";

export function StaffHome({ office }: { office: boolean }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState("");
  const [profileType, setProfileType] = useState("other");
  const [skills, setSkills] = useState("");
  const [block, setBlock] = useState({ startsAt: "", endsAt: "", note: "" });

  const load = useCallback(() => api<Brief>("/api/staff").then((next) => {
    setBrief(next);
    if (next.profile) {
      setProfileType(next.profile.profileType);
      setSkills(next.profile.skills.join(", "));
    }
  }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const send = async (body: Record<string, unknown>) => {
    setError("");
    try {
      setBrief(await api<Brief>("/api/staff", { body }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="pl">
      <div className="pl-wrap">
        <div className="pl-top">
          <span>MB Events · My events</span>
          <span>{office && <><a href="/admin">Office</a> · </>}<AdminSignOut /></span>
        </div>
        <header className="pl-hero">
          <h1>{brief?.profile?.name || "My events"}</h1>
          <p className="pl-intro">Events you are assigned to. Rates, payouts, and office notes stay in the office.</p>
        </header>
        {error && <p className="pl-warn">{error}</p>}
        {!brief ? <p className="pl-empty">Loading...</p> : (
          <>
            <Section eyebrow="Profile" title="How you work">
              <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); send({ action: "profile", profileType, skills: skills.split(",") }); }}>
                <label className="pl-field"><span>Profile</span>
                  <select value={profileType} onChange={(e) => setProfileType(e.target.value)}>
                    {profileTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label className="pl-field wide"><span>Skills</span><input value={skills} placeholder="Tags you enter, separated by commas" onChange={(e) => setSkills(e.target.value)} /></label>
                <div className="wide"><button className="pl-btn">Save profile</button></div>
              </form>
            </Section>
            <Section eyebrow="Availability" title="Unavailable windows">
              <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); send({ action: "block", ...block }).then(() => setBlock({ startsAt: "", endsAt: "", note: "" })); }}>
                <label className="pl-field"><span>From</span><input type="datetime-local" required value={block.startsAt} onChange={(e) => setBlock({ ...block, startsAt: e.target.value })} /></label>
                <label className="pl-field"><span>Until</span><input type="datetime-local" required value={block.endsAt} onChange={(e) => setBlock({ ...block, endsAt: e.target.value })} /></label>
                <label className="pl-field wide"><span>Note</span><input value={block.note} onChange={(e) => setBlock({ ...block, note: e.target.value })} /></label>
                <div className="wide"><button className="pl-btn">Add unavailable window</button></div>
              </form>
              <div className="pl-card">
                {brief.blocks.length ? brief.blocks.map((item) => (
                  <div className="pl-row" key={item.id}>
                    <span className="t">{new Date(item.startsAt).toLocaleString("en-US")} – {new Date(item.endsAt).toLocaleString("en-US")} {item.note}</span>
                    <button className="pl-link" onClick={() => send({ action: "removeBlock", blockId: item.id })}>Remove</button>
                  </div>
                )) : <p className="pl-empty">No unavailable windows.</p>}
              </div>
            </Section>
            {brief.events.length ? brief.events.map((event) => (
              <Section key={event.id} eyebrow={event.eventType || "Event"} title={event.name || "Untitled event"}>
                <div className="pl-card">
                  <div className="pl-row"><span className="pl-k">When</span><span className="t">{[event.eventDate, event.startTime, event.endTime].filter(Boolean).join(" · ") || "Not entered yet."}</span></div>
                  <div className="pl-row"><span className="pl-k">Venue</span><span className="t">{[event.venueName, event.venueAddress].filter(Boolean).join(", ") || "Not entered yet."}</span></div>
                  <div className="pl-row"><span className="pl-k">Your role</span><span className="t">{event.assignment.roleLabel || "Assigned"} <span className="pl-tag">{event.assignment.status}</span></span></div>
                  <div className="pl-row"><span className="pl-k">Load-in</span><span className="t">{shown(event.loadInInstructions)}</span></div>
                  <div className="pl-row"><span className="pl-k">Setup</span><span className="t">{shown(event.setupSchedule)}</span></div>
                  <div className="pl-row"><span className="pl-k">Breakdown</span><span className="t">{shown(event.breakdownSchedule)}</span></div>
                  {event.assignment.status !== "confirmed" && <button className="pl-btn" onClick={() => send({ action: "respond", assignmentId: event.assignment.id, decision: "accept" })}>Accept</button>}
                  {event.assignment.status !== "declined" && <button className="pl-btn ghost" onClick={() => send({ action: "respond", assignmentId: event.assignment.id, decision: "decline" })}>Decline</button>}
                </div>
                <h3 className="pl-h3">Run of show</h3>
                <div className="pl-card">
                  {event.runOfShow?.timeline?.length ? event.runOfShow.timeline.map((item, index) => (
                    <div className="pl-row" key={`${item.time}-${item.what}-${index}`}>
                      <span className="t">
                        <strong>{item.time || "—"}{item.endTime ? ` – ${item.endTime}` : ""}</strong>
                        {" "}{item.what}
                        {item.kind ? <small> · {item.kind.replaceAll("_", " ")}</small> : null}
                        {item.who ? <small> · {item.who}</small> : null}
                        {item.song ? <small> · {item.song}</small> : null}
                        {item.notes ? <small className="pl-tl-staff-notes"> — {item.notes}</small> : null}
                      </span>
                    </div>
                  )) : <p className="pl-empty">No timeline moments yet.</p>}
                  {event.runOfShow?.mustPlay?.length ? (
                    <>
                      <h4 className="pl-h3">Must play</h4>
                      {event.runOfShow.mustPlay.map((song, index) => (
                        <div className="pl-row" key={`m-${index}`}><span className="t"><strong>{song.title}</strong> <small>{[song.artist, song.moment].filter(Boolean).join(" · ")}</small></span></div>
                      ))}
                    </>
                  ) : null}
                  {event.runOfShow?.doNotPlay?.length ? (
                    <>
                      <h4 className="pl-h3">Do not play</h4>
                      {event.runOfShow.doNotPlay.map((song, index) => (
                        <div className="pl-row" key={`d-${index}`}><span className="t"><strong>{song.title}</strong> <small>{song.artist}</small></span></div>
                      ))}
                    </>
                  ) : null}
                  {event.runOfShow?.specialMoments?.length ? (
                    <>
                      <h4 className="pl-h3">Special moments</h4>
                      {event.runOfShow.specialMoments.map((song, index) => (
                        <div className="pl-row" key={`s-${index}`}><span className="t"><strong>{song.title}</strong> <small>{[song.artist, song.moment].filter(Boolean).join(" · ")}</small></span></div>
                      ))}
                    </>
                  ) : null}
                  {event.runOfShow?.mcNotes ? <p className="pl-intro">{event.runOfShow.mcNotes}</p> : null}
                </div>
                <h3 className="pl-h3">Crew</h3>
                <div className="pl-card">
                  {event.crew.length ? event.crew.map((person) => (
                    <div className="pl-row" key={`${person.email}-${person.roleLabel}`}><span className="t"><strong>{person.name}</strong> <small>{[person.profileType, person.roleLabel, person.phone, person.email].filter(Boolean).join(" · ")}</small></span></div>
                  )) : <p className="pl-empty">No other crew stored for this event.</p>}
                </div>
                <h3 className="pl-h3">Vendors</h3>
                <div className="pl-card">
                  {event.vendors.length ? event.vendors.map((vendor) => (
                    <div className="pl-row" key={`${vendor.name}-${vendor.email}`}><span className="t"><strong>{vendor.name || vendor.contactName || "Vendor"}</strong> <small>{[vendor.role || vendor.category, vendor.contactName, vendor.phone, vendor.email].filter(Boolean).join(" · ")}</small></span></div>
                  )) : <p className="pl-empty">No vendors linked to this event.</p>}
                </div>
                <h3 className="pl-h3">Completion checklist</h3>
                <div className="pl-card">
                  {event.checklist.length ? event.checklist.map((item) => (
                    <label className="pl-row" key={item.id}><input type="checkbox" checked={item.done} onChange={(e) => send({ action: "checklist", itemId: item.id, done: e.target.checked })} /><span className="t">{item.title}</span></label>
                  )) : <p className="pl-empty">No internal checklist items.</p>}
                </div>
                <h3 className="pl-h3">Packing</h3>
                <div className="pl-card">
                  {event.packing.length ? event.packing.map((item) => (
                    <label className="pl-row" key={item.id}><input type="checkbox" checked={item.packed} onChange={(e) => send({ action: "packing", itemId: item.id, packed: e.target.checked })} /><span className="t">{item.label}</span></label>
                  )) : <p className="pl-empty">No packing items.</p>}
                  {event.reservations.map((item) => (
                    <div className="pl-row" key={item.id}><span className="t">{item.equipmentName} × {item.quantity}{item.damageNotes ? ` · ${item.damageNotes}` : ""}{item.returnedAt ? " · Returned" : ""}</span></div>
                  ))}
                </div>
                <h3 className="pl-h3">Incidents</h3>
                <div className="pl-card">
                  {event.incidents.length ? event.incidents.map((item) => <div className="pl-row" key={item.id}><span className="t">{item.body}</span></div>) : <p className="pl-empty">No incidents filed.</p>}
                  <form className="pl-form" onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const body = new FormData(form).get("body");
                    send({ action: "incident", eventId: event.id, body }).then(() => form.reset());
                  }}>
                    <label className="pl-field wide"><span>File an incident</span><textarea name="body" rows={3} /></label>
                    <div className="wide"><button className="pl-btn">File incident</button></div>
                  </form>
                </div>
              </Section>
            )) : <p className="pl-empty">No events are assigned to you.</p>}
          </>
        )}
      </div>
    </div>
  );
}
