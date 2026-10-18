import { audit } from "@/lib/audit";
import { assertCan, can, type Role } from "@/lib/authz";
import { schedulingError } from "@/lib/conflicts";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export const profileTypes = ["dj", "mc", "dancer", "coordinator", "technician", "other"] as const;
export type ProfileType = (typeof profileTypes)[number];
export type Readiness = "unset" | "not_ready" | "ready";

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function assertOffice(role: Role, permission: string) {
  assertCan(role, "office.access");
  assertCan(role, permission);
}

export function isProfileType(value: string): value is ProfileType {
  return (profileTypes as readonly string[]).includes(value);
}

export function canSeeMoney(role: Role) {
  return can(role, "office.access") && can(role, "payments.read") && can(role, "assignments.read");
}

function clip(value: string, max: number) {
  return value.trim().slice(0, max);
}

function moneyOrNull(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) throw new AppError("Enter a whole amount in cents, or leave it blank.", 400);
  return value;
}

function timeRange(startsAt: string | null | undefined, endsAt: string | null | undefined) {
  if (!startsAt && !endsAt) return { startsAt: null, endsAt: null };
  const start = Date.parse(startsAt ?? "");
  const end = Date.parse(endsAt ?? "");
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new AppError("Enter a start and end, with the end after the start.", 400);
  }
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

function errorText(error: unknown) {
  return error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
}

async function staffByUser(userId: string) {
  if (!userId) return null;
  return database().prepare("SELECT id FROM staff WHERE user_id = ?").bind(userId).first<{ id: string }>();
}

async function assignedStaff(userId: string, eventId: string) {
  return database().prepare(
    `SELECT s.id FROM staff s
     JOIN assignments a ON a.staff_id = s.id
     WHERE s.user_id = ? AND a.event_id = ? AND a.status <> 'declined'`,
  ).bind(userId, eventId).first<{ id: string }>();
}

export async function eventReadiness(eventId: string): Promise<Readiness> {
  const row = await database().prepare("SELECT event_readiness(?) AS status").bind(eventId).first<{ status: string }>();
  if (row?.status === "ready" || row?.status === "not_ready") return row.status;
  return "unset";
}

export async function createAssignment(input: {
  actorRole: Role;
  eventId: string;
  staffId: string;
  roleLabel?: string;
  callTime?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  payoutCents?: number | null;
  internalNotes?: string;
}) {
  assertOffice(input.actorRole, "assignments.write");
  const window = timeRange(input.startsAt, input.endsAt);
  const id = crypto.randomUUID();
  try {
    const row = await database().prepare("SELECT create_staff_assignment(?, ?, ?, ?, ?, ?, ?, ?, ?) AS id").bind(
      id,
      input.eventId,
      input.staffId,
      clip(input.roleLabel ?? "", 200),
      clip(input.callTime ?? "", 40),
      window.startsAt,
      window.endsAt,
      moneyOrNull(input.payoutCents),
      clip(input.internalNotes ?? "", 4000),
    ).first<{ id: string }>();
    return row?.id ?? id;
  } catch (error) {
    const text = errorText(error);
    if (text.includes("duplicate") || text.includes("unique")) throw new AppError("That person is already assigned to this event in that role.", 409);
    schedulingError(error);
  }
}

export async function respondToAssignment(input: {
  actorUserId: string;
  actorEmail: string;
  assignmentId: string;
  decision: "accept" | "decline";
  ip?: string;
}) {
  const row = await database().prepare(
    `SELECT a.id, a.status, s.user_id
     FROM assignments a JOIN staff s ON s.id = a.staff_id
     WHERE a.id = ?`,
  ).bind(input.assignmentId).first<{ id: string; status: string; user_id: string | null }>();
  if (!row || row.user_id !== input.actorUserId) throw new AppError("You can only respond to your own assignment.", 403);
  const status = input.decision === "accept" ? "confirmed" : "declined";
  if (row.status === status) return status;
  try {
    await database().prepare("UPDATE assignments SET status = ? WHERE id = ?").bind(status, row.id).run();
  } catch (error) {
    schedulingError(error);
  }
  await audit({
    actorEmail: input.actorEmail,
    userId: input.actorUserId,
    action: status === "confirmed" ? "assignment_accepted" : "assignment_declined",
    entity: "assignments",
    subjectId: row.id,
    before: { status: row.status },
    after: { status },
    ip: input.ip,
  });
  return status;
}

async function replaceSkills(staffId: string, tags: string[]) {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 40) throw new AppError("Keep each skill under 40 characters.", 400);
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(tag);
    if (clean.length > 40) throw new AppError("Keep the skill list to 40 tags.", 400);
  }
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM staff_skills WHERE staff_id = ?").bind(staffId),
    ...clean.map((tag) => db.prepare("INSERT INTO staff_skills (id, staff_id, tag) VALUES (?, ?, ?)").bind(crypto.randomUUID(), staffId, tag)),
  ]);
}

