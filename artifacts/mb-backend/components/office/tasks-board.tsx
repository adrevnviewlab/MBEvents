"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/components/planner/ui";

type Priority = "low" | "normal" | "high";
type Bucket = "overdue" | "today" | "upcoming" | "done" | "unscheduled";

type Task = {
  id: string;
  title: string;
  dueOn: string | null;
  done: boolean;
  priority: Priority;
  assigneeId: string | null;
  assigneeName: string | null;
  leadId: string | null;
  leadName: string | null;
  eventId: string | null;
  eventName: string | null;
  plannerId: string | null;
  bucket: Bucket;
  href: string;
};

type Staff = { id: string; name: string; email: string };
type EventOpt = { id: string; name: string; eventDate: string | null; plannerId: string | null };

type TasksPayload = {
  tasks: Task[];
  staff: Staff[];
  events: EventOpt[];
  canWrite: boolean;
  counts: { open: number; overdue: number; today: number; upcoming: number; done: number };
};

type ChecklistBoard = {
  templates: { id: string; eventType: string; name: string; published: boolean; seeded: boolean; itemCount: number }[];
  events: {
    id: string;
    plannerId: string | null;
    name: string;
    eventType: string;
    eventDate: string | null;
    clientDone: number;
    clientTotal: number;
    opsDone: number;
    opsTotal: number;
    href: string;
  }[];
};

type View = "list" | "board" | "history" | "checklists";

function shortDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function related(task: Task) {
  if (task.leadName) return { label: task.leadName, href: task.href, kind: "Lead" };
  if (task.eventName) return { label: task.eventName, href: task.href, kind: "Event" };
  return { label: "General", href: "/admin/tasks", kind: "Business" };
}

function priorityClass(priority: Priority) {
  if (priority === "high") return "is-high";
  if (priority === "low") return "is-low";
  return "";
}

