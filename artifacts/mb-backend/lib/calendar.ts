import { audit } from "@/lib/audit";
import { assertEventDateAvailable } from "@/lib/availability";
import { getBusinessSettings, ownerAccountEmail } from "@/lib/business-settings";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getSalesWorkflow, type SalesWorkflow } from "@/lib/sales-workflow";

// Company calendar. Confirmation follows business settings. A date with no event is not a booking
// and is not reported as free. Overlaps are the same person or the same equipment, including
// setup, breakdown, and a travel buffer only when one was entered.

export const bookingStatuses = ["tentative", "confirmed", "canceled", "completed"] as const;
export type BookingStatus = (typeof bookingStatuses)[number];

export type ActorRef = { email: string; userId: string | null };

const DEFAULT_TZ = "America/New_York";

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

export function mapCalendarError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("staff_conflict")) throw new AppError("That person is already reserved for an overlapping time.", 409);
  if (message.includes("equipment_overbooked")) throw new AppError("That equipment is already reserved for an overlapping time.", 409);
  if (message.includes("date_taken")) throw new AppError("That calendar date is already reserved by an active hold or confirmed booking.", 409);
  if (message.includes("hold_expired")) throw new AppError("Confirming needs an unexpired hold.", 409);
  if (message.includes("window_required")) throw new AppError("Add a start and end time before confirming.", 409);
  if (message.includes("invalid_timezone")) throw new AppError("Enter a valid timezone.", 400);
  if (message.includes("booking_canceled")) throw new AppError("This booking is canceled.", 409);
  if (message.includes("booking_completed")) throw new AppError("This booking is completed.", 409);
  if (message.includes("booking_unconfirmed")) throw new AppError("Confirm the booking before marking it complete.", 409);
  if (message.includes("booking_closed")) throw new AppError("This booking can no longer be changed.", 409);
  if (message.includes("booking_not_found")) throw new AppError("Event not found.", 404);
  if (message.includes("assignment_not_found") || message.includes("reservation_not_found")) throw new AppError("That assignment was not found.", 404);
  if (message.includes("invalid_travel_buffer") || message.includes("invalid_setup") || message.includes("invalid_breakdown") || message.includes("invalid_quantity")) {
    throw new AppError("Check the times and quantities.", 400);
  }
  throw error;
}

async function call(sql: string, args: unknown[]) {
  try {
    await database().prepare(sql).bind(...args).run();
  } catch (error) {
    mapCalendarError(error);
  }
}

type Snapshot = { status: string; holdUntil: string | null; eventDate: string | null; startTime: string; endTime: string; timezone: string };

async function snapshot(eventId: string): Promise<Snapshot | null> {
  return database().prepare(
    `SELECT b.status, b.hold_until, e.event_date::text AS event_date, e.start_time, e.end_time, e.timezone
     FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.id = ?`,
  ).bind(eventId).first<{ status: string; hold_until: string | null; event_date: string | null; start_time: string; end_time: string; timezone: string }>()
    .then((row) => row && ({
      status: row.status,
      holdUntil: row.hold_until,
      eventDate: row.event_date,
      startTime: row.start_time,
      endTime: row.end_time,
      timezone: row.timezone,
    }));
}

async function record(actor: ActorRef, action: string, entity: string, eventId: string, before: unknown, after: unknown) {
  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    action,
    entity,
    subjectId: eventId,
    before,
    after,
  });
}

export type CalendarItem = {
  id: string;
  plannerId: string | null;
  name: string;
  eventType: string;
  eventDate: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  setupMinutes: number | null;
  breakdownMinutes: number | null;
  travelBufferMinutes: number;
  location: string;
  venueName: string;
  services: string[];
  customerName: string;
  coordinatorId: string | null;
  coordinatorName: string;
  bookingStatus: BookingStatus;
  holdUntil: string | null;
  holdExpired: boolean;
  confirmedAt: string | null;
  conflict: boolean;
  guestCount: string;
};

type CalendarRow = {
  id: string;
  planner_id: string | null;
  name: string;
  event_type: string;
  event_date: string | null;
  start_time: string;
  end_time: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  setup_minutes: number | null;
  breakdown_minutes: number | null;
  travel_buffer_minutes: number;
  location: string;
  venue_name: string | null;
  services: string;
  customer_name: string | null;
  coordinator_id: string | null;
  coordinator_name: string | null;
  booking_status: BookingStatus;
  hold_until: string | null;
  hold_expired: boolean;
  confirmed_at: string | null;
  conflict: boolean;
  guest_count: string;
};

