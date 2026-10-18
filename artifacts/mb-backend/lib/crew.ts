import { assertCan, can, type Role } from "@/lib/authz";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { canSeeMoney, isProfileType, profileTypes, type ProfileType } from "@/lib/operations";

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function clip(value: string, max: number) {
  return value.trim().slice(0, max);
}

function moneyOrNull(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) throw new AppError("Enter a whole amount in cents, or leave it blank.", 400);
  return value;
}

function assertOffice(role: Role, permission: string) {
  assertCan(role, "office.access");
  assertCan(role, permission);
}

export { profileTypes };
export type { ProfileType };

export type StaffRosterItem = {
  id: string;
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  profileType: string;
  active: boolean;
  hasLogin: boolean;
  skills: string[];
  upcomingAssignments: number;
  openBlocks: number;
  conflictCount: number;
  rateCents: number | null;
};

export type StaffProfile = StaffRosterItem & {
  canSeeContact: boolean;
  canWrite: boolean;
  money: boolean;
  assignments: {
    id: string;
    eventId: string;
    eventName: string;
    eventDate: string | null;
    roleLabel: string;
    status: string;
    callTime: string;
    startsAt: string | null;
    endsAt: string | null;
    internalNotes: string;
    payoutCents: number | null;
    href: string;
    blockConflict: boolean;
  }[];
  blocks: { id: string; startsAt: string; endsAt: string; note: string }[];
  tasks: {
    id: string;
    title: string;
    done: boolean;
    eventId: string;
    eventName: string;
    href: string;
  }[];
  briefLinks: { eventId: string; eventName: string; href: string; operationsHref: string }[];
};

export type EquipmentAssetProfile = {
  id: string;
  name: string;
  category: string;
  categoryId: string | null;
  quantity: number;
  active: boolean;
  backupEquipmentId: string | null;
  backupName: string;
  openReservations: number;
  reservedQuantity: number;
  availableHint: number;
  canWrite: boolean;
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
    packing: { id: string; label: string; packed: boolean }[];
    status: "canceled" | "returned" | "out" | "reserved";
  }[];
  packingSummary: { total: number; packed: number };
};

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

export async function listStaffRoster(role: Role, query = ""): Promise<{ people: StaffRosterItem[]; canWrite: boolean; money: boolean }> {
  assertOffice(role, "staff.read");
  const money = canSeeMoney(role);
  const showContact = can(role, "staff.read");
  const q = query.trim().toLowerCase();
  const rows = await database().prepare(
    `SELECT s.id, s.name, s.email, s.phone, s.job_title, s.profile_type, s.active, s.user_id IS NOT NULL AS has_login,
            ${money ? "s.rate_cents" : "NULL::int AS rate_cents"},
            (SELECT count(*)::int FROM assignments a
             WHERE a.staff_id = s.id AND a.status <> 'declined'
               AND (a.ends_at IS NULL OR a.ends_at >= now())) AS upcoming_assignments,
            (SELECT count(*)::int FROM staff_blocks b
             WHERE b.staff_id = s.id AND b.ends_at >= now()) AS open_blocks,
            (SELECT count(*)::int FROM assignments a
             WHERE a.staff_id = s.id AND a.status <> 'declined'
               AND a.starts_at IS NOT NULL AND a.ends_at IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM staff_blocks bl
                 WHERE bl.staff_id = a.staff_id
                   AND a.starts_at < bl.ends_at AND a.ends_at > bl.starts_at
               )) AS conflict_count,
            coalesce((
              SELECT string_agg(sk.tag, ',' ORDER BY lower(sk.tag))
              FROM staff_skills sk WHERE sk.staff_id = s.id
            ), '') AS skills
     FROM staff s
     WHERE (? = ''
       OR lower(s.name) LIKE '%' || ? || '%'
       OR lower(s.email) LIKE '%' || ? || '%'
       OR lower(s.profile_type) LIKE '%' || ? || '%'
       OR lower(s.job_title) LIKE '%' || ? || '%')
     ORDER BY s.active DESC, s.name
     LIMIT 300`,
  ).bind(q, q, q, q, q).all<{
    id: string;
    name: string;
    email: string;
    phone: string;
    job_title: string;
    profile_type: string;
    active: boolean;
    has_login: boolean;
    rate_cents: number | null;
    upcoming_assignments: number;
    open_blocks: number;
    conflict_count: number;
    skills: string;
  }>();

  return {
    people: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      email: showContact ? row.email : "",
      phone: showContact ? row.phone : "",
      jobTitle: row.job_title || "",
      profileType: row.profile_type,
      active: row.active !== false,
      hasLogin: Boolean(row.has_login),
      skills: row.skills ? row.skills.split(",").filter(Boolean) : [],
      upcomingAssignments: Number(row.upcoming_assignments),
      openBlocks: Number(row.open_blocks),
      conflictCount: Number(row.conflict_count),
      rateCents: money ? row.rate_cents : null,
    })),
    canWrite: can(role, "assignments.write"),
    money,
  };
}

