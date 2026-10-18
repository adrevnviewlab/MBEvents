import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  defaultChecklist,
  defaultDanceList,
  defaultTimeline,
  namedEventTypes,
  newPlannerData,
  planningBlockIds,
  uid,
  type AdminData,
  type PlannerData,
  type PlanningTemplateBody,
} from "@/lib/planner";
import { inferTimelineKind, isTimelineKind } from "@/lib/timeline";

export { namedEventTypes, planningBlockIds };

const hiddenKeys = new Set([
  "internalnotes",
  "internalnote",
  "internal_notes",
  "internal_note",
  "staffrate",
  "staffrates",
  "staff_rate",
  "staff_rates",
  "payout",
  "payouts",
  "margin",
  "margins",
  "profitmargin",
  "profit_margin",
  "cost",
  "costs",
  "incident",
  "incidents",
  "incidentreport",
  "incident_report",
]);

export function omitHiddenFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => omitHiddenFields(item)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (hiddenKeys.has(key.toLowerCase())) continue;
    out[key] = omitHiddenFields(item);
  }
  return out as T;
}

export function clientVisibleAdmin(admin: AdminData) {
  return {
    packageName: admin.packageName,
    lineItems: admin.lineItems.map(({ id, description, qty, price }) => ({ id, description, qty, price })),
    taxRate: admin.taxRate,
    payments: admin.payments.map(({ id, label, amount, due, status, paidAt, method, ref }) => ({ id, label, amount, due, status, paidAt, method, ref })),
    documents: admin.documents
      .filter((doc) => doc.status !== "draft")
      .map(({ id, title, body, status, createdAt, signedName, signature, signedAt, signedIp }) => ({
        id, title, body, status, createdAt, signedName, signature, signedAt, signedIp,
      })),
    guestRequestsOpen: admin.guestRequestsOpen,
    noteForClient: admin.noteForClient,
  };
}

export function defaultTemplateBody(eventType: string): PlanningTemplateBody {
  return {
    checklist: defaultChecklist().map(({ text, due }) => ({ text, due })),
    timeline: defaultTimeline(eventType).map(({ time, what, endTime, kind }) => ({
      time,
      what,
      endTime: endTime || "",
      kind,
    })),
    dances: defaultDanceList(eventType).map(({ moment }) => ({ moment })),
    blocks: [...planningBlockIds],
  };
}

export function applyPlanningTemplate(data: PlannerData, template: PlanningTemplateBody): PlannerData {
  const have = new Set(data.forms.dances.map((dance) => dance.moment.trim().toLowerCase()).filter(Boolean));
  const added = template.dances.filter((dance) => dance.moment.trim() && !have.has(dance.moment.trim().toLowerCase()));
  const dances = data.forms.dances.length
    ? [...data.forms.dances, ...added.map((dance) => ({ id: uid(), moment: dance.moment, song: "", artist: "", notes: "" }))]
    : template.dances.map((dance) => ({ id: uid(), moment: dance.moment, song: "", artist: "", notes: "" }));
  return {
    ...data,
    checklist: data.checklist.length
      ? data.checklist
      : template.checklist.map((item) => ({ id: uid(), text: item.text, due: item.due, done: false })),
    timeline: data.timeline.length
      ? data.timeline
      : template.timeline.map((item) => ({
        id: uid(),
        time: item.time,
        endTime: item.endTime || "",
        what: item.what,
        song: "",
        who: "",
        kind: isTimelineKind(item.kind) ? item.kind : inferTimelineKind(item.what),
        notes: "",
        clientVisible: true,
      })),
    forms: { ...data.forms, dances },
    blocks: data.blocks?.length ? data.blocks : [...template.blocks],
  };
}

export function planningPatch(before: PlannerData, after: PlannerData): Partial<PlannerData> {
  const patch: Partial<PlannerData> = {};
  if (JSON.stringify(before.checklist) !== JSON.stringify(after.checklist)) patch.checklist = after.checklist;
  if (JSON.stringify(before.timeline) !== JSON.stringify(after.timeline)) patch.timeline = after.timeline;
  if (JSON.stringify(before.forms) !== JSON.stringify(after.forms)) patch.forms = after.forms;
  if (JSON.stringify(before.blocks ?? []) !== JSON.stringify(after.blocks ?? [])) patch.blocks = after.blocks;
  return patch;
}

export type PlanningTemplate = PlanningTemplateBody & {
  id: string;
  eventType: string;
  name: string;
  published: boolean;
  seeded: boolean;
  updatedAt: string;
};

type TemplateRow = {
  id: string;
  event_type: string;
  name: string;
  checklist: unknown;
  timeline: unknown;
  dances: unknown;
  blocks: unknown;
  published: boolean;
  seeded: boolean;
  updated_at: string;
};

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function asArray(value: unknown) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function toTemplate(row: TemplateRow): PlanningTemplate {
  const checklist = asArray(row.checklist).map((item) => {
    const rowItem = item as { text?: string; due?: string };
    return { text: String(rowItem.text ?? ""), due: String(rowItem.due ?? "") };
  });
  const timeline = asArray(row.timeline).map((item) => {
    const rowItem = item as { time?: string; what?: string; endTime?: string; kind?: string };
    const what = String(rowItem.what ?? "");
    const kind = isTimelineKind(rowItem.kind) ? rowItem.kind : inferTimelineKind(what);
    return {
      time: String(rowItem.time ?? ""),
      what,
      endTime: String(rowItem.endTime ?? ""),
      kind,
    };
  });
  const dances = asArray(row.dances).map((item) => {
    const rowItem = item as { moment?: string };
    return { moment: String(rowItem.moment ?? "") };
  });
  const blocks = asArray(row.blocks).map((item) => String(item)).filter((item) => (planningBlockIds as readonly string[]).includes(item));
  return {
    id: row.id,
    eventType: row.event_type,
    name: row.name,
    checklist,
    timeline,
    dances,
    blocks,
    published: Boolean(row.published),
    seeded: Boolean(row.seeded),
    updatedAt: row.updated_at,
  };
}