function asServices(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toItem(row: CalendarRow): CalendarItem {
  return {
    id: row.id,
    plannerId: row.planner_id,
    name: row.name,
    eventType: row.event_type,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    timezone: row.timezone || DEFAULT_TZ,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    setupMinutes: row.setup_minutes,
    breakdownMinutes: row.breakdown_minutes,
    travelBufferMinutes: row.travel_buffer_minutes,
    location: row.location,
    venueName: row.venue_name || "",
    services: asServices(row.services),
    customerName: row.customer_name || "",
    coordinatorId: row.coordinator_id,
    coordinatorName: row.coordinator_name || "",
    bookingStatus: row.booking_status,
    holdUntil: row.hold_until,
    holdExpired: row.hold_expired,
    confirmedAt: row.confirmed_at,
    conflict: row.conflict,
    guestCount: row.guest_count,
  };
}

const itemSelect = `
  SELECT e.id, p.id AS planner_id, e.name, e.event_type, e.event_date::text AS event_date,
    e.start_time, e.end_time, e.timezone, e.starts_at, e.ends_at, e.setup_minutes, e.breakdown_minutes,
    e.travel_buffer_minutes, e.location, v.name AS venue_name, e.services::text AS services,
    c.name AS customer_name, e.coordinator_id, s.name AS coordinator_name,
    b.status AS booking_status, b.hold_until,
    (b.status = 'tentative' AND b.hold_until IS NOT NULL AND b.hold_until <= now()) AS hold_expired,
    b.confirmed_at, event_has_conflict(e.id) AS conflict, e.guest_count
  FROM events e
  JOIN bookings b ON b.event_id = e.id
  LEFT JOIN customers c ON c.id = e.customer_id
  LEFT JOIN staff s ON s.id = e.coordinator_id
  LEFT JOIN venues v ON v.id = e.venue_id
  LEFT JOIN planner_events p ON p.event_id = e.id
`;

export async function listCalendar(range: { from: string; to: string }) {
  const settings = await getBusinessSettings();
  const zone = settings.timezone || DEFAULT_TZ;
  const rows = await database().prepare(
    `${itemSelect}
     WHERE (e.event_date >= ?::date AND e.event_date < ?::date)
        OR (e.starts_at IS NOT NULL AND e.ends_at IS NOT NULL AND e.starts_at < (?::date::timestamp AT TIME ZONE ?) AND e.ends_at > (?::date::timestamp AT TIME ZONE ?))
     ORDER BY COALESCE(e.starts_at, e.event_date::timestamp AT TIME ZONE e.timezone), e.name
     LIMIT 500`,
  ).bind(range.from, range.to, range.to, zone, range.from, zone).all<CalendarRow>();
  return rows.results.map(toItem);
}

export async function listUpcoming(today: string) {
  const settings = await getBusinessSettings();
  const zone = settings.timezone || DEFAULT_TZ;
  const rows = await database().prepare(
    `${itemSelect}
     WHERE b.status IN ('tentative', 'confirmed')
       AND (e.event_date >= ?::date OR (e.ends_at IS NOT NULL AND e.ends_at >= (?::date::timestamp AT TIME ZONE ?)))
     ORDER BY COALESCE(e.starts_at, e.event_date::timestamp AT TIME ZONE e.timezone), e.name
     LIMIT 40`,
  ).bind(today, today, zone).all<CalendarRow>();
  return rows.results.map(toItem);
}

export type BookingDetail = CalendarItem & {
  internalNotes: string;
  assignments: { id: string; staffId: string; name: string; roleLabel: string; status: string; blocking: boolean }[];
  reservations: { id: string; equipmentId: string; name: string; quantity: number; blocking: boolean }[];
  staff: { id: string; name: string; jobTitle: string }[];
  equipment: { id: string; name: string; quantity: number }[];
  history: { id: string; action: string; fromStatus: string; toStatus: string; actorEmail: string; note: string; createdAt: string }[];
  workflow: SalesWorkflow;
};

export async function getBooking(eventId: string): Promise<BookingDetail> {
  const db = database();
  const row = await db.prepare(
    `SELECT e.id, p.id AS planner_id, e.name, e.event_type, e.event_date::text AS event_date,
      e.start_time, e.end_time, e.timezone, e.starts_at, e.ends_at, e.setup_minutes, e.breakdown_minutes,
      e.travel_buffer_minutes, e.location, v.name AS venue_name, e.services::text AS services,
      c.name AS customer_name, e.coordinator_id, s.name AS coordinator_name,
      b.status AS booking_status, b.hold_until,
      (b.status = 'tentative' AND b.hold_until IS NOT NULL AND b.hold_until <= now()) AS hold_expired,
      b.confirmed_at, event_has_conflict(e.id) AS conflict, e.guest_count, e.internal_notes
     FROM events e
     JOIN bookings b ON b.event_id = e.id
     LEFT JOIN customers c ON c.id = e.customer_id
     LEFT JOIN staff s ON s.id = e.coordinator_id
     LEFT JOIN venues v ON v.id = e.venue_id
     LEFT JOIN planner_events p ON p.event_id = e.id
     WHERE e.id = ?`,
  ).bind(eventId).first<CalendarRow & { internal_notes: string }>();
  if (!row) throw new AppError("Event not found.", 404);
  const [assignments, reservations, staff, equipment, history] = await Promise.all([
    db.prepare(
      `SELECT a.id, a.staff_id, s.name, a.role_label, a.status, a.blocking
       FROM assignments a JOIN staff s ON s.id = a.staff_id WHERE a.event_id = ? ORDER BY s.name`,
    ).bind(eventId).all<{ id: string; staff_id: string; name: string; role_label: string; status: string; blocking: boolean }>(),
    db.prepare(
      `SELECT r.id, r.equipment_id, eq.name, r.quantity, r.blocking
       FROM equipment_reservations r JOIN equipment eq ON eq.id = r.equipment_id WHERE r.event_id = ? ORDER BY eq.name`,
    ).bind(eventId).all<{ id: string; equipment_id: string; name: string; quantity: number; blocking: boolean }>(),
    db.prepare("SELECT id, name, job_title FROM staff WHERE active ORDER BY name").all<{ id: string; name: string; job_title: string }>(),
    db.prepare("SELECT id, name, quantity FROM equipment WHERE active ORDER BY name").all<{ id: string; name: string; quantity: number }>(),
    db.prepare(
      `SELECT id, action, from_status, to_status, actor_email, note, created_at
       FROM booking_history WHERE event_id = ? ORDER BY created_at DESC LIMIT 40`,
    ).bind(eventId).all<{ id: string; action: string; from_status: string; to_status: string; actor_email: string; note: string; created_at: string }>(),
  ]);
  return {
    ...toItem(row),
    internalNotes: row.internal_notes,
    assignments: assignments.results.map((item) => ({ id: item.id, staffId: item.staff_id, name: item.name, roleLabel: item.role_label, status: item.status, blocking: item.blocking })),
    reservations: reservations.results.map((item) => ({ id: item.id, equipmentId: item.equipment_id, name: item.name, quantity: item.quantity, blocking: item.blocking })),
    staff: staff.results.map((item) => ({ id: item.id, name: item.name, jobTitle: item.job_title })),
    equipment: equipment.results.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity })),
    history: history.results.map((item) => ({ id: item.id, action: item.action, fromStatus: item.from_status, toStatus: item.to_status, actorEmail: item.actor_email, note: item.note, createdAt: item.created_at })),
    workflow: await getSalesWorkflow(eventId),
  };
}