export async function updateOwnProfile(userId: string, profileType: string, skills: string[]) {
  const staff = await staffByUser(userId);
  if (!staff) throw new AppError("No staff profile is linked to this login.", 404);
  if (!isProfileType(profileType)) throw new AppError("Choose a profile type.", 400);
  await database().prepare("UPDATE staff SET profile_type = ? WHERE id = ?").bind(profileType, staff.id).run();
  await replaceSkills(staff.id, skills);
}

export async function updateStaffRecord(input: {
  actorRole: Role;
  staffId: string;
  profileType: string;
  skills: string[];
  rateCents?: number | null;
}) {
  assertOffice(input.actorRole, "assignments.write");
  if (!isProfileType(input.profileType)) throw new AppError("Choose a profile type.", 400);
  await database().prepare("UPDATE staff SET profile_type = ? WHERE id = ?").bind(input.profileType, input.staffId).run();
  await replaceSkills(input.staffId, input.skills);
  if (input.rateCents !== undefined) {
    if (!canSeeMoney(input.actorRole)) throw new AppError("You don't have access to that.", 403);
    await database().prepare("UPDATE staff SET rate_cents = ? WHERE id = ?").bind(moneyOrNull(input.rateCents), input.staffId).run();
  }
}

export async function addStaffBlock(input: {
  actorRole: Role;
  actorUserId: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  note?: string;
}) {
  const mine = await staffByUser(input.actorUserId);
  if (input.actorRole === "staff") {
    if (!mine || mine.id !== input.staffId) throw new AppError("You can only edit your own availability.", 403);
  } else if (!mine || mine.id !== input.staffId) {
    assertOffice(input.actorRole, "assignments.write");
  }
  const window = timeRange(input.startsAt, input.endsAt);
  const id = crypto.randomUUID();
  await database().prepare("INSERT INTO staff_blocks (id, staff_id, starts_at, ends_at, note) VALUES (?, ?, ?, ?, ?)")
    .bind(id, input.staffId, window.startsAt, window.endsAt, clip(input.note ?? "", 400)).run();
  return id;
}

export async function removeStaffBlock(input: { actorRole: Role; actorUserId: string; blockId: string }) {
  const block = await database().prepare("SELECT staff_id FROM staff_blocks WHERE id = ?").bind(input.blockId).first<{ staff_id: string }>();
  if (!block) return;
  const mine = await staffByUser(input.actorUserId);
  if (input.actorRole === "staff") {
    if (!mine || mine.id !== block.staff_id) throw new AppError("You can only edit your own availability.", 403);
  } else if (!mine || mine.id !== block.staff_id) {
    assertOffice(input.actorRole, "assignments.write");
  }
  await database().prepare("DELETE FROM staff_blocks WHERE id = ?").bind(input.blockId).run();
}

export async function reserveEquipment(input: {
  actorRole: Role;
  equipmentId: string;
  eventId: string;
  quantity: number;
  startsAt?: string | null;
  endsAt?: string | null;
}) {
  assertOffice(input.actorRole, "equipment.write");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new AppError("Enter a quantity of at least 1.", 400);
  const window = timeRange(input.startsAt, input.endsAt);
  const id = crypto.randomUUID();
  try {
    await database().prepare(
      `INSERT INTO equipment_reservations (id, equipment_id, event_id, quantity, starts_at, ends_at, blocking)
       VALUES (?, ?, ?, ?, ?, ?, true)`,
    ).bind(id, input.equipmentId, input.eventId, input.quantity, window.startsAt, window.endsAt).run();
  } catch (error) {
    const text = errorText(error);
    if (text.includes("duplicate") || text.includes("unique")) throw new AppError("That equipment is already reserved for this event.", 409);
    schedulingError(error);
  }
  return id;
}

export async function cancelEquipmentReservation(input: { actorRole: Role; reservationId: string }) {
  assertOffice(input.actorRole, "equipment.write");
  await database().prepare("UPDATE equipment_reservations SET blocking = false, canceled_at = COALESCE(canceled_at, now()) WHERE id = ?").bind(input.reservationId).run();
}

export async function confirmEquipmentCheckout(input: {
  actorRole: Role;
  actorUserId: string;
  actorEmail: string;
  reservationId: string;
  ip?: string;
}) {
  const row = await database().prepare(
    "SELECT id, event_id, canceled_at, checked_out_at, returned_at FROM equipment_reservations WHERE id = ?",
  ).bind(input.reservationId).first<{
    id: string;
    event_id: string;
    canceled_at: string | null;
    checked_out_at: string | null;
    returned_at: string | null;
  }>();
  if (!row) throw new AppError("That reservation was not found.", 404);
  if (row.canceled_at) throw new AppError("That reservation was canceled.", 400);
  if (row.returned_at) throw new AppError("That gear was already returned.", 400);
  if (input.actorRole === "staff") {
    if (!(await assignedStaff(input.actorUserId, row.event_id))) throw new AppError("You can only check out gear for your events.", 403);
  } else {
    assertOffice(input.actorRole, "equipment.write");
  }
  if (row.checked_out_at) return row.checked_out_at;
  const checkedOutAt = new Date().toISOString();
  await database().prepare("UPDATE equipment_reservations SET checked_out_at = ? WHERE id = ?").bind(checkedOutAt, row.id).run();
  await audit({
    actorEmail: input.actorEmail,
    userId: input.actorUserId,
    action: "equipment_checked_out",
    entity: "equipment_reservations",
    subjectId: row.id,
    after: { checkedOutAt },
    ip: input.ip,
  });
  return checkedOutAt;
}

