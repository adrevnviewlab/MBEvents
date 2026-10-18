"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Field, Section, Text } from "@/components/planner/ui";

type Office = {
  event: { id: string; name: string; loadInInstructions: string; setupSchedule: string; breakdownSchedule: string; internalNotes: string };
  readiness: "unset" | "not_ready" | "ready";
  money: boolean;
  checklist: { id: string; title: string; done: boolean }[];
  requirements: { id: string; label: string; met: boolean }[];
  assignments: {
    id: string;
    staffId?: string;
    staffName: string;
    roleLabel: string;
    status: string;
    callTime: string;
    startsAt: string | null;
    endsAt: string | null;
    payoutCents: number | null;
    internalNotes: string;
    blockConflict?: boolean;
    profileHref?: string;
  }[];
  vendors: { id: string; company: string; contact_name: string; phone: string; email: string }[];
  vendorOptions: { id: string; name: string; category: string }[];
  staffOptions: { id: string; name: string; profileType: string; rateCents: number | null }[];
  categories: { id: string; name: string }[];
  assets: { id: string; name: string; quantity: number }[];
  reservations: {
    id: string;
    equipment_id: string;
    equipmentName: string;
    quantity: number;
    returned_at: string | null;
    canceled_at: string | null;
    checked_out_at?: string | null;
    maintenance_notes: string;
    damage_notes: string;
    stockPressure?: boolean;
    directoryHref?: string;
  }[];
  packing: { id: string; reservationId: string; label: string; packed: boolean }[];
  staffBlocks: { id: string; staffId: string; staffName: string; startsAt: string; endsAt: string; note: string }[];
  incidents: { id: string; body: string; created_at: string }[];
  access: { events: boolean; assignments: boolean; equipment: boolean; vendors: boolean };
};

const readinessLabel = { unset: "Unset", not_ready: "Not ready", ready: "Ready" };