const confirmSql = "SELECT confirm_booking(?::uuid, ?, ?::uuid, ?)";
const actorArgs = (eventId: string, actor: ActorRef, note = "") => [eventId, actor.email, actor.userId, note];

async function notifyCustomerBooking(eventId: string, kind: "confirm" | "cancel" | "reschedule", detail?: { eventDate: string; startTime: string; endTime: string; note?: string }) {
  const row = await database().prepare(
    `SELECT c.email, c.name, e.event_date::text AS event_date
     FROM events e LEFT JOIN customers c ON c.id = e.customer_id WHERE e.id = ?`,
  ).bind(eventId).first<{ email: string | null; name: string | null; event_date: string | null }>();
  if (!row?.email?.includes("@")) return;
  const origin = process.env.MB_PUBLIC_ORIGIN ?? "";
  const { notifyBookingConfirmed, notifyBookingCanceled, notifyBookingRescheduled } = await import("@/lib/communications");
  if (kind === "confirm") {
    await notifyBookingConfirmed({ eventId, email: row.email, name: row.name || "there", eventDate: row.event_date, origin }).catch(() => undefined);
  } else if (kind === "cancel") {
    await notifyBookingCanceled({ eventId, email: row.email, name: row.name || "there", origin }).catch(() => undefined);
  } else if (detail) {
    await notifyBookingRescheduled({
      eventId,
      email: row.email,
      name: row.name || "there",
      eventDate: detail.eventDate,
      startTime: detail.startTime,
      endTime: detail.endTime,
      note: detail.note,
      origin,
    }).catch(() => undefined);
  }
}

