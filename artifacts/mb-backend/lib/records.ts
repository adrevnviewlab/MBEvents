import { assertEventDateAvailable } from "@/lib/availability";
import { getBusinessSettings } from "@/lib/business-settings";
import { mapCalendarError } from "@/lib/calendar";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function cleanEmail(value: string | null | undefined) {
  const email = (value ?? "").trim().toLowerCase();
  return email.includes("@") ? email : "";
}

// One customer per email. Phone-only inquiries stay separate so strangers are not merged.
export async function ensureCustomer(input: { name: string; email?: string | null; phone?: string | null }) {
  const db = database();
  const email = cleanEmail(input.email);
  const name = input.name.trim().slice(0, 200) || "Client";
  const phone = (input.phone ?? "").trim().slice(0, 40);
  if (email) {
    const row = await db.prepare(
      `INSERT INTO customers (id, name, email, phone) VALUES (?, ?, ?, ?)
       ON CONFLICT (email) WHERE email <> '' DO UPDATE SET updated_at = customers.updated_at
       RETURNING id`,
    ).bind(crypto.randomUUID(), name, email, phone).first<{ id: string }>();
    if (!row) throw new AppError("Could not save the customer.", 500);
    return row.id;
  }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO customers (id, name, email, phone) VALUES (?, ?, '', ?)").bind(id, name, phone).run();
  return id;
}

// Unconfirmed booking. The original check allows "pending". A later calendar migration
// renamed that state to "tentative" and no longer accepts "pending".
async function unconfirmedBookingStatus() {
  const row = await database().prepare(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'bookings_status_check'",
  ).first<{ def: string }>();
  const def = row?.def ?? "";
  if (def.includes("'pending'")) return "pending";
  if (def.includes("'tentative'")) return "tentative";
  return "pending";
}

export async function createEventRecord(input: {
  id: string;
  customerId: string;
  leadId?: string | null;
  name: string;
  eventType: string;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  guestCount?: string | null;
  location?: string | null;
}) {
  const db = database();
  const eventDate = input.eventDate && datePattern.test(input.eventDate) ? input.eventDate : null;
  const bookingId = crypto.randomUUID();
  const bookingStatus = await unconfirmedBookingStatus();
  const settings = await getBusinessSettings();
  const timezone = settings.timezone || "America/New_York";
  await db.batch([
    db.prepare(
      `INSERT INTO events (id, customer_id, lead_id, name, event_type, event_date, start_time, end_time, guest_count, location, timezone, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planning')`,
    ).bind(
      input.id,
      input.customerId,
      input.leadId || null,
      input.name.slice(0, 200),
      input.eventType.slice(0, 80),
      eventDate,
      (input.startTime ?? "").slice(0, 40),
      (input.endTime ?? "").slice(0, 40),
      (input.guestCount ?? "").slice(0, 40),
      (input.location ?? "").slice(0, 200),
      timezone,
    ),
    db.prepare("INSERT INTO bookings (id, event_id, status) VALUES (?, ?, ?)").bind(bookingId, input.id, bookingStatus),
  ]);
  // Creating a tentative event without a hold does not reserve the date.
  // Date capacity is checked when a hold is placed or the booking is confirmed.
  return { eventId: input.id, bookingId, bookingStatus };
}

type DetailSync = {
  clientNames?: string;
  email?: string;
  phone?: string;
  eventType?: string;
  eventDate?: string;
  startTime?: string;
  endTime?: string;
  guestCount?: string;
  venueName?: string;
};

// Keeps the occasion row aligned with the planner document. Does not create a second event.
export async function syncEventDetails(eventId: string, details: DetailSync) {
  const db = database();
  const event = await db.prepare("SELECT customer_id FROM events WHERE id = ?").bind(eventId).first<{ customer_id: string | null }>();
  if (!event) return;
  const email = cleanEmail(details.email);
  let customerId = event.customer_id;
  if (email) {
    const existing = await db.prepare("SELECT id FROM customers WHERE email = ?").bind(email).first<{ id: string }>();
    if (existing) customerId = existing.id;
    else if (customerId) {
      await db.prepare("UPDATE customers SET name = ?, email = ?, phone = ? WHERE id = ? AND email = ''")
        .bind((details.clientNames ?? "").slice(0, 200), email, (details.phone ?? "").slice(0, 40), customerId).run();
    }
  } else if (customerId && details.clientNames) {
    await db.prepare("UPDATE customers SET name = ?, phone = ? WHERE id = ?").bind(details.clientNames.slice(0, 200), (details.phone ?? "").slice(0, 40), customerId).run();
  }
  const eventDate = details.eventDate && datePattern.test(details.eventDate) ? details.eventDate : null;
  if (eventDate) {
    const booking = await db.prepare(
      "SELECT status, hold_until FROM bookings WHERE event_id = ?",
    ).bind(eventId).first<{ status: string; hold_until: string | null }>();
    const blocks = booking?.status === "confirmed"
      || (booking?.status === "tentative" && booking.hold_until && new Date(booking.hold_until).getTime() > Date.now());
    if (blocks) await assertEventDateAvailable(eventId, eventDate);
  }
  const venue = (details.venueName ?? "").slice(0, 200);
  try {
    await db.prepare(
      `UPDATE events SET customer_id = ?, name = ?, event_type = ?, event_date = ?, start_time = ?, end_time = ?, guest_count = ?,
         location = CASE WHEN ? <> '' THEN ? ELSE location END, updated_at = now()
       WHERE id = ?`,
    ).bind(
      customerId,
      (details.clientNames ?? "").slice(0, 200),
      (details.eventType ?? "").slice(0, 80),
      eventDate,
      (details.startTime ?? "").slice(0, 40),
      (details.endTime ?? "").slice(0, 40),
      (details.guestCount ?? "").slice(0, 40),
      venue,
      venue,
      eventId,
    ).run();
  } catch (error) {
    mapCalendarError(error);
  }
}