export async function confirmEquipmentReturn(input: {
  actorRole: Role;
  actorUserId: string;
  actorEmail: string;
  reservationId: string;
  ip?: string;
}) {
  const row = await database().prepare("SELECT id, event_id, returned_at FROM equipment_reservations WHERE id = ?")
    .bind(input.reservationId).first<{ id: string; event_id: string; returned_at: string | null }>();
  if (!row) throw new AppError("That reservation was not found.", 404);
  if (input.actorRole === "staff") {
    if (!(await assignedStaff(input.actorUserId, row.event_id))) throw new AppError("You can only confirm gear for your events.", 403);
  } else {
    assertOffice(input.actorRole, "equipment.write");
  }
  if (row.returned_at) return row.returned_at;
  const returnedAt = new Date().toISOString();
  await database().prepare("UPDATE equipment_reservations SET returned_at = ? WHERE id = ?").bind(returnedAt, row.id).run();
  await audit({
    actorEmail: input.actorEmail,
    userId: input.actorUserId,
    action: "equipment_returned",
    entity: "equipment_reservations",
    subjectId: row.id,
    before: { returnedAt: null },
    after: { returnedAt },
    ip: input.ip,
  });
  return returnedAt;
}

export async function addRequirement(input: {
  actorRole: Role;
  actorEmail: string;
  actorUserId: string | null;
  eventId: string;
  label: string;
  ip?: string;
}) {
  assertOffice(input.actorRole, "events.write");
  const label = clip(input.label, 300);
  if (!label) throw new AppError("Enter a requirement.", 400);
  const id = crypto.randomUUID();
  await database().prepare("INSERT INTO event_requirements (id, event_id, label, met) VALUES (?, ?, ?, false)").bind(id, input.eventId, label).run();
  await audit({
    actorEmail: input.actorEmail,
    userId: input.actorUserId,
    action: "requirement_created",
    entity: "event_requirements",
    subjectId: id,
    after: { eventId: input.eventId, label, met: false },
    ip: input.ip,
  });
  return id;
}

export async function setRequirementMet(input: {
  actorRole: Role;
  actorEmail: string;
  actorUserId: string | null;
  requirementId: string;
  met: boolean;
  ip?: string;
}) {
  assertOffice(input.actorRole, "events.write");
  const row = await database().prepare("SELECT id, event_id, label, met FROM event_requirements WHERE id = ?")
    .bind(input.requirementId).first<{ id: string; event_id: string; label: string; met: boolean }>();
  if (!row) throw new AppError("That requirement was not found.", 404);
  if (row.met === input.met) return eventReadiness(row.event_id);
  await database().prepare("UPDATE event_requirements SET met = ? WHERE id = ?").bind(input.met, row.id).run();
  await audit({
    actorEmail: input.actorEmail,
    userId: input.actorUserId,
    action: "requirement_updated",
    entity: "event_requirements",
    subjectId: row.id,
    before: { met: row.met, label: row.label },
    after: { met: input.met, label: row.label },
    ip: input.ip,
  });
  return eventReadiness(row.event_id);
}

export async function addChecklistItem(input: {
  actorRole: Role;
  eventId: string;
  title: string;
  assigneeId?: string | null;
}) {
  assertOffice(input.actorRole, "events.write");
  const title = clip(input.title, 300);
  if (!title) throw new AppError("Enter a checklist item.", 400);
  const assigneeId = input.assigneeId || null;
  if (assigneeId) {
    const staff = await database().prepare("SELECT id FROM staff WHERE id = ? AND active = true").bind(assigneeId).first<{ id: string }>();
    if (!staff) throw new AppError("Choose an active team member.", 400);
  }
  const id = crypto.randomUUID();
  await database().prepare(
    "INSERT INTO event_checklist (id, event_id, title, assignee_id) VALUES (?, ?, ?, ?)",
  ).bind(id, input.eventId, title, assigneeId).run();
  return id;
}

export async function setChecklistDone(input: { actorRole: Role; actorUserId: string; itemId: string; done: boolean }) {
  const row = await database().prepare("SELECT id, event_id FROM event_checklist WHERE id = ?").bind(input.itemId).first<{ id: string; event_id: string }>();
  if (!row) throw new AppError("That checklist item was not found.", 404);
  if (input.actorRole === "staff") {
    if (!(await assignedStaff(input.actorUserId, row.event_id))) throw new AppError("You can only update the checklist for your events.", 403);
  } else {
    assertOffice(input.actorRole, "events.write");
  }
  await database().prepare("UPDATE event_checklist SET done = ? WHERE id = ?").bind(input.done, row.id).run();
}