export async function confirmBooking(eventId: string, actor: ActorRef, note = "") {
  const settings = await getBusinessSettings();
  const owner = ownerAccountEmail();
  if (settings.requireOwnerConfirm && (!owner || actor.email.toLowerCase() !== owner)) {
    throw new AppError("Only the owner can confirm a booking.", 403);
  }
  if (settings.requireStaffBeforeConfirm) {
    const assigned = await database().prepare(
      "SELECT id FROM assignments WHERE event_id = ? AND blocking = true LIMIT 1",
    ).bind(eventId).first<{ id: string }>();
    if (!assigned) throw new AppError("Assign staff before confirming, or leave staff optional in Settings.", 409);
  }
  await assertEventDateAvailable(eventId);
  const before = await snapshot(eventId);
  await call(confirmSql, actorArgs(eventId, actor, note));
  await record(actor, "booking_confirmed", "bookings", eventId, before, await snapshot(eventId));
  if (before?.status !== "confirmed") await notifyCustomerBooking(eventId, "confirm");
}

export async function cancelBooking(eventId: string, actor: ActorRef, note = "") {
  const before = await snapshot(eventId);
  await call("SELECT cancel_booking(?::uuid, ?, ?::uuid, ?)", actorArgs(eventId, actor, note));
  await record(actor, "booking_canceled", "bookings", eventId, before, await snapshot(eventId));
  if (before?.status !== "canceled") await notifyCustomerBooking(eventId, "cancel");
}

export async function completeBooking(eventId: string, actor: ActorRef, note = "") {
  const before = await snapshot(eventId);
  if (before && before.status !== "confirmed" && before.status !== "completed") {
    throw new AppError("Confirm the booking before marking it complete.", 409);
  }
  await call("SELECT complete_booking(?::uuid, ?, ?::uuid, ?)", actorArgs(eventId, actor, note));
  await record(actor, "booking_completed", "bookings", eventId, before, await snapshot(eventId));
  if (before?.status !== "completed") {
    const { scheduleReviewRequest, scheduleReferralRequest } = await import("@/lib/communications");
    await scheduleReviewRequest({ eventId }).catch(() => undefined);
    await scheduleReferralRequest({ eventId }).catch(() => undefined);
  }
}

export async function setBookingHold(eventId: string, actor: ActorRef, holdLocal: string | null, note = "") {
  // Hold expiration is entered per event. There is no company-wide default duration.
  if (holdLocal) await assertEventDateAvailable(eventId);
  const before = await snapshot(eventId);
  await call("SELECT set_booking_hold(?::uuid, ?, ?, ?::uuid, ?)", [eventId, holdLocal ?? "", actor.email, actor.userId, note]);
  await record(actor, "booking_hold", "bookings", eventId, before, await snapshot(eventId));
}

