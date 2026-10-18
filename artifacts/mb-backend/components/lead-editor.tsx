"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/planner/ui";

type StageChoice = { key: string; label: string };
type StaffChoice = { id: string; name: string };
type ActivityItem = { id: string; kind: string; body: string; actor: string; created_at: string };
type TaskItem = { id: string; title: string; due_on: string | null; done: boolean; assignee_name: string | null };
type DuplicateItem = { id: string; name: string; email: string; phone: string; source: string };

function localStamp(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dollars(cents: number | null) {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function isOverdue(dueOn: string | null, done: boolean) {
  if (done || !dueOn) return false;
  return dueOn <= new Date().toISOString().slice(0, 10);
}

export function LeadEditor({
  id, stage: initialStage, notes: initialNotes, assigneeId: initialAssignee, consultationAt, budgetCents, lostReason: initialReason,
  stages, staff, activities, tasks, duplicates, convertedEventId, merged, canTasks, canConvert,
}: {
  id: string;
  stage: string;
  notes: string;
  assigneeId: string | null;
  consultationAt: string | null;
  budgetCents: number | null;
  lostReason: string | null;
  stages: StageChoice[];
  staff: StaffChoice[];
  activities: ActivityItem[];
  tasks: TaskItem[];
  duplicates: DuplicateItem[];
  convertedEventId: string | null;
  merged: boolean;
  canTasks: boolean;
  canConvert: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState(initialStage);
  const [notes, setNotes] = useState(initialNotes);
  const [assigneeId, setAssigneeId] = useState(initialAssignee ?? "");
  const [consultation, setConsultation] = useState(localStamp(consultationAt));
  const [budget, setBudget] = useState(dollars(budgetCents));
  const [lostReason, setLostReason] = useState(initialReason ?? "");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskAssignee, setTaskAssignee] = useState(initialAssignee ?? "");
  const [creds, setCreds] = useState<{ id: string; code: string; password: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setStatus("");
    try {
      await api(`/api/admin/leads/${id}`, {
        method: "PATCH",
        body: {
          stage,
          notes,
          assigneeId: assigneeId || null,
          consultationAt: consultation ? new Date(consultation).toISOString() : null,
          budget,
          lostReason,
        },
      });
      setStatus("Changes saved.");
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addTask = async () => {
    setBusy(true);
    setStatus("");
    try {
      await api(`/api/admin/leads/${id}/tasks`, { body: { title: taskTitle, dueOn: taskDue, assigneeId: taskAssignee || null } });
      setTaskTitle("");
      setTaskDue("");
      setStatus("Follow-up saved.");
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleTask = async (taskId: string, done: boolean) => {
    setStatus("");
    try {
      await api(`/api/admin/leads/${id}/tasks`, { method: "PATCH", body: { taskId, done } });
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const merge = async (leadId: string) => {
    if (!window.confirm("Merge this inquiry into the one you are viewing? Notes and follow-ups move here. Nothing is deleted.")) return;
    setBusy(true);
    setStatus("");
    try {
      await api(`/api/admin/leads/${id}/merge`, { body: { leadId } });
      setStatus("Inquiry merged.");
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!window.confirm("Create a planner and mark this lead booked? The date is not confirmed and no payment is created.")) return;
    setBusy(true);
    setStatus("");
    try {
      setCreds(await api<{ id: string; code: string; password: string }>(`/api/admin/leads/${id}/convert`));
      router.refresh();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openTasks = tasks.filter((task) => !task.done);
  const doneTasks = tasks.filter((task) => task.done);

  return (
    <>
      {duplicates.length > 0 && !merged && (
        <section className="of-panel">
          <div className="of-panel-head"><h2>Possible duplicates</h2></div>
          {duplicates.map((row) => (
            <div className="of-crm-dup" key={row.id}>
              <span><a href={`/admin/leads/${row.id}`}>{row.name}</a> · {row.email || row.phone || "No contact"} · {row.source}</span>
              <button className="pl-btn sm ghost" type="button" disabled={busy} onClick={() => merge(row.id)}>Merge into this lead</button>
            </div>
          ))}
        </section>
      )}

      {!merged && (
        <section className="of-panel">
          <div className="of-panel-head"><h2>Manage lead</h2></div>
          <div className="of-crm-form">
            <label>
              <span>Stage</span>
              <select value={stage} onChange={(event) => setStage(event.target.value)}>
                {stages.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span>Assigned to</span>
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                <option value="">Unassigned</option>
                {staff.map((person) => <option value={person.id} key={person.id}>{person.name || person.id}</option>)}
              </select>
            </label>
            <label>
              <span>Consultation</span>
              <input type="datetime-local" value={consultation} onChange={(event) => setConsultation(event.target.value)} />
            </label>
            <label>
              <span>Estimated budget (USD)</span>
              <input inputMode="decimal" placeholder="Only if supplied" value={budget} onChange={(event) => setBudget(event.target.value)} />
            </label>
            {stage === "lost" && (
              <label className="wide">
                <span>Lost reason</span>
                <textarea rows={3} maxLength={2000} value={lostReason} onChange={(event) => setLostReason(event.target.value)} />
              </label>
            )}
            <label className="wide">
              <span>Internal notes</span>
              <textarea rows={5} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <div className="wide of-ecr-action-row">
              <button className="pl-btn" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save lead"}</button>
              <span role="status" className="of-ecr-fine">{status}</span>
            </div>
          </div>
          <p className="of-ecr-fine" style={{ marginTop: 10 }}>Stage changes update CRM only. They do not confirm bookings or create payments.</p>
        </section>
      )}

      {canTasks && !merged && (
        <section className="of-panel">
          <div className="of-panel-head"><h2>Follow-ups</h2></div>
          {openTasks.length ? openTasks.map((task) => (
            <label className={`of-crm-task${isOverdue(task.due_on, task.done) ? " is-overdue" : ""}`} key={task.id}>
              <input type="checkbox" checked={task.done} onChange={(event) => toggleTask(task.id, event.target.checked)} />
              <span>
                <strong>{task.title}</strong>
                <small>
                  {task.due_on || "No date"}
                  {task.assignee_name ? ` · ${task.assignee_name}` : ""}
                  {isOverdue(task.due_on, task.done) ? " · Overdue" : ""}
                </small>
              </span>
            </label>
          )) : <p className="of-state">No open follow-ups.</p>}
          <div className="of-crm-form" style={{ marginTop: 14 }}>
            <label>
              <span>Follow-up</span>
              <input value={taskTitle} maxLength={200} onChange={(event) => setTaskTitle(event.target.value)} />
            </label>
            <label>
              <span>Due</span>
              <input type="date" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} />
            </label>
            <label>
              <span>Assignee</span>
              <select value={taskAssignee} onChange={(event) => setTaskAssignee(event.target.value)}>
                <option value="">Unassigned</option>
                {staff.map((person) => <option value={person.id} key={person.id}>{person.name || person.id}</option>)}
              </select>
            </label>
            <div className="of-crm-filter-actions">
              <button className="pl-btn sm" type="button" disabled={busy || taskTitle.trim().length < 2 || !taskDue} onClick={addTask}>Add follow-up</button>
            </div>
          </div>
          {doneTasks.length ? (
            <details className="of-crm-history-done">
              <summary>Completed ({doneTasks.length})</summary>
              {doneTasks.map((task) => (
                <label className="of-crm-task is-done" key={task.id}>
                  <input type="checkbox" checked onChange={(event) => toggleTask(task.id, event.target.checked)} />
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.due_on || "No date"}{task.assignee_name ? ` · ${task.assignee_name}` : ""}</small>
                  </span>
                </label>
              ))}
            </details>
          ) : null}
        </section>
      )}

      <section className="of-panel">
        <div className="of-panel-head"><h2>Communication & history</h2></div>
        {activities.length ? activities.map((item) => (
          <div className="of-crm-activity" key={item.id}>
            <span>{item.body || item.kind}</span>
            <small>{new Date(item.created_at).toLocaleString("en-US")} · {item.actor || item.kind}</small>
          </div>
        )) : <p className="of-state">No history yet.</p>}
      </section>

      <section className="of-panel">
        <div className="of-panel-head"><h2>Linked records</h2></div>
        <div className="of-ecr-action-row">
          {creds && (
            <div className="pl-creds" role="status">
              Planner created. Booking stays unconfirmed; password shown once.<br />
              Event code: <code>{creds.code}</code><br />
              Password: <code>{creds.password}</code><br />
              <a className="pl-btn sm" href={`/admin/planner/${creds.id}`}>Open Control Room</a>
            </div>
          )}
          {!creds && convertedEventId && (
            <>
              <a className="pl-btn sm" href={`/admin/planner/${convertedEventId}`}>Event Control Room</a>
              <a className="pl-btn sm ghost" href={`/admin/calendar?event=${encodeURIComponent(convertedEventId)}`}>Calendar</a>
              <a className="pl-btn sm ghost" href={`/admin/planner/${convertedEventId}?room=payments`}>Quote & payments</a>
            </>
          )}
          {!creds && !convertedEventId && !merged && canConvert && (
            <button className="pl-btn" type="button" disabled={busy} onClick={convert}>Create client planner from this lead</button>
          )}
          <a className="pl-btn sm ghost" href="/admin/clients">Clients directory</a>
        </div>
      </section>
    </>
  );
}