export async function setChecklistAssignee(input: {
  actorRole: Role;
  itemId: string;
  assigneeId: string | null;
}) {
  assertOffice(input.actorRole, "events.write");
  const row = await database().prepare("SELECT id, event_id FROM event_checklist WHERE id = ?").bind(input.itemId).first<{ id: string; event_id: string }>();
  if (!row) throw new AppError("That checklist item was not found.", 404);
  if (input.assigneeId) {
    const staff = await database().prepare("SELECT id FROM staff WHERE id = ? AND active = true").bind(input.assigneeId).first<{ id: string }>();
    if (!staff) throw new AppError("Choose an active team member.", 400);
  }
  await database().prepare("UPDATE event_checklist SET assignee_id = ? WHERE id = ?").bind(input.assigneeId, row.id).run();
}

export async function saveEventOps(input: {
  actorRole: Role;
  eventId: string;
  loadInInstructions: string;
  setupSchedule: string;
  breakdownSchedule: string;
  internalNotes: string;
}) {
  assertOffice(input.actorRole, "events.write");
  await database().prepare(
    `UPDATE events SET load_in_instructions = ?, setup_schedule = ?, breakdown_schedule = ?, internal_notes = ? WHERE id = ?`,
  ).bind(
    clip(input.loadInInstructions, 4000),
    clip(input.setupSchedule, 4000),
    clip(input.breakdownSchedule, 4000),
    clip(input.internalNotes, 4000),
    input.eventId,
  ).run();
}