export async function staffProfile(role: Role, staffId: string): Promise<StaffProfile> {
  assertOffice(role, "staff.read");
  const money = canSeeMoney(role);
  const showContact = can(role, "staff.read");
  const db = database();
  const row = await db.prepare(
    `SELECT s.id, s.name, s.email, s.phone, s.job_title, s.profile_type, s.active, s.user_id IS NOT NULL AS has_login,
            ${money ? "s.rate_cents" : "NULL::int AS rate_cents"}
     FROM staff s WHERE s.id = ?`,
  ).bind(staffId).first<{
    id: string;
    name: string;
    email: string;
    phone: string;
    job_title: string;
    profile_type: string;
    active: boolean;
    has_login: boolean;
    rate_cents: number | null;
  }>();
  if (!row) throw new AppError("That staff member was not found.", 404);

  const [skills, assignments, blocks, tasks] = await Promise.all([
    db.prepare("SELECT tag FROM staff_skills WHERE staff_id = ? ORDER BY lower(tag)").bind(staffId).all<{ tag: string }>(),
    db.prepare(
      `SELECT a.id, a.event_id, e.name AS event_name, e.event_date::text AS event_date,
              a.role_label, a.status, a.call_time, a.starts_at, a.ends_at, a.internal_notes,
              ${money ? "a.payout_cents" : "NULL::int AS payout_cents"},
              EXISTS (
                SELECT 1 FROM staff_blocks bl
                WHERE bl.staff_id = a.staff_id
                  AND a.starts_at IS NOT NULL AND a.ends_at IS NOT NULL
                  AND a.starts_at < bl.ends_at AND a.ends_at > bl.starts_at
              ) AS block_conflict
       FROM assignments a
       JOIN events e ON e.id = a.event_id
       WHERE a.staff_id = ?
       ORDER BY a.starts_at NULLS LAST, e.event_date NULLS LAST, e.name
       LIMIT 80`,
    ).bind(staffId).all<{
      id: string;
      event_id: string;
      event_name: string;
      event_date: string | null;
      role_label: string;
      status: string;
      call_time: string;
      starts_at: string | null;
      ends_at: string | null;
      internal_notes: string;
      payout_cents: number | null;
      block_conflict: boolean;
    }>(),
    db.prepare(
      "SELECT id, starts_at, ends_at, note FROM staff_blocks WHERE staff_id = ? ORDER BY starts_at DESC LIMIT 60",
    ).bind(staffId).all<{ id: string; starts_at: string; ends_at: string; note: string }>(),
    db.prepare(
      `SELECT ec.id, ec.title, ec.done, e.id AS event_id, e.name AS event_name
       FROM event_checklist ec
       JOIN events e ON e.id = ec.event_id
       WHERE ec.assignee_id = ?
       ORDER BY ec.done, e.event_date NULLS LAST, ec.sort_order, ec.created_at
       LIMIT 80`,
    ).bind(staffId).all<{ id: string; title: string; done: boolean; event_id: string; event_name: string }>(),
  ]);

  const mappedAssignments = assignments.results.map((item) => ({
    id: item.id,
    eventId: item.event_id,
    eventName: item.event_name,
    eventDate: item.event_date,
    roleLabel: item.role_label,
    status: item.status,
    callTime: item.call_time || "",
    startsAt: item.starts_at,
    endsAt: item.ends_at,
    internalNotes: item.internal_notes || "",
    payoutCents: money ? item.payout_cents : null,
    href: `/admin/planner/${item.event_id}?room=staff`,
    blockConflict: Boolean(item.block_conflict),
  }));

  return {
    id: row.id,
    name: row.name,
    email: showContact ? row.email : "",
    phone: showContact ? row.phone : "",
    jobTitle: row.job_title || "",
    profileType: row.profile_type,
    active: row.active !== false,
    hasLogin: Boolean(row.has_login),
    skills: skills.results.map((item) => item.tag),
    upcomingAssignments: mappedAssignments.filter((item) => item.status !== "declined").length,
    openBlocks: blocks.results.filter((block) => Date.parse(block.ends_at) >= Date.now()).length,
    conflictCount: mappedAssignments.filter((item) => item.blockConflict).length,
    rateCents: money ? row.rate_cents : null,
    canSeeContact: showContact,
    canWrite: can(role, "assignments.write"),
    money,
    assignments: mappedAssignments,
    blocks: blocks.results.map((block) => ({
      id: block.id,
      startsAt: block.starts_at,
      endsAt: block.ends_at,
      note: block.note || "",
    })),
    tasks: tasks.results.map((task) => ({
      id: task.id,
      title: task.title,
      done: Boolean(task.done),
      eventId: task.event_id,
      eventName: task.event_name,
      href: `/admin/planner/${task.event_id}?room=overview`,
    })),
    briefLinks: mappedAssignments
      .filter((item) => item.status !== "declined")
      .map((item) => ({
        eventId: item.eventId,
        eventName: item.eventName,
        href: item.href,
        operationsHref: `/admin/planner/${item.eventId}/operations`,
      })),
  };
}