export async function rescheduleBooking(eventId: string, actor: ActorRef, input: {
  eventDate: string;
  startTime: string;
  endTime: string;
  timezone?: string;
  setupMinutes?: number | null;
  breakdownMinutes?: number | null;
  travelBufferMinutes?: number;
  note?: string;
}) {
  await assertEventDateAvailable(eventId, input.eventDate);
  const before = await snapshot(eventId);
  const db = database();
  const settings = await getBusinessSettings();
  const timezone = input.timezone || settings.timezone || DEFAULT_TZ;
  try {
    await db.batch([
      db.prepare(
        "SELECT reschedule_event(?::uuid, ?::date, ?, ?, ?, ?::int, ?::int, ?::int, ?, ?::uuid, ?)",
      ).bind(
        eventId,
        input.eventDate,
        input.startTime,
        input.endTime,
        timezone,
        input.setupMinutes ?? null,
        input.breakdownMinutes ?? null,
        input.travelBufferMinutes ?? 0,
        actor.email,
        actor.userId,
        input.note ?? "",
      ),
      db.prepare(
        `UPDATE planner_events SET data = jsonb_set(
           jsonb_set(jsonb_set(data, '{details,eventDate}', to_jsonb(?::text), true), '{details,startTime}', to_jsonb(?::text), true),
           '{details,endTime}', to_jsonb(?::text), true), updated_at = now()
         WHERE event_id = ?`,
      ).bind(input.eventDate, input.startTime, input.endTime, eventId),
    ]);
  } catch (error) {
    mapCalendarError(error);
  }
  await record(actor, "booking_rescheduled", "bookings", eventId, before, await snapshot(eventId));
  const moved = !before || before.eventDate !== input.eventDate || before.startTime !== input.startTime || before.endTime !== input.endTime;
  if (moved) {
    await notifyCustomerBooking(eventId, "reschedule", {
      eventDate: input.eventDate,
      startTime: input.startTime,
      endTime: input.endTime,
      note: input.note,
    });
  }
}

export async function assignStaff(eventId: string, actor: ActorRef, staffId: string, roleLabel = "") {
  const before = await snapshot(eventId);
  await call("SELECT assign_event_staff(?::uuid, ?::uuid, ?::uuid, ?, ?, ?::uuid)", [crypto.randomUUID(), eventId, staffId, roleLabel, actor.email, actor.userId]);
  await record(actor, "booking_assigned", "assignments", eventId, before, { staffId, roleLabel });
}

export async function releaseStaff(eventId: string, actor: ActorRef, assignmentId: string) {
  const before = await snapshot(eventId);
  await call("SELECT release_event_staff(?::uuid, ?::uuid, ?, ?::uuid)", [assignmentId, eventId, actor.email, actor.userId]);
  await record(actor, "booking_assigned", "assignments", eventId, before, { assignmentId, released: true });
}

export async function reserveEquipment(eventId: string, actor: ActorRef, equipmentId: string, quantity: number) {
  const before = await snapshot(eventId);
  await call("SELECT reserve_event_equipment(?::uuid, ?::uuid, ?::uuid, ?::int, ?, ?::uuid)", [crypto.randomUUID(), eventId, equipmentId, quantity, actor.email, actor.userId]);
  await record(actor, "booking_assigned", "equipment_reservations", eventId, before, { equipmentId, quantity });
}

export async function releaseEquipment(eventId: string, actor: ActorRef, reservationId: string) {
  const before = await snapshot(eventId);
  await call("SELECT release_event_equipment(?::uuid, ?::uuid, ?, ?::uuid)", [reservationId, eventId, actor.email, actor.userId]);
  await record(actor, "booking_assigned", "equipment_reservations", eventId, before, { reservationId, released: true });
}

export async function saveBookingNotes(eventId: string, actor: ActorRef, internalNotes: string) {
  const before = await snapshot(eventId);
  await call("UPDATE events SET internal_notes = ? WHERE id = ?", [internalNotes, eventId]);
  await record(actor, "booking_notes", "events", eventId, before, { internalNotes });
}

export async function saveBookingServices(eventId: string, services: string[]) {
  await call("UPDATE events SET services = ?::jsonb WHERE id = ?", [JSON.stringify(services), eventId]);
}

export async function saveCoordinator(eventId: string, actor: ActorRef, coordinatorId: string | null) {
  const before = await snapshot(eventId);
  if (coordinatorId) {
    const staff = await database().prepare("SELECT id FROM staff WHERE id = ?").bind(coordinatorId).first<{ id: string }>();
    if (!staff) throw new AppError("Choose a staff member.", 400);
  }
  await call("UPDATE events SET coordinator_id = ? WHERE id = ?", [coordinatorId, eventId]);
  await record(actor, "booking_assigned", "events", eventId, before, { coordinatorId });
}

export async function saveLocation(eventId: string, location: string) {
  await call("UPDATE events SET location = ? WHERE id = ?", [location, eventId]);
}

export function todayInNewYork(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