export async function linkVendor(input: { actorRole: Role; eventId: string; vendorId: string }) {
  assertOffice(input.actorRole, "vendors.write");
  const vendor = await database().prepare("SELECT id, name, category, contact_name, email, phone FROM vendors WHERE id = ?")
    .bind(input.vendorId).first<{ id: string; name: string; category: string; contact_name: string; email: string; phone: string }>();
  if (!vendor) throw new AppError("That vendor was not found.", 404);
  try {
    await database().prepare(
      `INSERT INTO event_vendors (id, event_id, vendor_id, role, contact_name, company, phone, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), input.eventId, vendor.id, vendor.category, vendor.contact_name, vendor.name, vendor.phone, vendor.email).run();
  } catch (error) {
    if (errorText(error).includes("duplicate") || errorText(error).includes("unique")) throw new AppError("That vendor is already linked to this event.", 409);
    throw error;
  }
}

export async function fileIncident(input: {
  actorRole: Role;
  actorUserId: string;
  actorEmail: string;
  eventId: string;
  body: string;
  ip?: string;
}) {
  const body = clip(input.body, 4000);
  if (!body) throw new AppError("Describe what happened.", 400);
  const staff = await staffByUser(input.actorUserId);
  const assigned = staff ? await assignedStaff(input.actorUserId, input.eventId) : null;
  if (input.actorRole === "staff") {
    if (!assigned) throw new AppError("You can only file an incident for an event you are assigned to.", 403);
  } else if (!assigned) {
    assertOffice(input.actorRole, "events.write");
  }
  const id = crypto.randomUUID();
  await database().prepare("INSERT INTO incident_reports (id, event_id, staff_id, author_user_id, body) VALUES (?, ?, ?, ?, ?)")
    .bind(id, input.eventId, staff?.id ?? null, input.actorUserId, body).run();
  await audit({
    actorEmail: input.actorEmail,
    userId: input.actorUserId,
    action: "incident_created",
    entity: "incident_reports",
    subjectId: id,
    after: { eventId: input.eventId },
    ip: input.ip,
  });
  return id;
}

export async function listIncidents(input: { actorRole: Role; actorUserId: string; eventId: string }) {
  if (input.actorRole === "staff") {
    if (!(await assignedStaff(input.actorUserId, input.eventId))) throw new AppError("You can only read incidents for your events.", 403);
  } else {
    assertOffice(input.actorRole, "events.read");
  }
  const rows = await database().prepare("SELECT id, body, created_at FROM incident_reports WHERE event_id = ? ORDER BY created_at")
    .bind(input.eventId).all<{ id: string; body: string; created_at: string }>();
  return rows.results;
}

export type StaffBrief = {
  profile: null | { id: string; name: string; email: string; phone: string; profileType: string; skills: string[] };
  blocks: { id: string; startsAt: string; endsAt: string; note: string }[];
  events: {
    id: string;
    name: string;
    eventType: string;
    eventDate: string | null;
    startTime: string;
    endTime: string;
    loadInInstructions: string;
    setupSchedule: string;
    breakdownSchedule: string;
    venueName: string;
    venueAddress: string;
    assignment: { id: string; roleLabel: string; status: string; callTime: string; startsAt: string | null; endsAt: string | null };
    crew: { name: string; phone: string; email: string; profileType: string; roleLabel: string }[];
    vendors: { name: string; category: string; contactName: string; email: string; phone: string; role: string }[];
    checklist: { id: string; title: string; done: boolean; assignee_id?: string | null; assignee_name?: string | null }[];
    packing: { id: string; label: string; packed: boolean; reservationId: string }[];
    reservations: { id: string; equipmentName: string; quantity: number; returnedAt: string | null; damageNotes: string }[];
    incidents: { id: string; body: string; createdAt: string }[];
    /** Client planner run-of-show shared with assigned crew (same event_id). */
    runOfShow: {
      timeline: {
        time: string;
        endTime: string;
        what: string;
        song: string;
        who: string;
        kind: string;
        notes: string;
      }[];
      mustPlay: { title: string; artist: string; moment: string }[];
      doNotPlay: { title: string; artist: string }[];
      specialMoments: { title: string; artist: string; moment: string }[];
      mcNotes: string;
    };
  }[];
};

export async function staffBrief(userId: string): Promise<StaffBrief> {
  const db = database();
  const staff = await db.prepare(
    "SELECT id, name, email, phone, profile_type FROM staff WHERE user_id = ?",
  ).bind(userId).first<{ id: string; name: string; email: string; phone: string; profile_type: string }>();
  if (!staff) return { profile: null, blocks: [], events: [] };
  const skills = await db.prepare("SELECT tag FROM staff_skills WHERE staff_id = ? ORDER BY lower(tag)").bind(staff.id).all<{ tag: string }>();
  const blocks = await db.prepare("SELECT id, starts_at, ends_at, note FROM staff_blocks WHERE staff_id = ? ORDER BY starts_at").bind(staff.id).all<{ id: string; starts_at: string; ends_at: string; note: string }>();
  const events = await db.prepare(
    `SELECT e.id, e.name, e.event_type, e.event_date::text AS event_date, e.start_time, e.end_time,
            e.load_in_instructions, e.setup_schedule, e.breakdown_schedule,
            COALESCE(v.name, '') AS venue_name, COALESCE(v.address, '') AS venue_address,
            a.id AS assignment_id, a.role_label, a.status, a.call_time, a.starts_at, a.ends_at
     FROM assignments a
     JOIN events e ON e.id = a.event_id
     LEFT JOIN venues v ON v.id = e.venue_id
     WHERE a.staff_id = ?
     ORDER BY e.starts_at NULLS LAST, e.name`,
  ).bind(staff.id).all<{
    id: string; name: string; event_type: string; event_date: string | null; start_time: string; end_time: string;
    load_in_instructions: string; setup_schedule: string; breakdown_schedule: string;
    venue_name: string; venue_address: string;
    assignment_id: string; role_label: string; status: string; call_time: string; starts_at: string | null; ends_at: string | null;
  }>();

  const detailed = [];
  for (const event of events.results) {
    const [crew, vendors, checklist, reservations, incidents, planner] = await Promise.all([
      db.prepare(
        `SELECT s.name, s.phone, s.email, s.profile_type, a.role_label
         FROM assignments a JOIN staff s ON s.id = a.staff_id
         WHERE a.event_id = ? AND a.status <> 'declined'`,
      ).bind(event.id).all<{ name: string; phone: string; email: string; profile_type: string; role_label: string }>(),
      db.prepare(
        `SELECT COALESCE(NULLIF(btrim(v.name), ''), NULLIF(btrim(ev.company), ''), '') AS name,
                COALESCE(v.category, '') AS category,
                COALESCE(NULLIF(btrim(ev.contact_name), ''), NULLIF(btrim(v.contact_name), ''), '') AS contact_name,
                COALESCE(NULLIF(btrim(ev.email), ''), NULLIF(btrim(v.email), ''), '') AS email,
                COALESCE(NULLIF(btrim(ev.phone), ''), NULLIF(btrim(v.phone), ''), '') AS phone,
                COALESCE(ev.role, '') AS role
         FROM event_vendors ev
         LEFT JOIN vendors v ON v.id = ev.vendor_id
         WHERE ev.event_id = ?`,
      ).bind(event.id).all<{ name: string; category: string; contact_name: string; email: string; phone: string; role: string }>(),
      db.prepare(
        `SELECT ec.id, ec.title, ec.done, ec.assignee_id, s.name AS assignee_name
         FROM event_checklist ec
         LEFT JOIN staff s ON s.id = ec.assignee_id
         WHERE ec.event_id = ? ORDER BY ec.sort_order, ec.created_at`,
      ).bind(event.id).all<{ id: string; title: string; done: boolean; assignee_id: string | null; assignee_name: string | null }>(),
      db.prepare(
        `SELECT r.id, r.quantity, r.returned_at, r.damage_notes, eq.name AS equipment_name
         FROM equipment_reservations r JOIN equipment eq ON eq.id = r.equipment_id
         WHERE r.event_id = ? AND r.canceled_at IS NULL AND r.blocking`,
      ).bind(event.id).all<{ id: string; quantity: number; returned_at: string | null; damage_notes: string; equipment_name: string }>(),
      db.prepare("SELECT id, body, created_at FROM incident_reports WHERE event_id = ? ORDER BY created_at").bind(event.id).all<{ id: string; body: string; created_at: string }>(),
      db.prepare("SELECT data FROM planner_events WHERE event_id = ?").bind(event.id).first<{ data: unknown }>(),
    ]);
    const packing = await db.prepare(
      `SELECT p.id, p.label, p.packed, p.reservation_id
       FROM packing_items p
       JOIN equipment_reservations r ON r.id = p.reservation_id
       WHERE r.event_id = ? AND r.canceled_at IS NULL AND r.blocking
       ORDER BY p.created_at`,
    ).bind(event.id).all<{ id: string; label: string; packed: boolean; reservation_id: string }>();
    let runOfShow = {
      timeline: [] as {
        time: string;
        endTime: string;
        what: string;
        song: string;
        who: string;
        kind: string;
        notes: string;
      }[],
      mustPlay: [] as { title: string; artist: string; moment: string }[],
      doNotPlay: [] as { title: string; artist: string }[],
      specialMoments: [] as { title: string; artist: string; moment: string }[],
      mcNotes: "",
    };
    try {
      const raw = typeof planner?.data === "string" ? JSON.parse(planner.data) : planner?.data;
      const data = (raw && typeof raw === "object" ? raw : {}) as {
        timeline?: {
          time?: string;
          endTime?: string;
          what?: string;
          song?: string;
          who?: string;
          kind?: string;
          notes?: string;
        }[];
        songs?: { title?: string; artist?: string; kind?: string; moment?: string }[];
        forms?: { pronunciations?: string; announcements?: string; traditions?: string };
      };
      const timeline = Array.isArray(data.timeline) ? data.timeline : [];
      const songs = Array.isArray(data.songs) ? data.songs : [];
      runOfShow = {
        timeline: timeline.map((item) => ({
          time: (item.time ?? "").slice(0, 40),
          endTime: (item.endTime ?? "").slice(0, 40),
          what: (item.what ?? "").slice(0, 300),
          song: (item.song ?? "").slice(0, 120),
          who: (item.who ?? "").slice(0, 120),
          kind: (item.kind ?? "").slice(0, 40),
          notes: (item.notes ?? "").slice(0, 500),
        })).filter((item) => item.time || item.what),
        mustPlay: songs.filter((song) => song.kind === "Must play").map((song) => ({
          title: (song.title ?? "").slice(0, 200),
          artist: (song.artist ?? "").slice(0, 120),
          moment: (song.moment ?? "").slice(0, 120),
        })),
        doNotPlay: songs.filter((song) => song.kind === "Do not play").map((song) => ({
          title: (song.title ?? "").slice(0, 200),
          artist: (song.artist ?? "").slice(0, 120),
        })),
        specialMoments: songs.filter((song) => song.kind === "Special moment").map((song) => ({
          title: (song.title ?? "").slice(0, 200),
          artist: (song.artist ?? "").slice(0, 120),
          moment: (song.moment ?? "").slice(0, 120),
        })),
        mcNotes: [data.forms?.pronunciations, data.forms?.announcements, data.forms?.traditions].filter(Boolean).join("\n\n").slice(0, 4000),
      };
    } catch {
      // Planner JSON must never break the staff brief.
    }
    detailed.push({
      id: event.id,
      name: event.name,
      eventType: event.event_type,
      eventDate: event.event_date,
      startTime: event.start_time,
      endTime: event.end_time,
      loadInInstructions: event.load_in_instructions,
      setupSchedule: event.setup_schedule,
      breakdownSchedule: event.breakdown_schedule,
      venueName: event.venue_name,
      venueAddress: event.venue_address,
      assignment: {
        id: event.assignment_id,
        roleLabel: event.role_label,
        status: event.status,
        callTime: event.call_time,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
      },
      crew: crew.results.map((person) => ({
        name: person.name,
        phone: person.phone,
        email: person.email,
        profileType: person.profile_type,
        roleLabel: person.role_label,
      })),
      vendors: vendors.results.map((vendor) => ({
        name: vendor.name,
        category: vendor.category,
        contactName: vendor.contact_name,
        email: vendor.email,
        phone: vendor.phone,
        role: vendor.role,
      })),
      checklist: checklist.results,
      packing: packing.results.map((item) => ({ id: item.id, label: item.label, packed: item.packed, reservationId: item.reservation_id })),
      reservations: reservations.results.map((item) => ({
        id: item.id,
        equipmentName: item.equipment_name,
        quantity: item.quantity,
        returnedAt: item.returned_at,
        damageNotes: item.damage_notes,
      })),
      incidents: incidents.results.map((item) => ({ id: item.id, body: item.body, createdAt: item.created_at })),
      runOfShow,
    });
  }

  return {
    profile: { id: staff.id, name: staff.name, email: staff.email, phone: staff.phone, profileType: staff.profile_type, skills: skills.results.map((row) => row.tag) },
    blocks: blocks.results.map((block) => ({ id: block.id, startsAt: block.starts_at, endsAt: block.ends_at, note: block.note })),
    events: detailed,
  };
}

export async function officeEvent(eventId: string, role: Role) {
  assertOffice(role, "events.read");
  const db = database();
  const event = await db.prepare(
    `SELECT id, name, load_in_instructions, setup_schedule, breakdown_schedule, internal_notes
     FROM events WHERE id = ?`,
  ).bind(eventId).first<{ id: string; name: string; load_in_instructions: string; setup_schedule: string; breakdown_schedule: string; internal_notes: string }>();
  if (!event) throw new AppError("That event was not found.", 404);
  const money = canSeeMoney(role);
  const [readiness, checklist, requirements, assignments, vendors, vendorOptions, staffOptions, categories, assets, reservations, packing, blocks, incidents] = await Promise.all([
    eventReadiness(eventId),
    db.prepare(
      `SELECT ec.id, ec.title, ec.done, ec.assignee_id, s.name AS assignee_name
       FROM event_checklist ec
       LEFT JOIN staff s ON s.id = ec.assignee_id
       WHERE ec.event_id = ? ORDER BY ec.sort_order, ec.created_at`,
    ).bind(eventId).all<{ id: string; title: string; done: boolean; assignee_id: string | null; assignee_name: string | null }>(),
    db.prepare("SELECT id, label, met FROM event_requirements WHERE event_id = ? ORDER BY created_at").bind(eventId).all<{ id: string; label: string; met: boolean }>(),
    db.prepare(
      `SELECT a.id, a.staff_id, a.role_label, a.status, a.starts_at, a.ends_at, a.call_time, a.internal_notes,
              ${money ? "a.payout_cents, s.rate_cents" : "NULL::int AS payout_cents, NULL::int AS rate_cents"},
              s.name AS staff_name,
              EXISTS (
                SELECT 1 FROM staff_blocks bl
                WHERE bl.staff_id = a.staff_id
                  AND a.starts_at IS NOT NULL AND a.ends_at IS NOT NULL
                  AND a.starts_at < bl.ends_at AND a.ends_at > bl.starts_at
              ) AS block_conflict
       FROM assignments a JOIN staff s ON s.id = a.staff_id
       WHERE a.event_id = ? ORDER BY s.name`,
    ).bind(eventId).all<{ id: string; staff_id: string; role_label: string; status: string; starts_at: string | null; ends_at: string | null; call_time: string; internal_notes: string; payout_cents: number | null; rate_cents: number | null; staff_name: string; block_conflict: boolean }>(),
    db.prepare(
      `SELECT ev.id, ev.vendor_id, ev.role, ev.contact_name, ev.company, ev.phone, ev.email
       FROM event_vendors ev WHERE ev.event_id = ?`,
    ).bind(eventId).all<{ id: string; vendor_id: string | null; role: string; contact_name: string; company: string; phone: string; email: string }>(),
    db.prepare("SELECT id, name, category FROM vendors WHERE active = true ORDER BY name").all<{ id: string; name: string; category: string }>(),
    db.prepare(
      `SELECT id, name, profile_type, ${money ? "rate_cents" : "NULL::int AS rate_cents"}
       FROM staff WHERE active = true ORDER BY name`,
    ).all<{ id: string; name: string; profile_type: string; rate_cents: number | null }>(),
    db.prepare("SELECT id, name FROM equipment_categories ORDER BY name").all<{ id: string; name: string }>(),
    db.prepare("SELECT id, name, category, quantity, backup_equipment_id FROM equipment WHERE active = true ORDER BY name").all<{ id: string; name: string; category: string; quantity: number; backup_equipment_id: string | null }>(),
    db.prepare(
      `SELECT r.id, r.equipment_id, r.quantity, r.starts_at, r.ends_at, r.canceled_at, r.checked_out_at, r.returned_at, r.maintenance_notes, r.damage_notes, r.blocking,
              eq.name AS equipment_name, eq.quantity AS stock_quantity,
              (SELECT coalesce(sum(o.quantity), 0)::int FROM equipment_reservations o
               WHERE o.equipment_id = r.equipment_id AND o.canceled_at IS NULL AND o.returned_at IS NULL AND o.blocking
                 AND o.id <> r.id) AS other_reserved
       FROM equipment_reservations r
       LEFT JOIN equipment eq ON eq.id = r.equipment_id
       WHERE r.event_id = ?`,
    ).bind(eventId).all<{ id: string; equipment_id: string; quantity: number; starts_at: string | null; ends_at: string | null; canceled_at: string | null; checked_out_at: string | null; returned_at: string | null; maintenance_notes: string; damage_notes: string; blocking: boolean; equipment_name: string | null; stock_quantity: number | null; other_reserved: number }>(),
    db.prepare(
      `SELECT p.id, p.reservation_id, p.label, p.packed
       FROM packing_items p
       JOIN equipment_reservations r ON r.id = p.reservation_id
       WHERE r.event_id = ?
       ORDER BY p.created_at`,
    ).bind(eventId).all<{ id: string; reservation_id: string; label: string; packed: boolean }>(),
    db.prepare(
      `SELECT b.id, b.staff_id, s.name AS staff_name, b.starts_at::text AS starts_at, b.ends_at::text AS ends_at, b.note
       FROM staff_blocks b
       JOIN staff s ON s.id = b.staff_id
       WHERE b.ends_at >= now()
       ORDER BY b.starts_at
       LIMIT 40`,
    ).all<{ id: string; staff_id: string; staff_name: string; starts_at: string; ends_at: string; note: string }>(),
    db.prepare("SELECT id, body, created_at FROM incident_reports WHERE event_id = ? ORDER BY created_at").bind(eventId).all<{ id: string; body: string; created_at: string }>(),
  ]);
  return {
    event: {
      id: event.id,
      name: event.name,
      loadInInstructions: event.load_in_instructions,
      setupSchedule: event.setup_schedule,
      breakdownSchedule: event.breakdown_schedule,
      internalNotes: event.internal_notes,
    },
    readiness,
    money,
    checklist: checklist.results,
    requirements: requirements.results,
    assignments: assignments.results.map((row) => ({
      id: row.id,
      staffId: row.staff_id,
      staffName: row.staff_name,
      roleLabel: row.role_label,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      callTime: row.call_time,
      internalNotes: row.internal_notes,
      payoutCents: money ? row.payout_cents : null,
      rateCents: money ? row.rate_cents : null,
      blockConflict: Boolean(row.block_conflict),
      profileHref: `/admin/staff?person=${row.staff_id}`,
    })),
    vendors: vendors.results,
    vendorOptions: vendorOptions.results,
    staffOptions: staffOptions.results.map((row) => ({ id: row.id, name: row.name, profileType: row.profile_type, rateCents: money ? row.rate_cents : null })),
    categories: categories.results,
    assets: assets.results,
    reservations: reservations.results.map((row) => {
      const stock = Number(row.stock_quantity ?? 0);
      const other = Number(row.other_reserved ?? 0);
      const openQty = row.canceled_at || row.returned_at ? 0 : row.quantity;
      return {
        ...row,
        equipmentName: row.equipment_name || "Asset",
        checked_out_at: row.checked_out_at,
        stockPressure: !row.canceled_at && !row.returned_at && stock > 0 && other + openQty > stock,
        directoryHref: `/admin/equipment?asset=${row.equipment_id}`,
      };
    }),
    packing: packing.results.map((row) => ({
      id: row.id,
      reservationId: row.reservation_id,
      label: row.label,
      packed: row.packed,
    })),
    staffBlocks: blocks.results.map((row) => ({
      id: row.id,
      staffId: row.staff_id,
      staffName: row.staff_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      note: row.note || "",
    })),
    incidents: incidents.results,
    access: {
      events: can(role, "events.write"),
      assignments: can(role, "assignments.write"),
      equipment: can(role, "equipment.write"),
      vendors: can(role, "vendors.write"),
    },
  };
}

export async function addEquipmentCategory(input: { actorRole: Role; name: string }) {
  assertOffice(input.actorRole, "equipment.write");
  const name = clip(input.name, 80);
  if (!name) throw new AppError("Enter a category name.", 400);
  const id = crypto.randomUUID();
  try {
    await database().prepare("INSERT INTO equipment_categories (id, name) VALUES (?, ?)").bind(id, name).run();
  } catch (error) {
    if (errorText(error).includes("duplicate") || errorText(error).includes("unique")) throw new AppError("That category already exists.", 409);
    throw error;
  }
  return id;
}

export async function addEquipmentAsset(input: {
  actorRole: Role;
  name: string;
  categoryId?: string | null;
  quantity: number;
  backupEquipmentId?: string | null;
}) {
  assertOffice(input.actorRole, "equipment.write");
  const name = clip(input.name, 200);
  if (!name) throw new AppError("Enter an asset name.", 400);
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new AppError("Enter a quantity of zero or more.", 400);
  const backup = input.backupEquipmentId || null;
  const id = crypto.randomUUID();
  if (backup && backup === id) throw new AppError("An asset cannot be its own backup.", 400);
  const category = input.categoryId
    ? await database().prepare("SELECT name FROM equipment_categories WHERE id = ?").bind(input.categoryId).first<{ name: string }>()
    : null;
  await database().prepare(
    `INSERT INTO equipment (id, name, category, category_id, quantity, backup_equipment_id) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, name, category?.name ?? "", input.categoryId || null, input.quantity, backup).run();
  return id;
}

export async function addPackingItem(input: { actorRole: Role; reservationId: string; label: string }) {
  assertOffice(input.actorRole, "equipment.write");
  const label = clip(input.label, 200);
  if (!label) throw new AppError("Enter a packing item.", 400);
  const id = crypto.randomUUID();
  await database().prepare("INSERT INTO packing_items (id, reservation_id, label) VALUES (?, ?, ?)").bind(id, input.reservationId, label).run();
  return id;
}

export async function setPacked(input: { actorRole: Role; actorUserId: string; itemId: string; packed: boolean }) {
  const row = await database().prepare(
    `SELECT p.id, r.event_id FROM packing_items p JOIN equipment_reservations r ON r.id = p.reservation_id WHERE p.id = ?`,
  ).bind(input.itemId).first<{ id: string; event_id: string }>();
  if (!row) throw new AppError("That packing item was not found.", 404);
  if (input.actorRole === "staff") {
    if (!(await assignedStaff(input.actorUserId, row.event_id))) throw new AppError("You can only update packing for your events.", 403);
  } else {
    assertOffice(input.actorRole, "equipment.write");
  }
  await database().prepare("UPDATE packing_items SET packed = ? WHERE id = ?").bind(input.packed, row.id).run();
}

export async function saveReservationNotes(input: { actorRole: Role; reservationId: string; maintenanceNotes: string; damageNotes: string }) {
  assertOffice(input.actorRole, "equipment.write");
  await database().prepare("UPDATE equipment_reservations SET maintenance_notes = ?, damage_notes = ? WHERE id = ?")
    .bind(clip(input.maintenanceNotes, 4000), clip(input.damageNotes, 4000), input.reservationId).run();
}