export async function createStaffPerson(input: {
  actorRole: Role;
  name: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  profileType: string;
  skills?: string[];
  rateCents?: number | null;
}) {
  assertOffice(input.actorRole, "assignments.write");
  const name = clip(input.name, 120);
  if (!name) throw new AppError("Enter a name.", 400);
  if (!isProfileType(input.profileType)) throw new AppError("Choose an approved role.", 400);
  const id = crypto.randomUUID();
  const email = clip(input.email ?? "", 200);
  const phone = clip(input.phone ?? "", 40);
  const jobTitle = clip(input.jobTitle ?? "", 80);
  const rate = input.rateCents === undefined ? null : moneyOrNull(input.rateCents);
  if (rate !== null && !canSeeMoney(input.actorRole)) throw new AppError("You don't have access to that.", 403);
  await database().prepare(
    `INSERT INTO staff (id, name, email, phone, job_title, profile_type, rate_cents, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, true)`,
  ).bind(id, name, email, phone, jobTitle, input.profileType, rate).run();
  await replaceSkills(id, input.skills ?? []);
  return id;
}

export async function saveStaffPerson(input: {
  actorRole: Role;
  staffId: string;
  name: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  profileType: string;
  skills?: string[];
  active?: boolean;
  rateCents?: number | null;
}) {
  assertOffice(input.actorRole, "assignments.write");
  const name = clip(input.name, 120);
  if (!name) throw new AppError("Enter a name.", 400);
  if (!isProfileType(input.profileType)) throw new AppError("Choose an approved role.", 400);
  const existing = await database().prepare("SELECT id FROM staff WHERE id = ?").bind(input.staffId).first<{ id: string }>();
  if (!existing) throw new AppError("That staff member was not found.", 404);
  const email = clip(input.email ?? "", 200);
  const phone = clip(input.phone ?? "", 40);
  const jobTitle = clip(input.jobTitle ?? "", 80);
  const active = input.active !== false;
  await database().prepare(
    `UPDATE staff SET name = ?, email = ?, phone = ?, job_title = ?, profile_type = ?, active = ? WHERE id = ?`,
  ).bind(name, email, phone, jobTitle, input.profileType, active, input.staffId).run();
  if (input.skills) await replaceSkills(input.staffId, input.skills);
  if (input.rateCents !== undefined) {
    if (!canSeeMoney(input.actorRole)) throw new AppError("You don't have access to that.", 403);
    await database().prepare("UPDATE staff SET rate_cents = ? WHERE id = ?").bind(moneyOrNull(input.rateCents), input.staffId).run();
  }
}