export function EventOperations({ eventId, slice = "all", embedded = false }: { eventId: string; slice?: "all" | "site" | "readiness" | "staff" | "vendors" | "equipment" | "incidents"; embedded?: boolean }) {
  const [data, setData] = useState<Office | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState({ loadInInstructions: "", setupSchedule: "", breakdownSchedule: "", internalNotes: "" });
  const [assign, setAssign] = useState({ staffId: "", roleLabel: "", callTime: "", startsAt: "", endsAt: "", payoutCents: "", internalNotes: "" });
  const [profile, setProfile] = useState({ staffId: "", profileType: "other", skills: "", rateCents: "" });
  const [block, setBlock] = useState({ staffId: "", startsAt: "", endsAt: "", note: "" });

  const load = useCallback(() => api<Office>(`/api/admin/operations?eventId=${encodeURIComponent(eventId)}`).then((next) => {
    setData(next);
    setFields({
      loadInInstructions: next.event.loadInInstructions,
      setupSchedule: next.event.setupSchedule,
      breakdownSchedule: next.event.breakdownSchedule,
      internalNotes: next.event.internalNotes,
    });
  }).catch((e) => setError(e.message)), [eventId]);
  useEffect(() => { load(); }, [load]);

  const send = async (body: Record<string, unknown>) => {
    setError("");
    try {
      setData(await api<Office>("/api/admin/operations", { body: { eventId, ...body } }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const show = (name: "site" | "readiness" | "staff" | "vendors" | "equipment" | "incidents") => slice === "all" || slice === name;
  if (!data) {
    const waiting = <p className="pl-empty">{error || "Loading..."}</p>;
    if (embedded) return waiting;
    return <div className="pl"><div className="pl-wrap">{waiting}</div></div>;
  }

  const body = (
    <>
        {error && <p className="pl-warn" role="alert">{error}</p>}

        {show("site") && <Section eyebrow="Site" title="Load-in and schedule">
          <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); send({ action: "event", ...fields }); }}>
            <Field label="Load-in instructions" wide><Text area value={fields.loadInInstructions} onChange={(v) => setFields({ ...fields, loadInInstructions: v })} /></Field>
            <Field label="Setup schedule" wide><Text area value={fields.setupSchedule} onChange={(v) => setFields({ ...fields, setupSchedule: v })} /></Field>
            <Field label="Breakdown schedule" wide><Text area value={fields.breakdownSchedule} onChange={(v) => setFields({ ...fields, breakdownSchedule: v })} /></Field>
            <Field label="Internal notes" wide><Text area value={fields.internalNotes} onChange={(v) => setFields({ ...fields, internalNotes: v })} /></Field>
            {data.access.events && <div className="wide"><button className="pl-btn">Save</button></div>}
          </form>
        </Section>}

        {show("readiness") && <Section eyebrow="Readiness" title={readinessLabel[data.readiness]}>
          <form className="pl-add" onSubmit={(e) => { e.preventDefault(); const label = new FormData(e.currentTarget).get("label"); send({ action: "requirement", label }).then(() => e.currentTarget.reset()); }}>
            <input name="label" placeholder="Requirement" disabled={!data.access.events} />
            {data.access.events && <button className="pl-btn">Add requirement</button>}
          </form>
          <div className="pl-card">
            {data.requirements.length ? data.requirements.map((item) => (
              <label className="pl-row" key={item.id}><input type="checkbox" checked={item.met} disabled={!data.access.events} onChange={(e) => send({ action: "requirementMet", requirementId: item.id, met: e.target.checked })} /><span className="t">{item.label}</span></label>
            )) : <p className="pl-empty">No requirements yet. This event is unset, not ready.</p>}
          </div>
          <h3 className="pl-h3">Completion checklist</h3>
          <form className="pl-add" onSubmit={(e) => { e.preventDefault(); const title = new FormData(e.currentTarget).get("title"); send({ action: "checklist", title }).then(() => e.currentTarget.reset()); }}>
            <input name="title" placeholder="Checklist item" disabled={!data.access.events} />
            {data.access.events && <button className="pl-btn ghost">Add item</button>}
          </form>
          <div className="pl-card">
            {data.checklist.length ? data.checklist.map((item) => (
              <label className="pl-row" key={item.id}>
                <input type="checkbox" checked={item.done} disabled={!data.access.events} onChange={(e) => send({ action: "checklistDone", itemId: item.id, done: e.target.checked })} />
                <span className="t">{item.title}</span>
              </label>
            )) : <p className="pl-empty">No internal checklist items.</p>}
          </div>
        </Section>}

        {show("staff") && <Section eyebrow="Crew" title="Assignments">
          <p className="pl-intro"><a href="/admin/staff">Staff roster</a> · assign for this event below. Overlapping shifts are rejected by the booking engine. Staff is not required before owner confirmation.</p>
          <form className="pl-card pl-form" onSubmit={(e) => {
            e.preventDefault();
            send({
              action: "assign",
              staffId: assign.staffId,
              roleLabel: assign.roleLabel,
              callTime: assign.callTime,
              startsAt: assign.startsAt || null,
              endsAt: assign.endsAt || null,
              payoutCents: assign.payoutCents,
              internalNotes: assign.internalNotes,
            });
          }}>
            <Field label="Person"><select value={assign.staffId} onChange={(e) => setAssign({ ...assign, staffId: e.target.value })}><option value="">Choose</option>{data.staffOptions.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.profileType}</option>)}</select></Field>
            <Field label="Role / DJ label"><Text value={assign.roleLabel} onChange={(v) => setAssign({ ...assign, roleLabel: v })} placeholder="DJ, MC, Technician, Coordinator…" /></Field>
            <Field label="Call time"><Text value={assign.callTime} onChange={(v) => setAssign({ ...assign, callTime: v })} placeholder="e.g. 3:00 PM" /></Field>
            <Field label="Shift start"><input type="datetime-local" value={assign.startsAt} onChange={(e) => setAssign({ ...assign, startsAt: e.target.value })} /></Field>
            <Field label="Shift end"><input type="datetime-local" value={assign.endsAt} onChange={(e) => setAssign({ ...assign, endsAt: e.target.value })} /></Field>
            {data.money && <Field label="Payout (cents)"><Text value={assign.payoutCents} onChange={(v) => setAssign({ ...assign, payoutCents: v })} placeholder="Leave blank for none" /></Field>}
            <Field label="Internal notes" wide><Text value={assign.internalNotes} onChange={(v) => setAssign({ ...assign, internalNotes: v })} /></Field>
            {data.access.assignments && <div className="wide"><button className="pl-btn" disabled={!assign.staffId}>Assign</button></div>}
          </form>
          <div className="pl-card">
            {data.assignments.length ? data.assignments.map((item) => (
              <div className="pl-row" key={item.id}>
                <span className="t">
                  {item.profileHref ? <a href={item.profileHref}><strong>{item.staffName}</strong></a> : <strong>{item.staffName}</strong>}{" "}
                  <small>
                    {[item.roleLabel, item.status, item.callTime ? `call ${item.callTime}` : "", item.startsAt ? `from ${item.startsAt}` : "", data.money && item.payoutCents !== null ? `${item.payoutCents} cents` : ""].filter(Boolean).join(" · ")}
                    {item.blockConflict ? " · Availability conflict" : ""}
                    {item.internalNotes ? ` · ${item.internalNotes}` : ""}
                  </small>
                </span>
              </div>
            )) : <p className="pl-empty">Nobody is assigned.</p>}
          </div>
          <h3 className="pl-h3">Availability blocks</h3>
          <p className="pl-intro">Office can record when someone is unavailable. Block overlaps show as conflict indicators; hard shift overlaps stay blocked by the engine.</p>
          <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); send({ action: "block", staffId: block.staffId, startsAt: block.startsAt, endsAt: block.endsAt, note: block.note }); }}>
            <Field label="Person"><select value={block.staffId} onChange={(e) => setBlock({ ...block, staffId: e.target.value })}><option value="">Choose</option>{data.staffOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
            <Field label="Unavailable from"><input type="datetime-local" value={block.startsAt} onChange={(e) => setBlock({ ...block, startsAt: e.target.value })} /></Field>
            <Field label="Unavailable until"><input type="datetime-local" value={block.endsAt} onChange={(e) => setBlock({ ...block, endsAt: e.target.value })} /></Field>
            <Field label="Note" wide><Text value={block.note} onChange={(v) => setBlock({ ...block, note: v })} /></Field>
            {data.access.assignments && <div className="wide"><button className="pl-btn ghost" disabled={!block.staffId || !block.startsAt || !block.endsAt}>Add block</button></div>}
          </form>
          <div className="pl-card">
            {data.staffBlocks.length ? data.staffBlocks.map((item) => (
              <div className="pl-row" key={item.id}><span className="t"><strong>{item.staffName}</strong> <small>{item.startsAt} → {item.endsAt}{item.note ? ` · ${item.note}` : ""}</small></span></div>
            )) : <p className="pl-empty">No upcoming availability blocks.</p>}
          </div>
          <h3 className="pl-h3">Profile and tags</h3>
          <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); send({ action: "profile", staffId: profile.staffId, profileType: profile.profileType, skills: profile.skills, rateCents: data.money ? profile.rateCents : undefined }); }}>
            <Field label="Person"><select value={profile.staffId} onChange={(e) => setProfile({ ...profile, staffId: e.target.value })}><option value="">Choose</option>{data.staffOptions.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.profileType}</option>)}</select></Field>
            <Field label="Profile"><select value={profile.profileType} onChange={(e) => setProfile({ ...profile, profileType: e.target.value })}>{["dj", "mc", "dancer", "coordinator", "technician", "other"].map((type) => <option key={type}>{type}</option>)}</select></Field>
            <Field label="Skills" wide><Text value={profile.skills} onChange={(v) => setProfile({ ...profile, skills: v })} placeholder="Comma-separated tags" /></Field>
            {data.money && <Field label="Rate (cents)"><Text value={profile.rateCents} onChange={(v) => setProfile({ ...profile, rateCents: v })} placeholder="Leave blank for none" /></Field>}
            {data.access.assignments && <div className="wide"><button className="pl-btn" disabled={!profile.staffId}>Save profile</button></div>}
          </form>
        </Section>}

        {show("vendors") && <Section eyebrow="Partners" title="Vendors on this event">
          <form className="pl-add" onSubmit={(e) => { e.preventDefault(); const vendorId = new FormData(e.currentTarget).get("vendorId"); send({ action: "vendor", vendorId }); }}>
            <select name="vendorId" defaultValue="">{data.vendorOptions.length ? data.vendorOptions.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>) : <option value="">No vendors are stored yet</option>}</select>
            {data.access.vendors && data.vendorOptions.length > 0 && <button className="pl-btn">Link vendor</button>}
          </form>
          <div className="pl-card">
            {data.vendors.length ? data.vendors.map((vendor) => (
              <div className="pl-row" key={vendor.id}><span className="t"><strong>{vendor.company || vendor.contact_name}</strong> <small>{[vendor.contact_name, vendor.phone, vendor.email].filter(Boolean).join(" · ")}</small></span></div>
            )) : <p className="pl-empty">No vendors linked.</p>}
          </div>
        </Section>}

        {show("equipment") && <Section eyebrow="Gear" title="Equipment">
          <p className="pl-intro"><a href="/admin/equipment">Company directory</a> · reserve for this event below. Check out, return, packing, and damage notes stay here so inventory conflict rules stay on the reservation engine.</p>
          <form className="pl-add" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); send({ action: "reserve", equipmentId: form.get("equipmentId"), quantity: Number(form.get("quantity")) }); }}>
            <select name="equipmentId" defaultValue="">{data.assets.length ? data.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · qty {asset.quantity}</option>) : <option value="">No assets yet — add them in Equipment</option>}</select>
            <input name="quantity" type="number" min={1} defaultValue={1} />
            {data.access.equipment && data.assets.length > 0 && <button className="pl-btn">Reserve for this event</button>}
          </form>
          <div className="pl-card">
            {data.reservations.length ? data.reservations.map((item) => {
              const packing = data.packing.filter((row) => row.reservationId === item.id);
              const packedCount = packing.filter((row) => row.packed).length;
              return (
                <div className="of-reserve" key={item.id}>
                  <div className="pl-row">
                    <span className="t">
                      {item.directoryHref ? <a href={item.directoryHref}><strong>{item.equipmentName}</strong></a> : <strong>{item.equipmentName}</strong>}
                      <small>
                        {" "}Qty {item.quantity}
                        {item.canceled_at ? " · Canceled" : ""}
                        {item.returned_at ? " · Returned" : item.checked_out_at ? " · Out" : item.canceled_at ? "" : " · Reserved"}
                        {item.stockPressure ? " · Stock pressure" : ""}
                        {packing.length ? ` · Packing ${packedCount}/${packing.length}` : ""}
                      </small>
                    </span>
                    <span className="pl-rowtools">
                      {!item.returned_at && !item.canceled_at && !item.checked_out_at && data.access.equipment && <button type="button" onClick={() => send({ action: "checkout", reservationId: item.id })}>Check out</button>}
                      {!item.returned_at && !item.canceled_at && data.access.equipment && <button type="button" onClick={() => send({ action: "return", reservationId: item.id })}>Confirm return</button>}
                      {!item.canceled_at && data.access.equipment && <button type="button" onClick={() => send({ action: "cancelReservation", reservationId: item.id })}>Cancel</button>}
                    </span>
                  </div>
                  {!item.canceled_at && data.access.equipment ? (
                    <form className="pl-form" onSubmit={(e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      send({ action: "reservationNotes", reservationId: item.id, maintenanceNotes: form.get("maintenanceNotes"), damageNotes: form.get("damageNotes") });
                    }}>
                      <Field label="Maintenance notes" wide><textarea name="maintenanceNotes" rows={2} defaultValue={item.maintenance_notes || ""} /></Field>
                      <Field label="Damage notes" wide><textarea name="damageNotes" rows={2} defaultValue={item.damage_notes || ""} /></Field>
                      <div className="wide"><button className="pl-btn ghost">Save notes</button></div>
                    </form>
                  ) : null}
                  {(item.maintenance_notes || item.damage_notes) && !data.access.equipment ? (
                    <p className="pl-intro">{[item.maintenance_notes && `Maintenance: ${item.maintenance_notes}`, item.damage_notes && `Damage: ${item.damage_notes}`].filter(Boolean).join(" · ")}</p>
                  ) : null}
                  <h4 className="pl-h3">Packing checklist</h4>
                  {packing.map((row) => (
                    <label className="pl-row" key={row.id}>
                      <input type="checkbox" checked={row.packed} disabled={!data.access.equipment} onChange={(e) => send({ action: "packed", itemId: row.id, packed: e.target.checked })} />
                      <span className="t">{row.label}</span>
                    </label>
                  ))}
                  {data.access.equipment && !item.canceled_at ? (
                    <form className="pl-add" onSubmit={(e) => { e.preventDefault(); const label = new FormData(e.currentTarget).get("label"); send({ action: "packing", reservationId: item.id, label }).then(() => e.currentTarget.reset()); }}>
                      <input name="label" placeholder="Packing item" />
                      <button className="pl-btn ghost">Add packing item</button>
                    </form>
                  ) : null}
                </div>
              );
            }) : <p className="pl-empty">Nothing reserved.</p>}
          </div>
        </Section>}

        {show("incidents") && <Section eyebrow="Record" title="Incidents">
          <div className="pl-card">
            {data.incidents.length ? data.incidents.map((item) => <div className="pl-row" key={item.id}><span className="t">{item.body}</span></div>) : <p className="pl-empty">No incidents.</p>}
            <form className="pl-form" onSubmit={(e) => { e.preventDefault(); const body = new FormData(e.currentTarget).get("body"); send({ action: "incident", body }).then(() => e.currentTarget.reset()); }}>
              <Field label="What happened" wide><textarea name="body" rows={3} /></Field>
              {data.access.events && <div className="wide"><button className="pl-btn">File incident</button></div>}
            </form>
          </div>
        </Section>}
    </>
  );

  if (embedded) return body;
  return (
    <div className="pl">
      <div className="pl-wrap">
        <div className="pl-top">
          <a href={`/admin/planner/${eventId}`}>← Control room</a>
          <span>Full operations</span>
          <span className={`pl-tag ${data.readiness === "ready" ? "ok" : ""}`}>{readinessLabel[data.readiness]}</span>
        </div>
        <header className="pl-hero">
          <h1>{data.event.name || "Event operations"}</h1>
          <p className="pl-intro">Run-of-show site notes, crew, gear, readiness, and incidents for this event. The client planner checklist is separate.</p>
        </header>
        {body}
      </div>
    </div>
  );
}