export function TasksBoard() {
  const router = useRouter();
  const search = useSearchParams();
  const [view, setView] = useState<View>((search.get("view") as View) || "list");
  const [assignee, setAssignee] = useState(search.get("assignee") || "");
  const [eventId, setEventId] = useState(search.get("event") || "");
  const [deadline, setDeadline] = useState(search.get("deadline") || "all");
  const [q, setQ] = useState(search.get("q") || "");
  const [data, setData] = useState<TasksPayload | null>(null);
  const [checklists, setChecklists] = useState<ChecklistBoard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({
    title: "",
    dueOn: "",
    assigneeId: "",
    priority: "normal" as Priority,
    eventId: "",
    leadId: "",
  });

  const statusForView = view === "history" ? "done" : "open";

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (assignee) params.set("assignee", assignee);
    if (eventId) params.set("event", eventId);
    if (deadline && deadline !== "all" && view !== "history") params.set("deadline", deadline);
    if (q.trim()) params.set("q", q.trim());
    params.set("status", statusForView);
    if (view !== "list") params.set("view", view);
    return params.toString();
  }, [assignee, eventId, deadline, q, statusForView, view]);

  const load = () => {
    setLoading(true);
    const taskUrl = `/api/admin/tasks?${queryString}`;
    const jobs: Promise<unknown>[] = [api<TasksPayload>(taskUrl)];
    if (view === "checklists") jobs.push(api<ChecklistBoard>("/api/admin/checklists"));
    Promise.all(jobs)
      .then(([tasksBody, checklistBody]) => {
        setData(tasksBody as TasksPayload);
        if (checklistBody) setChecklists(checklistBody as ChecklistBoard);
        setError("");
      })
      .catch((reason: Error) => {
        setError(reason.message || "Could not load tasks.");
        setData(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [queryString, view]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (assignee) params.set("assignee", assignee);
    if (eventId) params.set("event", eventId);
    if (deadline && deadline !== "all") params.set("deadline", deadline);
    if (q.trim()) params.set("q", q.trim());
    if (view !== "list") params.set("view", view);
    const next = params.toString();
    router.replace(next ? `/admin/tasks?${next}` : "/admin/tasks", { scroll: false });
  }, [assignee, eventId, deadline, q, view, router]);

  const toggleDone = async (task: Task, done: boolean) => {
    if (!data?.canWrite) return;
    setBusy(task.id);
    try {
      await api(`/api/admin/tasks/${task.id}`, { method: "PATCH", body: { done } });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update task.");
    } finally {
      setBusy("");
    }
  };

  const patchTask = async (taskId: string, patch: Record<string, unknown>) => {
    if (!data?.canWrite) return;
    setBusy(taskId);
    try {
      await api(`/api/admin/tasks/${taskId}`, { method: "PATCH", body: patch });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update task.");
    } finally {
      setBusy("");
    }
  };

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!data?.canWrite) return;
    setBusy("create");
    try {
      await api("/api/admin/tasks", {
        method: "POST",
        body: {
          title: form.title,
          dueOn: form.dueOn || null,
          assigneeId: form.assigneeId || null,
          priority: form.priority,
          eventId: form.eventId || null,
          leadId: form.leadId || null,
        },
      });
      setForm({ title: "", dueOn: "", assigneeId: "", priority: "normal", eventId: "", leadId: "" });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create task.");
    } finally {
      setBusy("");
    }
  };

  const columns: { key: Bucket; label: string }[] = [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Due today" },
    { key: "upcoming", label: "Upcoming" },
    { key: "unscheduled", label: "No date" },
  ];

  const tasks = data?.tasks || [];

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="of-hello">
          <h1>Tasks & checklists</h1>
          <p>
            One task list for leads, events, and general office work — same `tasks` records as CRM follow-ups.
            Checklists reuse planning templates and event progress.
          </p>
          <div className="of-quick of-task-tabs" role="tablist" aria-label="Task views">
            {([
              ["list", "List"],
              ["board", "Board"],
              ["history", "Completed"],
              ["checklists", "Checklists"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`pl-btn sm${view === id ? "" : " ghost"}`}
                aria-selected={view === id}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
            <a className="pl-btn sm ghost" href="/admin/today">Today</a>
          </div>
        </header>

        {error ? <p className="of-state of-state-error" role="alert">{error}</p> : null}

        {view !== "checklists" ? (
          <>
            <form
              className="of-crm-filters of-task-filters"
              onSubmit={(event) => {
                event.preventDefault();
                load();
              }}
            >
              <label>
                Search
                <input className="of-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, lead, event…" />
              </label>
              <label>
                Assignee
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Anyone</option>
                  <option value="unassigned">Unassigned</option>
                  {(data?.staff || []).map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Event
                <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  <option value="">All events</option>
                  {(data?.events || []).map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}{event.eventDate ? ` · ${shortDate(event.eventDate)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {view !== "history" ? (
                <label>
                  Deadline
                  <select value={deadline} onChange={(e) => setDeadline(e.target.value)}>
                    <option value="all">Any</option>
                    <option value="overdue">Overdue</option>
                    <option value="today">Due today</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="unscheduled">No date</option>
                  </select>
                </label>
              ) : null}
              <div className="of-crm-filter-actions">
                <button type="submit" className="pl-btn sm">Apply</button>
              </div>
            </form>

            {data?.canWrite && view !== "history" ? (
              <form className="of-panel of-task-create" onSubmit={onCreate}>
                <div className="of-panel-head">
                  <h2>New task</h2>
                </div>
                <div className="of-crm-form">
                  <label className="wide">
                    Title
                    <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Call venue, send quote…" />
                  </label>
                  <label>
                    Due
                    <input type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} />
                  </label>
                  <label>
                    Priority
                    <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
                      <option value="high">High</option>
                      <option value="normal">Normal</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                  <label>
                    Assignee
                    <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                      <option value="">Unassigned</option>
                      {(data?.staff || []).map((person) => (
                        <option key={person.id} value={person.id}>{person.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Link to event
                    <select value={form.eventId} onChange={(e) => setForm({ ...form, eventId: e.target.value })}>
                      <option value="">None (general / lead)</option>
                      {(data?.events || []).map((event) => (
                        <option key={event.id} value={event.id}>{event.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Lead id (optional)
                    <input value={form.leadId} onChange={(e) => setForm({ ...form, leadId: e.target.value })} placeholder="UUID from CRM" />
                  </label>
                </div>
                <div className="of-task-create-actions">
                  <button type="submit" className="pl-btn sm" disabled={busy === "create"}>
                    {busy === "create" ? "Saving…" : "Add task"}
                  </button>
                </div>
              </form>
            ) : null}

            {loading ? <p className="of-state" role="status">Loading tasks…</p> : null}

            {!loading && view === "list" ? (
              <section className="of-panel">
                <div className="of-panel-head">
                  <h2>Open tasks <span className="of-count">{tasks.length}</span></h2>
                </div>
                <div className="of-table-wrap">
                  <table className="of-table of-task-table">
                    <thead>
                      <tr>
                        <th scope="col">Done</th>
                        <th scope="col">Task</th>
                        <th scope="col">Priority</th>
                        <th scope="col">Due</th>
                        <th scope="col">Assignee</th>
                        <th scope="col">Related</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.length ? tasks.map((task) => {
                        const link = related(task);
                        return (
                          <tr key={task.id} className={task.bucket === "overdue" ? "is-overdue" : ""}>
                            <td>
                              <input
                                type="checkbox"
                                checked={task.done}
                                disabled={!data?.canWrite || busy === task.id}
                                onChange={(e) => toggleDone(task, e.target.checked)}
                                aria-label={`Mark ${task.title} done`}
                              />
                            </td>
                            <td>
                              <strong>{task.title}</strong>
                              <small className="of-task-bucket">{task.bucket.replace("_", " ")}</small>
                            </td>
                            <td>
                              {data?.canWrite ? (
                                <select
                                  className={`of-task-priority ${priorityClass(task.priority)}`}
                                  value={task.priority}
                                  disabled={busy === task.id}
                                  onChange={(e) => patchTask(task.id, { priority: e.target.value })}
                                >
                                  <option value="high">High</option>
                                  <option value="normal">Normal</option>
                                  <option value="low">Low</option>
                                </select>
                              ) : task.priority}
                            </td>
                            <td>{shortDate(task.dueOn)}</td>
                            <td>
                              {data?.canWrite ? (
                                <select
                                  value={task.assigneeId || ""}
                                  disabled={busy === task.id}
                                  onChange={(e) => patchTask(task.id, { assigneeId: e.target.value || null })}
                                >
                                  <option value="">Unassigned</option>
                                  {(data?.staff || []).map((person) => (
                                    <option key={person.id} value={person.id}>{person.name}</option>
                                  ))}
                                </select>
                              ) : (task.assigneeName || "—")}
                            </td>
                            <td>
                              <a href={link.href}>{link.kind}: {link.label}</a>
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr><td colSpan={6}><p className="pl-empty">No open tasks match these filters.</p></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {!loading && view === "board" ? (
              <div className="of-pipe of-task-pipe">
                {columns.map((column) => {
                  const items = tasks.filter((task) => task.bucket === column.key);
                  return (
                    <section className="of-col" key={column.key}>
                      <header className="of-col-head">
                        <h2>{column.label}</h2>
                        <span className="of-count">{items.length}</span>
                      </header>
                      <div className="of-col-body">
                        {items.length ? items.map((task) => {
                          const link = related(task);
                          return (
                            <article className={`of-lead of-task-card ${priorityClass(task.priority)}`} key={task.id}>
                              <div className="of-lead-title">
                                <strong>{task.title}</strong>
                                <small>{shortDate(task.dueOn)} · {task.priority}</small>
                              </div>
                              <p className="of-crm-next">{task.assigneeName || "Unassigned"}</p>
                              <div className="of-lead-actions">
                                <a className="pl-btn sm ghost" href={link.href}>{link.kind}</a>
                                {data?.canWrite ? (
                                  <button
                                    type="button"
                                    className="pl-btn sm"
                                    disabled={busy === task.id}
                                    onClick={() => toggleDone(task, true)}
                                  >
                                    Done
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          );
                        }) : <p className="pl-empty">Empty</p>}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : null}

            {!loading && view === "history" ? (
              <section className="of-panel">
                <div className="of-panel-head">
                  <h2>Completed history <span className="of-count">{tasks.length}</span></h2>
                </div>
                {tasks.length ? tasks.map((task) => {
                  const link = related(task);
                  return (
                    <div className="of-crm-task is-done" key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <small>
                          {shortDate(task.dueOn)} · {task.assigneeName || "Unassigned"} ·{" "}
                          <a href={link.href}>{link.kind}: {link.label}</a>
                        </small>
                      </div>
                      {data?.canWrite ? (
                        <button type="button" className="pl-btn sm ghost" disabled={busy === task.id} onClick={() => toggleDone(task, false)}>
                          Reopen
                        </button>
                      ) : null}
                    </div>
                  );
                }) : <p className="pl-empty">No completed tasks yet.</p>}
              </section>
            ) : null}
          </>
        ) : null}

        {view === "checklists" ? (
          <div className="of-task-checklists">
            {loading && !checklists ? <p className="of-state" role="status">Loading checklists…</p> : null}
            <section className="of-panel">
              <div className="of-panel-head">
                <h2>Planning templates <span className="of-count">{checklists?.templates.length || 0}</span></h2>
                <a href="/admin/planner">Events</a>
              </div>
              <p className="of-muted-line">
                Reusable checklists by event type (Wedding, Sweet 16, Corporate, and more). Applied when a planner is created from a published template.
              </p>
              <div className="of-table-wrap">
                <table className="of-table">
                  <thead>
                    <tr>
                      <th scope="col">Template</th>
                      <th scope="col">Event type</th>
                      <th scope="col">Items</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(checklists?.templates || []).map((template) => (
                      <tr key={template.id}>
                        <td><strong>{template.name}</strong></td>
                        <td>{template.eventType}</td>
                        <td>{template.itemCount}</td>
                        <td>{template.published ? "Published" : "Draft"}{template.seeded ? " · seeded" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="of-panel">
              <div className="of-panel-head">
                <h2>Event checklist progress <span className="of-count">{checklists?.events.length || 0}</span></h2>
              </div>
              <p className="of-muted-line">
                Client planning checklist (planner) and internal ops checklist. Assignment and completion for ops items live on the event operations page.
              </p>
              <div className="of-table-wrap">
                <table className="of-table">
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Type</th>
                      <th scope="col">Date</th>
                      <th scope="col">Client checklist</th>
                      <th scope="col">Ops checklist</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {(checklists?.events || []).length ? (checklists?.events || []).map((event) => (
                      <tr key={event.id}>
                        <td><strong>{event.name}</strong></td>
                        <td>{event.eventType}</td>
                        <td>{shortDate(event.eventDate)}</td>
                        <td>
                          <span className="of-progress-text">{event.clientDone}/{event.clientTotal}</span>
                          <span className="of-progress" aria-hidden="true">
                            <span style={{ width: `${event.clientTotal ? (event.clientDone / event.clientTotal) * 100 : 0}%` }} />
                          </span>
                        </td>
                        <td>
                          <span className="of-progress-text">{event.opsDone}/{event.opsTotal}</span>
                          <span className="of-progress" aria-hidden="true">
                            <span style={{ width: `${event.opsTotal ? (event.opsDone / event.opsTotal) * 100 : 0}%` }} />
                          </span>
                        </td>
                        <td>
                          <a href={event.href}>Open</a>
                          {event.plannerId ? (
                            <> · <a href={`/admin/planner/${event.plannerId}/operations`}>Ops</a></>
                          ) : null}
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6}><p className="pl-empty">No active events with checklist progress yet.</p></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
