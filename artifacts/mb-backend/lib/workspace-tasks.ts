import { audit } from "@/lib/audit";
import { listOfficeStaff } from "@/lib/crm";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertCan, type Role } from "@/lib/authz";

export type TaskPriority = "low" | "normal" | "high";
export type TaskBucket = "overdue" | "today" | "upcoming" | "done" | "unscheduled";

export type WorkspaceTask = {
  id: string;
  title: string;
  dueOn: string | null;
  done: boolean;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  leadId: string | null;
  leadName: string | null;
  eventId: string | null;
  eventName: string | null;
  plannerId: string | null;
  clientVisible: boolean;
  bucket: TaskBucket;
  href: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskFilters = {
  assigneeId?: string | null;
  eventId?: string | null;
  leadId?: string | null;
  deadline?: "overdue" | "today" | "upcoming" | "unscheduled" | "all";
  status?: "open" | "done" | "all";
  q?: string;
  limit?: number;
};

type Actor = { email: string; userId: string | null; role: Role };

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function asPriority(value: string | null | undefined): TaskPriority {
  if (value === "low" || value === "high" || value === "normal") return value;
  return "normal";
}

function bucketFor(done: boolean, dueOn: string | null, today: string): TaskBucket {
  if (done) return "done";
  if (!dueOn) return "unscheduled";
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "today";
  return "upcoming";
}

function taskHref(row: { lead_id: string | null; event_id: string | null; planner_id: string | null }) {
  if (row.lead_id) return `/admin/leads/${row.lead_id}`;
  if (row.planner_id) return `/admin/planner/${row.planner_id}?room=overview`;
  if (row.event_id) return `/admin/calendar?event=${encodeURIComponent(row.event_id)}`;
  return "/admin/tasks";
}

function mapTask(row: {
  id: string;
  title: string;
  due_on: string | null;
  done: boolean;
  priority: string;
  assignee_id: string | null;
  assignee_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  event_id: string | null;
  event_name: string | null;
  planner_id: string | null;
  client_visible: boolean;
  created_at: string;
  updated_at: string;
}, today: string): WorkspaceTask {
  return {
    id: row.id,
    title: row.title,
    dueOn: row.due_on,
    done: row.done,
    priority: asPriority(row.priority),
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    leadId: row.lead_id,
    leadName: row.lead_name,
    eventId: row.event_id,
    eventName: row.event_name,
    plannerId: row.planner_id,
    clientVisible: Boolean(row.client_visible),
    bucket: bucketFor(row.done, row.due_on, today),
    href: taskHref(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertStaff(staffId: string) {
  const row = await database().prepare(
    `SELECT s.id FROM staff s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.active = true AND u.disabled_at IS NULL`,
  ).bind(staffId).first<{ id: string }>();
  if (!row) throw new AppError("Choose an active team member.", 400);
}

export async function listWorkspaceTasks(role: Role, filters: TaskFilters = {}) {
  assertCan(role, "tasks.read");
  const today = todayStamp();
  const where: string[] = ["1=1"];
  const binds: unknown[] = [];

  if (filters.assigneeId === "unassigned") {
    where.push("t.assignee_id IS NULL");
  } else if (filters.assigneeId) {
    where.push("t.assignee_id = ?");
    binds.push(filters.assigneeId);
  }
  if (filters.eventId) {
    where.push("t.event_id = ?");
    binds.push(filters.eventId);
  }
  if (filters.leadId) {
    where.push("t.lead_id = ?");
    binds.push(filters.leadId);
  }

  const status = filters.status || "open";
  if (status === "open") where.push("t.done = false");
  else if (status === "done") where.push("t.done = true");

  const deadline = filters.deadline || "all";
  if (deadline === "overdue") {
    where.push("t.done = false AND t.due_on IS NOT NULL AND t.due_on < CURRENT_DATE");
  } else if (deadline === "today") {
    where.push("t.done = false AND t.due_on = CURRENT_DATE");
  } else if (deadline === "upcoming") {
    where.push("t.done = false AND t.due_on IS NOT NULL AND t.due_on > CURRENT_DATE");
  } else if (deadline === "unscheduled") {
    where.push("t.done = false AND t.due_on IS NULL");
  }

  const q = (filters.q || "").trim().toLowerCase();
  if (q) {
    where.push(`(
      lower(t.title) LIKE '%' || ? || '%'
      OR lower(coalesce(l.name, '')) LIKE '%' || ? || '%'
      OR lower(coalesce(e.name, '')) LIKE '%' || ? || '%'
    )`);
    binds.push(q, q, q);
  }

  // Drop merged leads from lead-linked tasks unless asking for done history of a specific lead.
  where.push("(t.lead_id IS NULL OR l.merged_into_id IS NULL OR t.done = true)");

  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 400);
  const sql = `
    SELECT t.id, t.title, t.due_on::text AS due_on, t.done, coalesce(t.priority, 'normal') AS priority,
           t.assignee_id, s.name AS assignee_name,
           t.lead_id, l.name AS lead_name,
           t.event_id, e.name AS event_name, p.id AS planner_id,
           coalesce(t.client_visible, false) AS client_visible,
           t.created_at::text AS created_at, t.updated_at::text AS updated_at
    FROM tasks t
    LEFT JOIN staff s ON s.id = t.assignee_id
    LEFT JOIN leads l ON l.id = t.lead_id
    LEFT JOIN events e ON e.id = t.event_id
    LEFT JOIN planner_events p ON p.event_id = e.id
    WHERE ${where.join(" AND ")}
    ORDER BY t.done ASC,
             CASE coalesce(t.priority, 'normal') WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
             t.due_on NULLS LAST,
             t.created_at DESC
    LIMIT ${limit}`;

  const rows = await database().prepare(sql).bind(...binds).all<{
    id: string;
    title: string;
    due_on: string | null;
    done: boolean;
    priority: string;
    assignee_id: string | null;
    assignee_name: string | null;
    lead_id: string | null;
    lead_name: string | null;
    event_id: string | null;
    event_name: string | null;
    planner_id: string | null;
    client_visible: boolean;
    created_at: string;
    updated_at: string;
  }>();

  const tasks = rows.results.map((row) => mapTask(row, today));
  const staff = await listOfficeStaff();
  return {
    tasks,
    staff,
    counts: {
      open: tasks.filter((t) => !t.done).length,
      overdue: tasks.filter((t) => t.bucket === "overdue").length,
      today: tasks.filter((t) => t.bucket === "today").length,
      upcoming: tasks.filter((t) => t.bucket === "upcoming").length,
      done: tasks.filter((t) => t.done).length,
    },
  };
}

export async function createWorkspaceTask(input: {
  title: string;
  dueOn?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  leadId?: string | null;
  eventId?: string | null;
  clientVisible?: boolean;
}, actor: Actor) {
  assertCan(actor.role, "tasks.write");
  const title = input.title.trim();
  if (title.length < 2 || title.length > 200) throw new AppError("Add a short task title.", 400);
  const dueOn = input.dueOn || null;
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new AppError("Use a valid due date.", 400);
  const priority = asPriority(input.priority);
  const assigneeId = input.assigneeId || null;
  if (assigneeId) await assertStaff(assigneeId);

  let leadId = input.leadId || null;
  let eventId = input.eventId || null;
  if (leadId) {
    const lead = await database().prepare("SELECT id FROM leads WHERE id = ? AND merged_into_id IS NULL").bind(leadId).first<{ id: string }>();
    if (!lead) throw new AppError("That lead was not found.", 404);
  }
  if (eventId) {
    const event = await database().prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first<{ id: string }>();
    if (!event) throw new AppError("That event was not found.", 404);
  }

  const id = crypto.randomUUID();
  await database().prepare(
    `INSERT INTO tasks (id, lead_id, event_id, assignee_id, title, due_on, done, client_visible, priority)
     VALUES (?, ?, ?, ?, ?, ?, false, ?, ?)`,
  ).bind(id, leadId, eventId, assigneeId, title, dueOn, Boolean(input.clientVisible), priority).run();

  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    action: "task_created",
    entity: "tasks",
    subjectId: id,
    after: { title, dueOn, assigneeId, priority, leadId, eventId },
  });
  return { id };
}

export async function updateWorkspaceTask(taskId: string, patch: {
  title?: string;
  dueOn?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  done?: boolean;
  clientVisible?: boolean;
}, actor: Actor) {
  assertCan(actor.role, "tasks.write");
  const current = await database().prepare(
    `SELECT id, title, due_on::text AS due_on, done, coalesce(priority, 'normal') AS priority,
            assignee_id, lead_id, event_id, coalesce(client_visible, false) AS client_visible
     FROM tasks WHERE id = ?`,
  ).bind(taskId).first<{
    id: string;
    title: string;
    due_on: string | null;
    done: boolean;
    priority: string;
    assignee_id: string | null;
    lead_id: string | null;
    event_id: string | null;
    client_visible: boolean;
  }>();
  if (!current) throw new AppError("Task not found.", 404);

  const title = patch.title !== undefined ? patch.title.trim() : current.title;
  if (title.length < 2 || title.length > 200) throw new AppError("Add a short task title.", 400);
  const dueOn = patch.dueOn !== undefined ? patch.dueOn : current.due_on;
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new AppError("Use a valid due date.", 400);
  const priority = patch.priority !== undefined ? asPriority(patch.priority) : asPriority(current.priority);
  let assigneeId = patch.assigneeId !== undefined ? patch.assigneeId : current.assignee_id;
  if (assigneeId) await assertStaff(assigneeId);
  const done = patch.done !== undefined ? patch.done : current.done;
  const clientVisible = patch.clientVisible !== undefined ? patch.clientVisible : current.client_visible;

  await database().prepare(
    `UPDATE tasks
     SET title = ?, due_on = ?, assignee_id = ?, priority = ?, done = ?, client_visible = ?, updated_at = now()
     WHERE id = ?`,
  ).bind(title, dueOn, assigneeId, priority, done, clientVisible, taskId).run();

  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    action: "task_updated",
    entity: "tasks",
    subjectId: taskId,
    before: {
      title: current.title,
      dueOn: current.due_on,
      assigneeId: current.assignee_id,
      priority: current.priority,
      done: current.done,
    },
    after: { title, dueOn, assigneeId, priority, done },
  });
  return { id: taskId };
}

export async function listEventOptions(role: Role) {
  assertCan(role, "tasks.read");
  const rows = await database().prepare(
    `SELECT e.id, e.name, e.event_date::text AS event_date, p.id AS planner_id
     FROM events e
     JOIN bookings b ON b.event_id = e.id
     LEFT JOIN planner_events p ON p.event_id = e.id
     WHERE b.status IN ('tentative', 'confirmed')
     ORDER BY e.event_date NULLS LAST, e.name
     LIMIT 120`,
  ).all<{ id: string; name: string; event_date: string | null; planner_id: string | null }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name || "Event",
    eventDate: row.event_date,
    plannerId: row.planner_id,
  }));
}
