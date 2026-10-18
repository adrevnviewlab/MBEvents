import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { LeadInput } from "@/lib/lead";
import { leadStages } from "@/lib/lead-stages";
import { plannerDataFor } from "@/lib/planning-templates";
import { guestAccessToken, hashPassword, newAdminData, randomCode } from "@/lib/planner";
import { copyLeadPlaceToEvent } from "@/lib/places";
import { cleanEmail, createEventRecord, ensureCustomer } from "@/lib/records";

const sources = ["builder", "availability", "venue", "contact", "blueprint"] as const;
const seeded = new Set<string>(leadStages);

export type CrmActor = { email: string; userId?: string | null };

export type LeadPatch = {
  stage?: string;
  notes?: string;
  assigneeId?: string | null;
  consultationAt?: string | null;
  budgetCents?: number | null;
  lostReason?: string | null;
  venueName?: string | null;
};

type LeadRow = {
  id: string;
  customer_id: string | null;
  stage: string;
  source: string;
  name: string;
  email: string;
  phone: string;
  event_type: string;
  event_date: string | null;
  guest_count: string | null;
  location: string | null;
  venue_status: string | null;
  vibe: string | null;
  priorities: unknown;
  contact_method: string;
  campaign: string | null;
  notes: string | null;
  venue_name: string | null;
  budget_cents: number | null;
  services: unknown;
  lost_reason: string | null;
  consultation_at: string | null;
  assignee_id: string | null;
  merged_into_id: string | null;
  converted_event_id: string | null;
  created_at: string;
};

export type DuplicateLead = { id: string; name: string; email: string; phone: string; source: string; created_at: string };

const leadSelect = `id, customer_id, stage, source, name, email, phone, event_type, event_date::text AS event_date,
  guest_count, location, venue_status, vibe, priorities, contact_method, campaign, notes, venue_name, budget_cents,
  services, lost_reason, consultation_at, assignee_id, merged_into_id, converted_event_id, created_at`;

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function jsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function phoneKey(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : "";
}

export function budgetCentsOf(input: { budgetCents?: number | null; budget?: number | string | null }) {
  if (typeof input.budgetCents === "number") return input.budgetCents;
  if (input.budget == null || input.budget === "") return null;
  const dollars = typeof input.budget === "number" ? input.budget : Number(input.budget);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

export function parseBudgetDollars(value: string) {
  const cleaned = value.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new AppError("Enter the budget in dollars, like 1500 or 1500.00.", 400);
  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(cents) || cents > 2_000_000_000) throw new AppError("That budget is too large.", 400);
  return cents;
}

function stamp(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError("Enter a valid consultation time.", 400);
  return date.toISOString();
}

function sameStamp(left: string | null, right: string | null) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return new Date(left).getTime() === new Date(right).getTime();
}

