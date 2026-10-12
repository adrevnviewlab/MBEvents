"use client";

import { useState } from "react";
import { leadStages, stageLabel } from "@/lib/lead-stages";
import { api } from "@/components/planner/ui";

export function LeadEditor({ id, initialStage, initialNotes }: { id: string; initialStage: string; initialNotes: string }) {
  const [stage, setStage] = useState(initialStage);
  const [notes, setNotes] = useState(initialNotes);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setStatus("");
    try {
      await api(`/api/admin/leads/${id}`, { method: "PATCH", body: { stage, notes } });
      setStatus("Changes saved.");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pl-card pl-form">
      <h3 className="pl-h3 wide" style={{ margin: 0 }}>Manage lead</h3>
      <label className="pl-field">
        <span>Stage</span>
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          {leadStages.map((value) => <option value={value} key={value}>{stageLabel(value)}</option>)}
        </select>
      </label>
      <label className="pl-field wide">
        <span>Internal notes</span>
        <textarea rows={5} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="wide pl-add" style={{ marginTop: 0 }}>
        <button className="pl-btn" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save lead"}</button>
        <span role="status" className="pl-sub">{status}</span>
      </div>
    </div>
  );
}
