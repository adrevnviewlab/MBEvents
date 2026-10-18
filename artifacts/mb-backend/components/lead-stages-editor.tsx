"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/planner/ui";

type Stage = { key: string; label: string; active: boolean };

export function LeadStagesEditor({ stages: initial }: { stages: Stage[] }) {
  const router = useRouter();
  const [stages, setStages] = useState(initial);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const move = (index: number, direction: number) => {
    const next = stages.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    setStages(next);
  };

  const save = async () => {
    setBusy(true);
    setStatus("");
    try {
      await api("/api/admin/lead-stages", { method: "PATCH", body: { stages } });
      setStatus("Stages saved.");
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setStatus("");
    try {
      await api("/api/admin/lead-stages", { body: { label } });
      setLabel("");
      setStatus("Stage added.");
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pl-card">
      <h3 className="pl-h3" style={{ marginTop: 0 }}>Stages</h3>
      <p className="pl-sub">Rename, reorder, or add a stage. Deactivate one that should not be offered. Stages already on a lead stay.</p>
      {stages.map((stage, index) => (
        <div className="pl-row" key={stage.key}>
          <span className="pl-rowtools">
            <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>Up</button>
            <button type="button" disabled={index === stages.length - 1} onClick={() => move(index, 1)}>Down</button>
          </span>
          <span className="t"><input className="plain" value={stage.label} onChange={(event) => setStages(stages.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} /></span>
          <small>{stage.key}</small>
          <label className="pl-sub"><input type="checkbox" checked={stage.active} onChange={(event) => setStages(stages.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} /> Active</label>
        </div>
      ))}
      <div className="pl-add">
        <button className="pl-btn sm" type="button" disabled={busy} onClick={save}>Save stages</button>
        <input value={label} maxLength={80} placeholder="New stage name" onChange={(event) => setLabel(event.target.value)} />
        <button className="pl-btn sm ghost" type="button" disabled={busy || label.trim().length < 2} onClick={add}>Add stage</button>
        <span role="status" className="pl-sub">{status}</span>
      </div>
    </div>
  );
}