async function activity(leadId: string, actor: string, kind: string, body: string) {
  await database().prepare("INSERT INTO lead_activities (id, lead_id, actor, kind, body) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), leadId, actor.slice(0, 200), kind, body.slice(0, 4000)).run();
}

async function leadById(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("Invalid lead.", 400);
  return database().prepare(`SELECT ${leadSelect} FROM leads WHERE id = ?`).bind(id).first<LeadRow>();
}

async function openLead(id: string) {
  const lead = await leadById(id);
  if (!lead) throw new AppError("Lead not found.", 404);
  if (lead.merged_into_id) throw new AppError("This inquiry was merged into another lead.", 409);
  return lead;
}

async function assertOfficeStaff(staffId: string) {
  const row = await database().prepare(
    `SELECT s.id, s.name FROM staff s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.active = true AND u.disabled_at IS NULL
       AND u.role IN ('admin', 'manager', 'sales', 'coordinator')`,
  ).bind(staffId).first<{ id: string; name: string }>();
  if (!row) throw new AppError("Assign this lead to an office user.", 400);
  return row;
}

export async function findPossibleDuplicates(leadId: string, email: string, phone: string) {
  const normalized = email.trim().toLowerCase();
  const key = phoneKey(phone);
  if (!normalized && !key) return [];
  const rows = await database().prepare(
    `SELECT id, name, email, phone, source, created_at FROM leads
     WHERE merged_into_id IS NULL AND id <> ?
       AND (
         (? <> '' AND lower(btrim(email)) = ?)
         OR (? = '' AND ? <> '' AND btrim(email) = '' AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ?)
       )
     ORDER BY created_at DESC
     LIMIT 20`,
  ).bind(leadId, normalized, normalized, normalized, key, key).all<DuplicateLead>();
  return rows.results;
}

export async function createInquiry(input: LeadInput) {
  const db = database();
  const id = crypto.randomUUID();
  const customerId = await ensureCustomer({ name: input.name, email: input.email, phone: input.phone });
  const services = input.services ?? [];
  const venue = (input.venueName ?? "").trim() || null;
  await db.batch([
    db.prepare(
      `INSERT INTO leads (
         id, customer_id, source, name, email, phone, event_type, event_date, guest_count, location, venue_status,
         vibe, priorities, contact_method, campaign, notes, venue_name, budget_cents, services
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?::jsonb)`,
    ).bind(
      id, customerId, input.source, input.name, input.email.toLowerCase(), input.phone, input.eventType,
      input.eventDate || null, input.guestCount || null, input.location || null, input.venueStatus || null,
      input.vibe || null, JSON.stringify(input.priorities ?? []), input.contactMethod, input.campaign || null,
      input.notes || null, venue, budgetCentsOf(input), JSON.stringify(services),
    ),
    db.prepare("INSERT INTO analytics_events (id, event_name, source, lead_id) VALUES (?, 'lead_created', ?, ?)")
      .bind(crypto.randomUUID(), input.source, id),
    db.prepare("INSERT INTO lead_activities (id, lead_id, actor, kind, body) VALUES (?, ?, 'website', 'lead_created', ?)")
      .bind(crypto.randomUUID(), id, "Inquiry received."),
  ]);
  const { attachInquiryLinks } = await import("@/lib/places");
  await attachInquiryLinks(id, input);
  const duplicates = await findPossibleDuplicates(id, input.email, input.phone);
  return { id, customerId, duplicates };
}

export async function updateLead(id: string, patch: LeadPatch, actor: CrmActor) {
  const current = await openLead(id);
  const stage = patch.stage ?? current.stage;
  const notes = patch.notes !== undefined ? patch.notes : (current.notes ?? "");
  const assigneeId = patch.assigneeId !== undefined ? patch.assigneeId : current.assignee_id;
  const consultationAt = patch.consultationAt !== undefined ? stamp(patch.consultationAt) : current.consultation_at;
  const budget = patch.budgetCents !== undefined ? patch.budgetCents : current.budget_cents;
  const lostReason = patch.lostReason !== undefined ? (patch.lostReason?.trim() || null) : current.lost_reason;
  const venueName = patch.venueName !== undefined ? (patch.venueName?.trim() || null) : current.venue_name;

  const stageRow = await database().prepare("SELECT key, label, active FROM lead_stages WHERE key = ?").bind(stage).first<{ key: string; label: string; active: boolean }>();
  if (!stageRow) throw new AppError("Choose a stage.", 400);
  if (!stageRow.active && stage !== current.stage) throw new AppError("That stage is not active.", 400);
  if (stage === "lost" && !lostReason?.trim()) throw new AppError("Add a reason this lead was lost.", 400);

  let assigneeName = "";
  if (assigneeId) assigneeName = (await assertOfficeStaff(assigneeId)).name;

  const stageChanged = stage !== current.stage;
  const assigneeChanged = assigneeId !== current.assignee_id;
  const notesChanged = notes !== (current.notes ?? "");
  const budgetChanged = budget !== current.budget_cents;
  const consultationChanged = !sameStamp(consultationAt, current.consultation_at);
  const reasonChanged = (lostReason ?? "") !== (current.lost_reason ?? "");
  const venueChanged = (venueName ?? "") !== (current.venue_name ?? "");
  if (!stageChanged && !assigneeChanged && !notesChanged && !budgetChanged && !consultationChanged && !reasonChanged && !venueChanged) return;

  await database().prepare(
    `UPDATE leads
     SET stage = ?, notes = ?, assignee_id = ?, consultation_at = ?, budget_cents = ?, lost_reason = ?, venue_name = ?, updated_at = now()
     WHERE id = ?`,
  ).bind(stage, notes, assigneeId, consultationAt, budget, lostReason, venueName, id).run();

  if (stageChanged) await activity(id, actor.email, "stage", `Stage set to ${stageRow.label}.`);
  if (assigneeChanged) await activity(id, actor.email, "assignment", assigneeId ? `Assigned to ${assigneeName}.` : "Assignment cleared.");
  if (notesChanged) await activity(id, actor.email, "note", notes.trim() || "Internal note cleared.");
  if (consultationChanged) await activity(id, actor.email, "consultation", consultationAt ? `Consultation set for ${consultationAt}.` : "Consultation cleared.");
  if (consultationChanged && consultationAt && current.email.includes("@")) {
    const { notifyConsultation } = await import("@/lib/communications");
    await notifyConsultation({
      leadId: id,
      email: current.email,
      name: current.name,
      when: consultationAt,
      origin: process.env.MB_PUBLIC_ORIGIN ?? "",
    }).catch(() => undefined);
  }

  const before = { stage: current.stage, assigneeId: current.assignee_id, notes: current.notes, budgetCents: current.budget_cents, consultationAt: current.consultation_at, lostReason: current.lost_reason, venueName: current.venue_name };
  const after = { stage, assigneeId, notes, budgetCents: budget, consultationAt, lostReason, venueName };
  if (stageChanged) await audit({ actorEmail: actor.email, userId: actor.userId, action: "lead_stage_changed", entity: "leads", subjectId: id, before, after });
  if (assigneeChanged) await audit({ actorEmail: actor.email, userId: actor.userId, action: "lead_assigned", entity: "leads", subjectId: id, before, after });
  if (notesChanged || budgetChanged || consultationChanged || reasonChanged || venueChanged) {
    await audit({ actorEmail: actor.email, userId: actor.userId, action: "lead_updated", entity: "leads", subjectId: id, before, after });
  }
}

export async function addLeadTask(leadId: string, input: {
  title: string;
  dueOn: string;
  assigneeId?: string | null;
  priority?: "low" | "normal" | "high";
}, actor: CrmActor) {
  await openLead(leadId);
  const title = input.title.trim();
  if (title.length < 2 || title.length > 200) throw new AppError("Add a short follow-up title.", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) throw new AppError("Add a due date.", 400);
  const assigneeId = input.assigneeId || null;
  if (assigneeId) await assertOfficeStaff(assigneeId);
  const priority = input.priority === "low" || input.priority === "high" ? input.priority : "normal";
  const id = crypto.randomUUID();
  await database().prepare("INSERT INTO tasks (id, lead_id, assignee_id, title, due_on, priority) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, leadId, assigneeId, title, input.dueOn, priority).run();
  await activity(leadId, actor.email, "note", `Follow-up set: ${title}, due ${input.dueOn}.`);
  await audit({ actorEmail: actor.email, userId: actor.userId, action: "lead_task_created", entity: "leads", subjectId: leadId, after: { taskId: id, title, dueOn: input.dueOn, assigneeId } });
  const lead = await openLead(leadId);
  const { notifyFollowUp } = await import("@/lib/communications");
  await notifyFollowUp({
    leadId,
    email: lead.email,
    name: lead.name,
    title,
    dueOn: input.dueOn,
    taskId: id,
    origin: process.env.MB_PUBLIC_ORIGIN ?? "",
  }).catch(() => undefined);
  await scheduleAutomationSafe("sales_follow_up", leadId, id);
  return { id };
}

async function scheduleAutomationSafe(kind: string, leadId: string, occurrence: string) {
  try {
    const { listTemplates, scheduleAutomation, createTemplate } = await import("@/lib/automations");
    const templates = await listTemplates();
    let template = templates.find((item) => item.kind === kind && item.channel === "email" && item.active);
    if (!template) {
      const created = await createTemplate({
        kind,
        channel: "email",
        delayMinutes: kind === "sales_follow_up" ? 24 * 60 : 60,
        subject: kind === "sales_follow_up" ? "Follow-up reminder" : "Consultation reminder",
        body: "A follow-up is due for this inquiry.",
        active: true,
      }, { email: "system@communications", userId: null });
      template = { ...created, active: true };
    }
    await scheduleAutomation({ templateId: template.id, entityType: "lead", entityId: leadId, occurrence });
  } catch {
    // Scheduling must never break CRM writes.
  }
}

export async function setLeadTaskDone(leadId: string, taskId: string, done: boolean, actor: CrmActor) {
  await openLead(leadId);
  const task = await database().prepare("SELECT id, done FROM tasks WHERE id = ? AND lead_id = ?").bind(taskId, leadId).first<{ id: string; done: boolean }>();
  if (!task) throw new AppError("Follow-up not found.", 404);
  await database().prepare("UPDATE tasks SET done = ?, updated_at = now() WHERE id = ?").bind(done, taskId).run();
  await audit({ actorEmail: actor.email, userId: actor.userId, action: "lead_task_updated", entity: "leads", subjectId: leadId, before: { taskId, done: task.done }, after: { taskId, done } });
}

export async function mergeLeads(survivorId: string, absorbedId: string, actor: CrmActor) {
  if (survivorId === absorbedId) throw new AppError("Choose two different inquiries.", 400);
  const survivor = await openLead(survivorId);
  const absorbed = await leadById(absorbedId);
  if (!absorbed) throw new AppError("Lead not found.", 404);
  if (absorbed.merged_into_id) throw new AppError("That inquiry was already merged.", 409);
  if (absorbed.converted_event_id) throw new AppError("Keep the booked inquiry and merge the other one into it.", 409);

  let customerId = survivor.customer_id;
  const email = cleanEmail(survivor.email);
  if (email || !customerId) customerId = await ensureCustomer({ name: survivor.name, email: survivor.email, phone: survivor.phone });
  const notes = [survivor.notes?.trim(), absorbed.notes?.trim()].filter(Boolean).join("\n\n");

  const db = database();
  await db.batch([
    db.prepare("UPDATE tasks SET lead_id = ? WHERE lead_id = ?").bind(survivorId, absorbedId),
    db.prepare("UPDATE lead_activities SET lead_id = ? WHERE lead_id = ?").bind(survivorId, absorbedId),
    db.prepare("UPDATE leads SET notes = ?, customer_id = ?, updated_at = now() WHERE id = ?").bind(notes || null, customerId, survivorId),
    db.prepare("UPDATE leads SET merged_into_id = ?, updated_at = now() WHERE id = ? AND merged_into_id IS NULL").bind(survivorId, absorbedId),
  ]);
  if (absorbed.notes?.trim()) await activity(survivorId, actor.email, "note", absorbed.notes.trim());
  await activity(survivorId, actor.email, "merge", "Merged another inquiry into this lead.");
  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    action: "lead_merged",
    entity: "leads",
    subjectId: survivorId,
    before: { absorbedId, absorbedCustomerId: absorbed.customer_id },
    after: { customerId },
  });
}

