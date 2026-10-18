"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminSignOut } from "@/components/admin-auth";
import { api } from "@/components/planner/ui";

export { VenueDesk } from "@/components/office/venues";
export { VendorDesk } from "@/components/office/vendors";

const kinds = [
  ["inquiry_confirmation", "Inquiry confirmation"],
  ["sales_follow_up", "Sales follow-up"],
  ["consultation_reminder", "Consultation reminder"],
  ["proposal_follow_up", "Proposal follow-up"],
  ["deposit_reminder", "Deposit reminder"],
  ["planning_deadline", "Planning deadline"],
  ["rsvp_reminder", "RSVP reminder"],
  ["event_preparation", "Event preparation"],
  ["thank_you", "Thank-you"],
  ["review_request", "Review request"],
  ["referral", "Referral"],
] as const;

function Bar({ title }: { title: string }) {
  return (
    <div className="pl-top">
      <a href="/admin/planner">← Planners</a>
      <span>MB Admin · {title}</span>
      <span>
        <a href="/admin/places">Venues & Vendors</a>
        {" · "}
        <a href="/admin/automations">Automations</a>
        {" · "}
        <a href="/admin/leads">Leads</a>
        {" · "}
        <AdminSignOut />
      </span>
    </div>
  );
}

type Template = { id: string; kind: string; channel: string; delayMinutes: number; subject: string; body: string; active: boolean };
type Run = { id: string; kind: string; entityType: string; entityId: string; occurrence: string; recipient: string; status: string; attempts: number; maxAttempts: number; lastError: string };

export function AutomationDesk() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [form, setForm] = useState({ kind: "inquiry_confirmation", channel: "email", delayMinutes: "0", subject: "", body: "", active: false });
  const [schedule, setSchedule] = useState({ templateId: "", entityType: "lead", entityId: "", occurrence: "" });
  const [status, setStatus] = useState("");
  const load = useCallback(() => api<{ templates: Template[]; runs: Run[] }>("/api/admin/automations").then((body) => {
    setTemplates(body.templates);
    setRuns(body.runs);
  }).catch((error: Error) => setStatus(error.message)), []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setStatus("");
    try {
      await api("/api/admin/automations", { body: { ...form, delayMinutes: Number(form.delayMinutes) || 0 } });
      setForm({ ...form, subject: "", body: "", active: false });
      setStatus("Template saved. Nothing was sent.");
      await load();
    } catch (error) {
      setStatus((error as Error).message);
    }
  };
  const queue = async () => {
    setStatus("");
    try {
      await api("/api/admin/automations/runs", { body: schedule });
      setStatus("Scheduled. A duplicate for the same record and occurrence is ignored.");
      await load();
    } catch (error) {
      setStatus((error as Error).message);
    }
  };
  const cancel = async (id: string) => {
    await api(`/api/admin/automations/runs/${id}`, { method: "POST" });
    await load();
  };
  const deliver = async () => {
    const body = await api<{ processed: number; sent: number; unsent: number }>("/api/admin/automations", { method: "PUT" });
    setStatus(`Checked ${body.processed}. Sent ${body.sent}. Left unsent ${body.unsent}.`);
    await load();
  };
  return (
    <div className="pl">
      <div className="pl-wrap">
        <Bar title="Automations" />
        <header className="pl-hero"><h1>Marketing</h1><p className="pl-intro">This is the automation desk, not a campaign product. You write the subject, message, and delay. Saving a template does not send it. Email and SMS stay unsent until that channel is configured.</p></header>
        <div className="pl-card pl-form">
          <label className="pl-field"><span>Kind</span>
            <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              {kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="pl-field"><span>Channel</span>
            <select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </label>
          <label className="pl-field"><span>Delay in minutes</span><input inputMode="numeric" value={form.delayMinutes} onChange={(event) => setForm({ ...form, delayMinutes: event.target.value })} /></label>
          <label className="pl-field wide"><span>Subject</span><input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></label>
          <label className="pl-field wide"><span>Message</span><textarea rows={5} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></label>
          <label className="pl-field"><span>Active</span><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /></label>
          <div className="wide"><button className="pl-btn" onClick={save}>Save template</button></div>
        </div>
        <div className="pl-card pl-form">
          <h2 className="pl-h3 wide">Schedule</h2>
          <label className="pl-field"><span>Template</span>
            <select value={schedule.templateId} onChange={(event) => setSchedule({ ...schedule, templateId: event.target.value })}>
              <option value="">Choose</option>
              {templates.filter((template) => template.active).map((template) => <option key={template.id} value={template.id}>{template.kind} · {template.channel}</option>)}
            </select>
          </label>
          <label className="pl-field"><span>Record</span>
            <select value={schedule.entityType} onChange={(event) => setSchedule({ ...schedule, entityType: event.target.value })}>
              <option value="lead">Lead</option>
              <option value="event">Event</option>
              <option value="guest">Guest</option>
            </select>
          </label>
          <label className="pl-field"><span>Record id</span><input value={schedule.entityId} onChange={(event) => setSchedule({ ...schedule, entityId: event.target.value })} /></label>
          <label className="pl-field"><span>Occurrence</span><input value={schedule.occurrence} onChange={(event) => setSchedule({ ...schedule, occurrence: event.target.value })} /></label>
          <div className="wide pl-add">
            <button className="pl-btn" onClick={queue}>Schedule</button>
            <button className="pl-btn ghost" onClick={deliver}>Deliver due jobs</button>
          </div>
        </div>
        {status && <p className="pl-sub" role="status">{status}</p>}
        <div className="pl-card" style={{ overflowX: "auto" }}>
          {runs.length ? (
            <table className="pl-admin-table">
              <thead><tr><th>Kind</th><th>To</th><th>Status</th><th>Attempts</th><th></th></tr></thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.kind}</td>
                    <td>{run.recipient}</td>
                    <td>{run.status}{run.lastError ? ` · ${run.lastError}` : ""}</td>
                    <td>{run.attempts}/{run.maxAttempts}</td>
                    <td>{run.status === "pending" || run.status === "failed" ? <button className="pl-btn ghost sm" onClick={() => cancel(run.id)}>Cancel</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="pl-empty">No automation runs yet.</p>}
        </div>
      </div>
    </div>
  );
}
