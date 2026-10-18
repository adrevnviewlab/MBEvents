"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, Field, Text } from "@/components/planner/ui";

type Catalog = {
  categories: { id: string; name: string }[];
  assets: {
    id: string;
    name: string;
    category: string;
    quantity: number;
    active: boolean;
    openReservations: number;
    reservedQuantity: number;
    availableHint: number;
  }[];
  canWrite: boolean;
};

type AssetProfile = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  active: boolean;
  backupName: string;
  openReservations: number;
  reservedQuantity: number;
  availableHint: number;
  canWrite: boolean;
  packingSummary: { total: number; packed: number };
  reservations: {
    id: string;
    eventId: string;
    eventName: string;
    quantity: number;
    startsAt: string | null;
    endsAt: string | null;
    canceledAt: string | null;
    checkedOutAt: string | null;
    returnedAt: string | null;
    maintenanceNotes: string;
    damageNotes: string;
    href: string;
    status: "canceled" | "returned" | "out" | "reserved";
    packing: { id: string; label: string; packed: boolean }[];
  }[];
};

export function OfficeEquipment() {
  const params = useSearchParams();
  const initialAsset = params.get("asset") ?? "";
  const [q, setQ] = useState("");
  const [data, setData] = useState<Catalog | null>(null);
  const [open, setOpen] = useState<AssetProfile | null>(null);
  const [error, setError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [asset, setAsset] = useState({ name: "", categoryId: "", quantity: "1" });

  const load = useCallback((query = q) => {
    api<Catalog>(`/api/admin/equipment?q=${encodeURIComponent(query)}`)
      .then((body) => { setData(body); setError(""); })
      .catch((reason: Error) => { setData({ categories: [], assets: [], canWrite: false }); setError(reason.message); });
  }, [q]);

  useEffect(() => {
    const handle = setTimeout(() => load(q), 200);
    return () => clearTimeout(handle);
  }, [q, load]);

  const choose = useCallback(async (id: string) => {
    setError("");
    try {
      const body = await api<{ asset: AssetProfile }>(`/api/admin/equipment/${id}`);
      setOpen(body.asset);
      const url = new URL(window.location.href);
      url.searchParams.set("asset", id);
      window.history.replaceState({}, "", url.toString());
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    if (initialAsset) void choose(initialAsset);
  }, [initialAsset, choose]);

  const send = async (body: Record<string, unknown>) => {
    setError("");
    try {
      setData(await api<Catalog>("/api/admin/equipment", { body }));
      setCategoryName("");
      setAsset({ name: "", categoryId: "", quantity: "1" });
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="pl-hero">
          <div className="pl-k">Inventory</div>
          <h1>Equipment</h1>
          <p className="pl-intro">
            Company gear directory with live reservation holds. Reserve, check out, return, packing, and damage notes live on each event&apos;s Equipment room — the overlap engine is unchanged.
          </p>
        </header>
        {error && <p className="pl-warn" role="alert">{error}</p>}
        <div className="of-toolbar">
          <input className="of-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets" aria-label="Search equipment" />
          <a className="pl-btn ghost" href="/admin/planner">Open events</a>
        </div>

        {data?.canWrite ? (
          <div className="of-split">
            <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); send({ action: "category", name: categoryName }); }}>
              <Field label="New category"><Text value={categoryName} onChange={setCategoryName} /></Field>
              <div className="wide"><button className="pl-btn ghost" disabled={!categoryName.trim()}>Add category</button></div>
            </form>
            <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); send({ action: "asset", name: asset.name, categoryId: asset.categoryId, quantity: Number(asset.quantity) }); }}>
              <Field label="Asset name"><Text value={asset.name} onChange={(v) => setAsset({ ...asset, name: v })} /></Field>
              <Field label="Category">
                <select value={asset.categoryId} onChange={(e) => setAsset({ ...asset, categoryId: e.target.value })}>
                  <option value="">None</option>
                  {(data?.categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </Field>
              <Field label="Quantity"><Text value={asset.quantity} onChange={(v) => setAsset({ ...asset, quantity: v })} /></Field>
              <div className="wide"><button className="pl-btn" disabled={!asset.name.trim()}>Add asset</button></div>
            </form>
          </div>
        ) : null}

        {data === null ? <p className="pl-empty">Loading…</p> : null}
        {data && !data.assets.length ? (
          <div className="of-empty">
            <h2>No equipment yet</h2>
            <p>Add categories and assets here, then reserve them from an event control room. Stock is never invented.</p>
          </div>
        ) : null}
        {data && data.assets.length ? (
          <div className="of-table-wrap">
            <table className="of-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Category</th>
                  <th>Qty</th>
                  <th>Held</th>
                  <th>Hint free</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.assets.map((item) => (
                  <tr key={item.id} className={open?.id === item.id ? "is-active" : ""}>
                    <td>
                      <button type="button" className="of-linkish" onClick={() => void choose(item.id)}>
                        <strong>{item.name}</strong>
                      </button>
                    </td>
                    <td>{item.category || "—"}</td>
                    <td>{item.quantity}</td>
                    <td>{item.reservedQuantity} ({item.openReservations} open)</td>
                    <td>{item.availableHint < item.quantity ? <span className="pl-warn">{item.availableHint}</span> : item.availableHint}</td>
                    <td>{item.active ? "Active" : "Inactive"}</td>
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
            <p className="pl-intro">
              {open.category || "Uncategorized"} · Qty {open.quantity} · Held {open.reservedQuantity} · Hint free {open.availableHint}
              {open.backupName ? ` · Backup ${open.backupName}` : ""}
              {" · "}Packing {open.packingSummary.packed}/{open.packingSummary.total}
            </p>
            {open.availableHint === 0 && open.reservedQuantity > 0 ? (
              <p className="pl-warn" role="status">All counted stock is held by open reservations. The engine still blocks overbooking on save.</p>
            ) : null}

            <h3 className="pl-h3">Event reservations</h3>
            <div className="pl-card">
              {open.reservations.length ? open.reservations.map((item) => (
                <div className="of-reserve" key={item.id}>
                  <div className="pl-row">
                    <span className="t">
                      <a href={item.href}><strong>{item.eventName}</strong></a>
                      <small>
                        {" "}Qty {item.quantity} · {item.status}
                        {item.startsAt ? ` · ${item.startsAt} → ${item.endsAt}` : ""}
                      </small>
                    </span>
                  </div>
                  {(item.maintenanceNotes || item.damageNotes) ? (
                    <p className="pl-intro">
                      {[item.maintenanceNotes && `Maintenance: ${item.maintenanceNotes}`, item.damageNotes && `Damage: ${item.damageNotes}`].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                  {item.packing.length ? (
                    <>
                      <h4 className="pl-h3">Packing checklist</h4>
                      {item.packing.map((row) => (
                        <div className="pl-row" key={row.id}>
                          <span className="t">{row.packed ? "✓" : "○"} {row.label}</span>
                        </div>
                      ))}
                    </>
                  ) : null}
                </div>
              )) : <p className="pl-empty">No reservations for this asset.</p>}
            </div>
            <p className="pl-intro">Check-out, return, and packing edits happen in the event Equipment room so conflict rules stay on the reservation engine.</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