export async function equipmentAssetProfile(role: Role, equipmentId: string): Promise<EquipmentAssetProfile> {
  assertOffice(role, "equipment.read");
  const db = database();
  const row = await db.prepare(
    `SELECT e.id, e.name, e.category, e.category_id, e.quantity, e.active, e.backup_equipment_id,
            coalesce(b.name, '') AS backup_name,
            (SELECT count(*)::int FROM equipment_reservations r
             WHERE r.equipment_id = e.id AND r.canceled_at IS NULL AND r.returned_at IS NULL AND r.blocking) AS open_reservations,
            (SELECT coalesce(sum(r.quantity), 0)::int FROM equipment_reservations r
             WHERE r.equipment_id = e.id AND r.canceled_at IS NULL AND r.returned_at IS NULL AND r.blocking) AS reserved_quantity
     FROM equipment e
     LEFT JOIN equipment b ON b.id = e.backup_equipment_id
     WHERE e.id = ?`,
  ).bind(equipmentId).first<{
    id: string;
    name: string;
    category: string;
    category_id: string | null;
    quantity: number;
    active: boolean;
    backup_equipment_id: string | null;
    backup_name: string;
    open_reservations: number;
    reserved_quantity: number;
  }>();
  if (!row) throw new AppError("That asset was not found.", 404);

  const reservations = await db.prepare(
    `SELECT r.id, r.event_id, e.name AS event_name, r.quantity, r.starts_at, r.ends_at,
            r.canceled_at, r.checked_out_at, r.returned_at, r.maintenance_notes, r.damage_notes
     FROM equipment_reservations r
     JOIN events e ON e.id = r.event_id
     WHERE r.equipment_id = ?
     ORDER BY r.canceled_at NULLS FIRST, r.returned_at NULLS FIRST, e.event_date NULLS LAST, e.name
     LIMIT 80`,
  ).bind(equipmentId).all<{
    id: string;
    event_id: string;
    event_name: string;
    quantity: number;
    starts_at: string | null;
    ends_at: string | null;
    canceled_at: string | null;
    checked_out_at: string | null;
    returned_at: string | null;
    maintenance_notes: string;
    damage_notes: string;
  }>();

  const packing = await db.prepare(
    `SELECT p.id, p.reservation_id, p.label, p.packed
     FROM packing_items p
     JOIN equipment_reservations r ON r.id = p.reservation_id
     WHERE r.equipment_id = ?
     ORDER BY p.created_at`,
  ).bind(equipmentId).all<{ id: string; reservation_id: string; label: string; packed: boolean }>();

  const packingByReservation = new Map<string, { id: string; label: string; packed: boolean }[]>();
  for (const item of packing.results) {
    const list = packingByReservation.get(item.reservation_id) ?? [];
    list.push({ id: item.id, label: item.label, packed: Boolean(item.packed) });
    packingByReservation.set(item.reservation_id, list);
  }

  const mapped = reservations.results.map((item) => {
    let status: "canceled" | "returned" | "out" | "reserved" = "reserved";
    if (item.canceled_at) status = "canceled";
    else if (item.returned_at) status = "returned";
    else if (item.checked_out_at) status = "out";
    return {
      id: item.id,
      eventId: item.event_id,
      eventName: item.event_name,
      quantity: item.quantity,
      startsAt: item.starts_at,
      endsAt: item.ends_at,
      canceledAt: item.canceled_at,
      checkedOutAt: item.checked_out_at,
      returnedAt: item.returned_at,
      maintenanceNotes: item.maintenance_notes || "",
      damageNotes: item.damage_notes || "",
      href: `/admin/planner/${item.event_id}?room=equipment`,
      packing: packingByReservation.get(item.id) ?? [],
      status,
    };
  });

  const reservedQuantity = Number(row.reserved_quantity);
  const quantity = Number(row.quantity);
  return {
    id: row.id,
    name: row.name,
    category: row.category || "",
    categoryId: row.category_id,
    quantity,
    active: row.active !== false,
    backupEquipmentId: row.backup_equipment_id,
    backupName: row.backup_name || "",
    openReservations: Number(row.open_reservations),
    reservedQuantity,
    availableHint: Math.max(0, quantity - reservedQuantity),
    canWrite: can(role, "equipment.write"),
    reservations: mapped,
    packingSummary: {
      total: packing.results.length,
      packed: packing.results.filter((item) => item.packed).length,
    },
  };
}
