"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/planner/ui";

type VenueList = {
  id: string;
  name: string;
  area: string;
  location: string;
  capacity: string;
  published: boolean;
  active: boolean;
  mbProduction: boolean;
  eventCount?: number;
  leadCount?: number;
};

type VenueProfile = VenueList & {
  description: string;
  amenities: string;
  serviceArea: string;
  notes: string;
  photos: { id: string; filename: string }[];
  events: { id: string; name: string; eventDate: string | null; status: string; bookingStatus?: string; href?: string }[];
  upcomingEvents?: { id: string; name: string; eventDate: string | null; href?: string }[];
  pastEvents?: { id: string; name: string; eventDate: string | null; href?: string }[];
  leads?: { id: string; name: string; stage: string; eventDate: string | null; href: string }[];
  mbBookings?: { id: string; name: string; eventDate: string | null; bookingStatus: string; href: string }[];
  availability?: { managedByMb: boolean; thirdPartyCalendar: boolean; detail: string };
  pricing?: { tracked: boolean; detail: string };
};

const blank = { name: "", area: "", address: "", capacity: "", description: "", amenities: "", serviceArea: "", notes: "", mbProduction: false };

export function VenueDesk({ embedded = false }: { embedded?: boolean }) {
  const [venues, setVenues] = useState<VenueList[]>([]);
  const [open, setOpen] = useState<VenueProfile | null>(null);
  const [edit, setEdit] = useState(blank);
  const [form, setForm] = useState(blank);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [eventId, setEventId] = useState("");
  const [referredBy, setReferredBy] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    api<{ venues: VenueList[] }>("/api/admin/venues")
      .then((body) => { setVenues(body.venues); setStatus(""); })
      .catch((error: Error) => setStatus(error.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return venues;
    return venues.filter((venue) =>
      [venue.name, venue.area, venue.location, venue.capacity].join(" ").toLowerCase().includes(needle),
    );
  }, [venues, q]);

  const choose = async (id: string) => {
    setStatus("");
    try {
      const body = await api<{ venue: VenueProfile }>(`/api/admin/venues/${id}`);
      setOpen(body.venue);
      setEdit({
        name: body.venue.name,
        area: body.venue.area,
        address: body.venue.location,
        capacity: body.venue.capacity,
        description: body.venue.description,
        amenities: body.venue.amenities,
        serviceArea: body.venue.serviceArea,
        notes: body.venue.notes,
        mbProduction: body.venue.mbProduction,
      });
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const saveNew = async () => {
    setStatus("");
    try {
      await api("/api/admin/venues", { body: form });
      setForm(blank);
      setShowCreate(false);
      setStatus("Venue saved. It stays unpublished until you publish it.");
      await load();
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const saveOpen = async () => {
    if (!open) return;
    setStatus("");
    try {
      const body = await api<{ venue: VenueProfile }>(`/api/admin/venues/${open.id}`, {
        method: "PATCH",
        body: { ...edit, active: open.active, published: open.published, mbProduction: edit.mbProduction },
      });
      setOpen(body.venue);
      setStatus("Venue updated.");
      await load();
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const publish = async (published: boolean) => {
    if (!open) return;
    setStatus("");
    try {
      const body = await api<{ venue: VenueProfile }>(`/api/admin/venues/${open.id}`, {
        method: "PATCH",
        body: { published, mbProduction: open.mbProduction, active: open.active },
      });
      setOpen(body.venue);
      setStatus(published ? "Published on the public site." : "Unpublished.");
      await load();
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const upload = async (file: File) => {
    if (!open) return;
    const data = new FormData();
    data.set("file", file);
    const response = await fetch(`/api/admin/venues/${open.id}/photos`, { method: "POST", body: data, credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setStatus(body.error || "Could not save the photo.");
      return;
    }
    await choose(open.id);
  };

  const linkEvent = async () => {
    if (!open || !eventId.trim()) return;
    setStatus("");
    try {
      await api("/api/admin/attribution", {
        body: { entity: "event", id: eventId.trim(), venueId: open.id, referredBy: referredBy.trim() || null },
      });
      setEventId("");
      setReferredBy("");
      await choose(open.id);
      setStatus("Event linked to this venue.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  return (
    <div className="pl">
      <div className="pl-wrap">
        {!embedded ? (
          <header className="of-crm-header">
            <div>
              <p className="of-ecr-kicker">Directory</p>
              <h1>Venues</h1>
              <p>Office venue records with linked MB bookings. Third-party venue calendars are not managed here.</p>
            </div>
            <div className="of-crm-header-actions">
              <a className="pl-btn sm ghost" href="/admin/places?tab=vendors">Vendors</a>
              <a className="pl-btn sm ghost" href="/admin/calendar">Calendar</a>
            </div>
          </header>
        ) : null}

        {status ? <p className="of-state" role="status">{status}</p> : null}

        <div className="of-toolbar">
          <input className="of-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search venues" aria-label="Search venues" />
          <button className="pl-btn sm" type="button" onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Close form" : "Add venue"}</button>
        </div>

        {showCreate ? (
          <section className="of-panel">
            <div className="of-panel-head"><h2>New venue</h2></div>
            <div className="of-client-form">
              <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Area<input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></label>
              <label>Location / address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
              <label>Capacity<input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></label>
              <label>Service area<input value={form.serviceArea} onChange={(e) => setForm({ ...form, serviceArea: e.target.value })} /></label>
              <label>Description<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <label>Amenities / restrictions<textarea rows={2} value={form.amenities} onChange={(e) => setForm({ ...form, amenities: e.target.value })} /></label>
              <label>Internal notes<textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              <label className="pl-inline"><input type="checkbox" checked={form.mbProduction} onChange={(e) => setForm({ ...form, mbProduction: e.target.checked })} /> MB production</label>
              <button className="pl-btn sm" type="button" onClick={saveNew}>Save venue</button>
            </div>
          </section>
        ) : null}

        <div className="of-places-split">
          <div className="of-table-wrap">
            <table className="of-table">
              <thead>
                <tr>
                  <th>Venue</th>
                  <th>Area</th>
                  <th>Capacity</th>
                  <th>Events</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((venue) => (
                  <tr key={venue.id} className={open?.id === venue.id ? "is-selected" : undefined}>
                    <td>
                      <button className="of-client-name" type="button" onClick={() => choose(venue.id)}>
                        <strong>{venue.name}</strong>
                      </button>
                      <div><small>{venue.location || "—"}</small></div>
                    </td>
                    <td><small>{venue.area || "—"}</small></td>
                    <td><small>{venue.capacity || "—"}</small></td>
                    <td>{venue.eventCount ?? "—"}</td>
                    <td><span className="of-pill">{venue.published ? "Published" : "Office only"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length ? <p className="pl-empty">No venues match.</p> : null}
          </div>

          {open ? (
            <aside className="of-panel of-places-profile">
              <div className="of-panel-head">
                <h2>{open.name}</h2>
                <span className="of-pill">{open.published ? "Published" : "Office only"}</span>
              </div>
              <p className="of-client-fine">
                {[open.location, open.area, open.capacity ? `Cap ${open.capacity}` : ""].filter(Boolean).join(" · ") || "No contact location yet"}
              </p>

              <div className="of-client-form">
                <label>Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
                <label>Location<input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></label>
                <label>Area<input value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} /></label>
                <label>Capacity<input value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} /></label>
                <label>Service area<input value={edit.serviceArea} onChange={(e) => setEdit({ ...edit, serviceArea: e.target.value })} /></label>
                <label>Description<textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
                <label>Requirements / amenities<textarea rows={2} value={edit.amenities} onChange={(e) => setEdit({ ...edit, amenities: e.target.value })} /></label>
                <label>Internal notes<textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
                <label className="pl-inline"><input type="checkbox" checked={edit.mbProduction} onChange={(e) => setEdit({ ...edit, mbProduction: e.target.checked })} /> MB production</label>
                <div className="of-crm-header-actions">
                  <button className="pl-btn sm" type="button" onClick={saveOpen}>Save</button>
                  <button className="pl-btn sm ghost" type="button" onClick={() => publish(!open.published)}>{open.published ? "Unpublish" : "Publish"}</button>
                  <label className="pl-btn sm ghost">Add photo<input type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); }} /></label>
                </div>
              </div>

              {open.photos?.length ? (
                <ul className="of-places-photos">
                  {open.photos.map((photo) => <li key={photo.id}>{photo.filename}</li>)}
                </ul>
              ) : null}

              <section>
                <h3 className="pl-h3">MB booking occupancy</h3>
                <p className="of-client-fine">{open.availability?.detail}</p>
                {open.mbBookings?.length ? open.mbBookings.map((row) => (
                  <a className="of-queue-row" href={row.href} key={row.id}>
                    <strong>{row.name}</strong>
                    <small>{row.eventDate || "TBD"} · {row.bookingStatus}</small>
                  </a>
                )) : <p className="pl-empty">No upcoming MB bookings linked here.</p>}
                <p><a className="pl-btn sm ghost" href="/admin/calendar">Open calendar</a></p>
              </section>

              <section>
                <h3 className="pl-h3">Event history</h3>
                {open.events?.length ? open.events.map((event) => (
                  <a className="of-queue-row" href={event.href || `/admin/calendar?event=${encodeURIComponent(event.id)}`} key={event.id}>
                    <strong>{event.name}</strong>
                    <small>{event.eventDate || "TBD"} · {event.bookingStatus || event.status}</small>
                  </a>
                )) : <p className="pl-empty">No events linked.</p>}
              </section>

              <section>
                <h3 className="pl-h3">Pricing / rental</h3>
                <p className="of-client-fine">{open.pricing?.detail}</p>
              </section>

              {open.leads?.length ? (
                <section>
                  <h3 className="pl-h3">Related leads</h3>
                  {open.leads.map((lead) => (
                    <a className="of-queue-row" href={lead.href} key={lead.id}>
                      <strong>{lead.name}</strong>
                      <small>{lead.stage}{lead.eventDate ? ` · ${lead.eventDate}` : ""}</small>
                    </a>
                  ))}
                </section>
              ) : null}

              <section>
                <h3 className="pl-h3">Link event</h3>
                <div className="of-client-form">
                  <label>Event id<input value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="Event UUID" /></label>
                  <label>Referred by<input value={referredBy} onChange={(e) => setReferredBy(e.target.value)} /></label>
                  <button className="pl-btn sm ghost" type="button" onClick={linkEvent}>Link</button>
                </div>
              </section>
            </aside>
          ) : (
            <aside className="of-panel of-places-profile">
              <p className="pl-empty">Select a venue to see contact, notes, MB bookings, and event history.</p>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