export async function bookLead(input: {
  leadId: string;
  actor: CrmActor;
  details: { clientNames: string; email: string; phone: string; eventType: string; eventDate: string; venueName: string; guestCount: string };
}) {
  const db = database();
  const lead = await openLead(input.leadId);
  if (lead.converted_event_id) throw new AppError("This lead is already booked.", 409);

  const email = cleanEmail(input.details.email) || cleanEmail(lead.email);
  let customerId = lead.customer_id;
  if (email) customerId = await ensureCustomer({ name: input.details.clientNames, email, phone: input.details.phone });
  else if (!customerId) customerId = await ensureCustomer({ name: input.details.clientNames, email: "", phone: input.details.phone });
  if (!customerId) throw new AppError("Could not save the customer.", 500);

  const eventId = crypto.randomUUID();
  const code = `MB-${randomCode(6)}`;
  const password = randomCode(10);
  const guestCode = `G-${randomCode(6)}`;
  const guestPassword = randomCode(6);
  const guestToken = guestAccessToken();
  const now = new Date().toISOString();
  const details = { ...input.details, email: email || input.details.email };
  let created = false;
  let bookingStatus = "pending";
  try {
    const event = await createEventRecord({
      id: eventId,
      customerId,
      leadId: input.leadId,
      name: details.clientNames,
      eventType: details.eventType,
      eventDate: details.eventDate,
      guestCount: details.guestCount,
      location: details.venueName,
    });
    bookingStatus = event.bookingStatus;
    created = true;
    await db.batch([
      db.prepare("INSERT INTO planner_events (id, created_at, updated_at, code, password_hash, guest_code, guest_password, guest_access_token, lead_id, event_id, data, admin_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(eventId, now, now, code, await hashPassword(password), guestCode, guestPassword, guestToken, input.leadId, eventId, JSON.stringify(await plannerDataFor(details)), JSON.stringify(newAdminData())),
      db.prepare(
        `UPDATE leads SET stage = 'booked', converted_event_id = ?, customer_id = ?, updated_at = now()
         WHERE id = ? AND converted_event_id IS NULL AND merged_into_id IS NULL`,
      ).bind(eventId, customerId, input.leadId),
    ]);
    const saved = await db.prepare("SELECT converted_event_id FROM leads WHERE id = ?").bind(input.leadId).first<{ converted_event_id: string | null }>();
    if (saved?.converted_event_id !== eventId) throw new AppError("This lead is already booked.", 409);
  } catch (error) {
    if (created) await db.prepare("DELETE FROM events WHERE id = ?").bind(eventId).run().catch(() => {});
    throw error;
  }

  await activity(input.leadId, input.actor.email, "conversion", "Booked. A planner was created and the date is not confirmed.");
  await audit({ actorEmail: input.actor.email, userId: input.actor.userId, action: "lead_converted", entity: "leads", subjectId: input.leadId, after: { eventId, bookingStatus } });
  await audit({ actorEmail: input.actor.email, userId: input.actor.userId, action: "planner_created", entity: "events", subjectId: eventId, after: { code, leadId: input.leadId } });
  await copyLeadPlaceToEvent(input.leadId, eventId);
  if (details.email.includes("@")) {
    const { notifyPlannerAccess } = await import("@/lib/communications");
    await notifyPlannerAccess({
      eventId,
      email: details.email,
      name: details.clientNames,
      code,
      password,
      origin: process.env.MB_PUBLIC_ORIGIN ?? "",
    }).catch(() => undefined);
  }
  return { id: eventId, code, password };
}

export async function listStages() {
  const rows = await database().prepare("SELECT key, label, position, active FROM lead_stages ORDER BY position, key").all<{ key: string; label: string; position: number; active: boolean }>();
  return rows.results;
}

export async function listOfficeStaff() {
  const rows = await database().prepare(
    `SELECT s.id, s.name, s.email FROM staff s
     JOIN users u ON u.id = s.user_id
     WHERE s.active = true AND u.disabled_at IS NULL
       AND u.role IN ('admin', 'manager', 'sales', 'coordinator')
     ORDER BY s.name, s.email`,
  ).all<{ id: string; name: string; email: string }>();
  return rows.results;
}

export async function addStage(label: string) {
  const clean = label.trim();
  if (clean.length < 2 || clean.length > 80) throw new AppError("Add a stage name.", 400);
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "stage";
  let key = base;
  let n = 2;
  while (await database().prepare("SELECT key FROM lead_stages WHERE key = ?").bind(key).first()) {
    key = `${base.slice(0, 36)}_${n}`;
    n += 1;
    if (n > 50) throw new AppError("Choose a different stage name.", 400);
  }
  const max = await database().prepare("SELECT COALESCE(MAX(position), -1)::int AS pos FROM lead_stages").first<{ pos: number }>();
  await database().prepare("INSERT INTO lead_stages (key, label, position) VALUES (?, ?, ?)").bind(key, clean, asNumber(max?.pos) + 1).run();
  return { key, label: clean };
}

export async function saveStages(stages: { key: string; label: string; active: boolean }[]) {
  const existing = await listStages();
  const known = new Set(existing.map((stage) => stage.key));
  const seen = new Set<string>();
  for (const stage of stages) {
    if (!known.has(stage.key) || seen.has(stage.key)) throw new AppError("That stage was not found.", 400);
    seen.add(stage.key);
    const label = stage.label.trim();
    if (label.length < 1 || label.length > 80) throw new AppError("Every stage needs a name.", 400);
    if (stage.key === "new_lead" && !stage.active) throw new AppError("The New Lead stage stays available for website inquiries.", 400);
    if (seeded.has(stage.key) && !existing.some((row) => row.key === stage.key)) throw new AppError("The original stages stay in the pipeline.", 400);
  }
  const db = database();
  await db.batch(stages.map((stage, index) => db.prepare("UPDATE lead_stages SET label = ?, position = ?, active = ? WHERE key = ?")
    .bind(stage.label.trim(), index, stage.active, stage.key)));
}

export type LeadListQuery = { q?: string; stage?: string; source?: string; assignee?: string; sort?: string; focus?: string };

export async function listLeads(query: LeadListQuery) {
  const db = database();
  const where = ["l.merged_into_id IS NULL"];
  const args: unknown[] = [];
  const q = (query.q ?? "").trim().slice(0, 120);
  if (q) {
    const term = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push("(l.name ILIKE ? ESCAPE '\\' OR l.email ILIKE ? ESCAPE '\\' OR l.phone ILIKE ? ESCAPE '\\')");
    args.push(term, term, term);
  }
  const stage = (query.stage ?? "").trim();
  if (/^[a-z0-9_]{1,80}$/.test(stage)) {
    where.push("l.stage = ?");
    args.push(stage);
  }
  const source = (query.source ?? "").trim();
  if ((sources as readonly string[]).includes(source)) {
    where.push("l.source = ?");
    args.push(source);
  }
  const assignee = (query.assignee ?? "").trim();
  if (assignee === "unassigned") where.push("l.assignee_id IS NULL");
  else if (/^[0-9a-f-]{36}$/i.test(assignee)) {
    where.push("l.assignee_id = ?");
    args.push(assignee);
  }
  const focus = (query.focus ?? "").trim();
  if (focus === "unassigned") where.push("l.assignee_id IS NULL");
  else if (focus === "booked") where.push("l.stage = 'booked'");
  else if (focus === "lost") where.push("l.stage = 'lost'");
  else if (focus === "consultations") where.push("l.consultation_at IS NOT NULL AND l.consultation_at >= now()");
  else if (focus === "new") where.push("l.created_at >= date_trunc('week', now())");
  else if (focus === "due") {
    where.push("EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.done = false AND t.due_on IS NOT NULL AND t.due_on <= CURRENT_DATE)");
  }
  const order = query.sort === "event" ? "l.event_date ASC NULLS LAST, l.created_at DESC" : "l.created_at DESC";
  const dueSql = `EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.done = false AND t.due_on IS NOT NULL AND t.due_on <= CURRENT_DATE)`;
  const [listed, counts, due, byStage] = await Promise.all([
    db.prepare(
      `SELECT l.id, l.created_at, l.stage, COALESCE(s.label, l.stage) AS stage_label, l.source, l.name, l.event_type,
              l.event_date::text AS event_date, l.guest_count, l.budget_cents, l.converted_event_id, l.customer_id,
              st.name AS assignee_name, l.consultation_at::text AS consultation_at,
              ${dueSql} AS follow_up_due,
              (SELECT t.title FROM tasks t WHERE t.lead_id = l.id AND t.done = false AND t.due_on IS NOT NULL AND t.due_on <= CURRENT_DATE ORDER BY t.due_on ASC, t.created_at ASC LIMIT 1) AS due_task
       FROM leads l
       LEFT JOIN lead_stages s ON s.key = l.stage
       LEFT JOIN staff st ON st.id = l.assignee_id
       WHERE ${where.join(" AND ")}
       ORDER BY ${order}
       LIMIT 200`,
    ).bind(...args).all<{
      id: string; created_at: string; stage: string; stage_label: string; source: string; name: string; event_type: string;
      event_date: string | null; guest_count: string | null; budget_cents: number | null; converted_event_id: string | null;
      customer_id: string | null; assignee_name: string | null; consultation_at: string | null;
      follow_up_due: boolean; due_task: string | null;
    }>(),
    db.prepare(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= date_trunc('week', now()))::int AS new_week,
         COUNT(*) FILTER (WHERE assignee_id IS NULL)::int AS unassigned,
         COUNT(*) FILTER (WHERE stage = 'booked')::int AS booked,
         COUNT(*) FILTER (WHERE stage = 'lost')::int AS lost,
         COUNT(*) FILTER (WHERE consultation_at IS NOT NULL AND consultation_at >= now())::int AS consultations
       FROM leads WHERE merged_into_id IS NULL`,
    ).first<{ new_week: number; unassigned: number; booked: number; lost: number; consultations: number }>(),
    db.prepare(
      `SELECT COUNT(*)::int AS count FROM tasks t
       JOIN leads l ON l.id = t.lead_id
       WHERE l.merged_into_id IS NULL AND t.done = false AND t.due_on IS NOT NULL AND t.due_on <= CURRENT_DATE`,
    ).first<{ count: number }>(),
    db.prepare(
      `SELECT s.key, s.label, COUNT(l.id)::int AS count
       FROM lead_stages s
       LEFT JOIN leads l ON l.stage = s.key AND l.merged_into_id IS NULL
       GROUP BY s.key, s.label, s.position, s.active
       HAVING s.active OR COUNT(l.id) > 0
       ORDER BY s.position`,
    ).all<{ key: string; label: string; count: number }>(),
  ]);
  return {
    leads: listed.results,
    stats: {
      newWeek: asNumber(counts?.new_week),
      unassigned: asNumber(counts?.unassigned),
      due: asNumber(due?.count),
      consultations: asNumber(counts?.consultations),
      booked: asNumber(counts?.booked),
      lost: asNumber(counts?.lost),
      byStage: byStage.results.map((row) => ({ key: row.key, label: row.label, count: asNumber(row.count) })),
    },
  };
}

export async function leadProfile(id: string) {
  const lead = await leadById(id);
  if (!lead) return null;
  const db = database();
  const [activities, tasks, duplicates, customer, stages, staff, mergedInto, assignee] = await Promise.all([
    db.prepare("SELECT id, actor, kind, body, created_at FROM lead_activities WHERE lead_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(id).all<{ id: string; actor: string; kind: string; body: string; created_at: string }>(),
    db.prepare(
      `SELECT t.id, t.title, t.due_on::text AS due_on, t.done, t.assignee_id, s.name AS assignee_name
       FROM tasks t LEFT JOIN staff s ON s.id = t.assignee_id
       WHERE t.lead_id = ? ORDER BY t.done, t.due_on NULLS LAST, t.created_at DESC`,
    ).bind(id).all<{ id: string; title: string; due_on: string | null; done: boolean; assignee_id: string | null; assignee_name: string | null }>(),
    findPossibleDuplicates(id, lead.email, lead.phone),
    lead.customer_id
      ? db.prepare("SELECT id, name, email, phone FROM customers WHERE id = ?").bind(lead.customer_id).first<{ id: string; name: string; email: string; phone: string }>()
      : Promise.resolve(null),
    db.prepare("SELECT key, label FROM lead_stages WHERE active = true OR key = ? ORDER BY position, key").bind(lead.stage).all<{ key: string; label: string }>(),
    listOfficeStaff(),
    lead.merged_into_id
      ? db.prepare("SELECT id, name FROM leads WHERE id = ?").bind(lead.merged_into_id).first<{ id: string; name: string }>()
      : Promise.resolve(null),
    lead.assignee_id
      ? db.prepare("SELECT id, name, email FROM staff WHERE id = ?").bind(lead.assignee_id).first<{ id: string; name: string; email: string }>()
      : Promise.resolve(null),
  ]);
  const people = staff.slice();
  if (assignee && !people.some((person) => person.id === assignee.id)) people.push(assignee);
  return {
    lead: { ...lead, services: jsonList(lead.services), priorities: jsonList(lead.priorities) },
    activities: activities.results,
    tasks: tasks.results,
    duplicates,
    customer,
    stages: stages.results,
    staff: people,
    mergedInto,
  };
}
