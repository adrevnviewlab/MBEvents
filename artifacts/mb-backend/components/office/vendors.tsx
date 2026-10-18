"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/planner/ui";

type VendorList = {
  id: string;
  name: string;
  category: string;
  contactName: string;
  email: string;
  phone: string;
  area: string;
  preferred: boolean;
  published: boolean;
  verified: boolean;
  active: boolean;
  assignmentCount?: number;
  leadCount?: number;
};

type VendorProfile = VendorList & {
  description: string;
  notes: string;
  relationshipNotes: string;
  photos: { id: string; filename: string }[];
  assignments?: {
    id: string;
    name: string;
    eventDate: string | null;
    status: string;
    bookingStatus?: string;
    role: string;
    href: string;
  }[];
  leads?: { id: string; name: string; stage: string; eventDate: string | null; href: string }[];
  tasks?: { id: string; title: string; dueOn: string | null; done: boolean; eventName: string; href: string }[];
  finance?: {
    quotesTracked: boolean;
    contractsTracked: boolean;
    balancesTracked: boolean;
    detail: string;
  };
};

const blank = {
  name: "",
  category: "",
  contactName: "",
  email: "",
  phone: "",
  description: "",
  area: "",
  notes: "",
  relationshipNotes: "",
  preferred: false,
  verified: false,
};