const templateColumns = "id, event_type, name, checklist, timeline, dances, blocks, published, seeded, updated_at";

export async function ensureDefaultTemplates() {
  const db = database();
  for (const eventType of namedEventTypes) {
    const body = defaultTemplateBody(eventType);
    try {
      await db.prepare(
        `INSERT INTO planning_templates (id, event_type, name, checklist, timeline, dances, blocks, published, seeded)
         SELECT ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, true, true
         WHERE NOT EXISTS (SELECT 1 FROM planning_templates WHERE event_type = ? AND seeded = true)`,
      ).bind(
        crypto.randomUUID(),
        eventType,
        `${eventType} planning`,
        JSON.stringify(body.checklist),
        JSON.stringify(body.timeline),
        JSON.stringify(body.dances),
        JSON.stringify(body.blocks),
        eventType,
      ).run();
    } catch (error) {
      if (!String(error).includes("planning_templates_seed_uidx") && !String(error).includes("duplicate")) throw error;
    }
  }
}

export async function listPlanningTemplates() {
  await ensureDefaultTemplates();
  const rows = await database().prepare(`SELECT ${templateColumns} FROM planning_templates ORDER BY event_type, name`).all<TemplateRow>();
  return rows.results.map(toTemplate);
}

export async function getPlanningTemplate(id: string) {
  const row = await database().prepare(`SELECT ${templateColumns} FROM planning_templates WHERE id = ?`).bind(id).first<TemplateRow>();
  return row ? toTemplate(row) : null;
}

export async function publishedTemplateFor(eventType: string) {
  await ensureDefaultTemplates();
  const row = await database()
    .prepare(`SELECT ${templateColumns} FROM planning_templates WHERE event_type = ? AND published = true ORDER BY updated_at DESC LIMIT 1`)
    .bind(eventType)
    .first<TemplateRow>();
  return row ? toTemplate(row) : null;
}

export async function plannerDataFor(input: Parameters<typeof newPlannerData>[0]) {
  const template = await publishedTemplateFor(input.eventType);
  return newPlannerData(input, template);
}

type TemplateWrite = {
  eventType: string;
  name: string;
  checklist?: { text: string; due: string }[];
  timeline?: { time: string; what: string }[];
  dances?: { moment: string }[];
  blocks?: string[];
  published?: boolean;
};

function bodyFrom(input: TemplateWrite, eventType: string): PlanningTemplateBody {
  const defaults = defaultTemplateBody(eventType);
  return {
    checklist: input.checklist ?? defaults.checklist,
    timeline: input.timeline ?? defaults.timeline,
    dances: input.dances ?? defaults.dances,
    blocks: input.blocks?.length ? input.blocks : defaults.blocks,
  };
}

async function auditPublish(id: string, input: TemplateWrite, actor: { email: string; ip?: string }, beforePublished: boolean) {
  if (!input.published || beforePublished) return;
  await audit({
    actorEmail: actor.email,
    action: "template_published",
    entity: "planning_templates",
    subjectId: id,
    ip: actor.ip,
    before: { published: false },
    after: { published: true, name: input.name, eventType: input.eventType },
  });
}

export async function createPlanningTemplate(input: TemplateWrite, actor: { email: string; ip?: string }) {
  const body = bodyFrom(input, input.eventType);
  const id = crypto.randomUUID();
  const published = Boolean(input.published);
  await database().prepare(
    `INSERT INTO planning_templates (id, event_type, name, checklist, timeline, dances, blocks, published, seeded)
     VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?, false)`,
  ).bind(id, input.eventType, input.name, JSON.stringify(body.checklist), JSON.stringify(body.timeline), JSON.stringify(body.dances), JSON.stringify(body.blocks), published).run();
  await auditPublish(id, { ...input, published }, actor, false);
  const saved = await getPlanningTemplate(id);
  if (!saved) throw new AppError("Could not save that template.", 500);
  return saved;
}

export async function updatePlanningTemplate(id: string, input: TemplateWrite, actor: { email: string; ip?: string }) {
  const current = await getPlanningTemplate(id);
  if (!current) return null;
  const body = bodyFrom(input, input.eventType);
  const published = input.published ?? current.published;
  await database().prepare(
    `UPDATE planning_templates
     SET event_type = ?, name = ?, checklist = ?::jsonb, timeline = ?::jsonb, dances = ?::jsonb, blocks = ?::jsonb, published = ?
     WHERE id = ?`,
  ).bind(input.eventType, input.name, JSON.stringify(body.checklist), JSON.stringify(body.timeline), JSON.stringify(body.dances), JSON.stringify(body.blocks), published, id).run();
  await auditPublish(id, { ...input, published }, actor, current.published);
  return getPlanningTemplate(id);
}