export function VendorDesk({ embedded = false }: { embedded?: boolean }) {
  const [vendors, setVendors] = useState<VendorList[]>([]);
  const [open, setOpen] = useState<VendorProfile | null>(null);
  const [edit, setEdit] = useState(blank);
  const [form, setForm] = useState(blank);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    api<{ vendors: VendorList[] }>("/api/admin/vendors")
      .then((body) => { setVendors(body.vendors); setStatus(""); })
      .catch((error: Error) => setStatus(error.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(
    () => [...new Set(vendors.map((vendor) => vendor.category).filter(Boolean))].sort(),
    [vendors],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors.filter((vendor) => {
      if (category !== "all" && vendor.category !== category) return false;
      if (!needle) return true;
      return [vendor.name, vendor.category, vendor.contactName, vendor.email, vendor.phone, vendor.area]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [vendors, q, category]);

  const choose = async (id: string) => {
    setStatus("");
    try {
      const body = await api<{ vendor: VendorProfile }>(`/api/admin/vendors/${id}`);
      setOpen(body.vendor);
      setEdit({
        name: body.vendor.name,
        category: body.vendor.category,
        contactName: body.vendor.contactName,
        email: body.vendor.email,
        phone: body.vendor.phone,
        description: body.vendor.description,
        area: body.vendor.area,
        notes: body.vendor.notes,
        relationshipNotes: body.vendor.relationshipNotes,
        preferred: body.vendor.preferred,
        verified: body.vendor.verified,
      });
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const saveNew = async () => {
    setStatus("");
    try {
      await api("/api/admin/vendors", { body: form });
      setForm(blank);
      setShowCreate(false);
      setStatus("Partner saved. It stays unpublished until you publish it.");
      await load();
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const saveOpen = async () => {
    if (!open) return;
    setStatus("");
    try {
      const body = await api<{ vendor: VendorProfile }>(`/api/admin/vendors/${open.id}`, {
        method: "PATCH",
        body: { ...edit, active: open.active, published: open.published },
      });
      setOpen(body.vendor);
      setStatus("Partner updated.");
      await load();
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const publish = async (published: boolean) => {
    if (!open) return;
    setStatus("");
    try {
      const body = await api<{ vendor: VendorProfile }>(`/api/admin/vendors/${open.id}`, {
        method: "PATCH",
        body: { published },
      });
      setOpen(body.vendor);
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
    const response = await fetch(`/api/admin/vendors/${open.id}/photos`, { method: "POST", body: data, credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setStatus(body.error || "Could not save the photo.");
      return;
    }
    await choose(open.id);
  };

  return (
    <div className="pl">
      <div className="pl-wrap">
        {!embedded ? (
          <header className="of-crm-header">
            <div>
              <p className="of-ecr-kicker">Directory</p>
              <h1>Vendors</h1>
              <p>Preferred partners and event assignments. Quotes and balances stay on each event’s finance room when they exist.</p>
            </div>
            <div className="of-crm-header-actions">
              <a className="pl-btn sm ghost" href="/admin/places?tab=venues">Venues</a>
              <a className="pl-btn sm ghost" href="/admin/calendar">Calendar</a>
            </div>
          </header>
        ) : null}

        {status ? <p className="of-state" role="status">{status}</p> : null}

        <div className="of-toolbar">
          <input className="of-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors" aria-label="Search vendors" />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter category">
            <option value="all">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button className="pl-btn sm" type="button" onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Close form" : "Add vendor"}</button>
        </div>

        {showCreate ? (
          <section className="of-panel">
            <div className="of-panel-head"><h2>New vendor</h2></div>
            <div className="of-client-form">
              <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Category / services<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Photo, florist…" /></label>
              <label>Contact<input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></label>
              <label>Email<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label>Area<input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></label>
              <label>Public description<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <label>Internal notes<textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              <label>Relationship notes<textarea rows={2} value={form.relationshipNotes} onChange={(e) => setForm({ ...form, relationshipNotes: e.target.value })} /></label>
              <label className="pl-inline"><input type="checkbox" checked={form.preferred} onChange={(e) => setForm({ ...form, preferred: e.target.checked })} /> Preferred</label>
              <label className="pl-inline"><input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> Verified</label>
              <button className="pl-btn sm" type="button" onClick={saveNew}>Save vendor</button>
            </div>
          </section>
        ) : null}

        <div className="of-places-split">
          <div className="of-table-wrap">
            <table className="of-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Category</th>
                  <th>Contact</th>
                  <th>Events</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((vendor) => (
                  <tr key={vendor.id} className={open?.id === vendor.id ? "is-selected" : undefined}>
                    <td>
                      <button className="of-client-name" type="button" onClick={() => choose(vendor.id)}>
                        <strong>{vendor.name}</strong>
                      </button>
                      <div><small>{vendor.area || "—"}</small></div>
                    </td>
                    <td><small>{vendor.category || "—"}</small></td>
                    <td><small>{[vendor.contactName, vendor.email || vendor.phone].filter(Boolean).join(" · ") || "—"}</small></td>
                    <td>{vendor.assignmentCount ?? "—"}</td>
                    <td>
                      <small>
                        {[vendor.preferred ? "Preferred" : "", vendor.verified ? "Verified" : "", vendor.published ? "Published" : "Office"]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length ? <p className="pl-empty">No vendors match.</p> : null}
          </div>

          {open ? (
            <aside className="of-panel of-places-profile">
              <div className="of-panel-head">
                <h2>{open.name}</h2>
                <span className="of-pill">{open.category || "Partner"}</span>
              </div>
              <p className="of-client-fine">
                {[open.contactName, open.email, open.phone, open.area].filter(Boolean).join(" · ") || "No contact yet"}
              </p>

              <div className="of-client-form">
                <label>Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
                <label>Category / services<input value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></label>
                <label>Contact<input value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} /></label>
                <label>Email<input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
                <label>Phone<input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
                <label>Area<input value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} /></label>
                <label>Public description<textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
                <label>Internal notes<textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
                <label>Relationship notes<textarea rows={2} value={edit.relationshipNotes} onChange={(e) => setEdit({ ...edit, relationshipNotes: e.target.value })} /></label>
                <label className="pl-inline"><input type="checkbox" checked={edit.preferred} onChange={(e) => setEdit({ ...edit, preferred: e.target.checked })} /> Preferred</label>
                <label className="pl-inline"><input type="checkbox" checked={edit.verified} onChange={(e) => setEdit({ ...edit, verified: e.target.checked })} /> Verified</label>
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
                <h3 className="pl-h3">Event assignments</h3>
                {open.assignments?.length ? open.assignments.map((row) => (
                  <a className="of-queue-row" href={row.href} key={`${row.id}-${row.role}`}>
                    <strong>{row.name}</strong>
                    <small>{row.eventDate || "TBD"} · {row.role || "Assigned"}{row.bookingStatus ? ` · ${row.bookingStatus}` : ""}</small>
                  </a>
                )) : <p className="pl-empty">Not assigned to any events yet.</p>}
              </section>

              <section>
                <h3 className="pl-h3">Tasks & deadlines</h3>
                <p className="of-client-fine">Open tasks on events where this partner is assigned.</p>
                {open.tasks?.length ? open.tasks.map((task) => (
                  <a className={`of-queue-row${task.done ? "" : ""}`} href={task.href} key={task.id}>
                    <strong>{task.done ? "✓ " : ""}{task.title}</strong>
                    <small>{task.eventName}{task.dueOn ? ` · due ${task.dueOn}` : ""}</small>
                  </a>
                )) : <p className="pl-empty">No linked event tasks.</p>}
              </section>

              <section>
                <h3 className="pl-h3">Quotes, contracts & balances</h3>
                <p className="of-client-fine">{open.finance?.detail}</p>
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
            </aside>
          ) : (
            <aside className="of-panel of-places-profile">
              <p className="pl-empty">Select a vendor to see contact, assignments, notes, and linked tasks.</p>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
