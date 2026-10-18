import { businessTimezoneOrDefault, getBusinessSettings } from "@/lib/business-settings";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

// Single authoritative date check for the office and the public site.
// A date is reserved only by a confirmed booking or a tentative booking with a future hold.
// Leads never reserve a date. A public "open" result is never a guarantee.

export type DateReservationStatus = "open" | "reserved" | "unavailable";

export type DateAvailability = {
  date: string;
  status: DateReservationStatus;
  reserved: boolean;
  message: string;
  guaranteed: false;
  timezone: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

export function isValidEventDate(value: string) {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export async function todayInBusinessTimezone(timezone?: string) {
  const zone = timezone || (await businessTimezoneOrDefault());
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function dateIsReserved(date: string, excludeEventId?: string | null) {
  if (!isValidEventDate(date)) throw new AppError("Enter a valid event date.", 400);
  if (!env.DB) return false;
  const row = excludeEventId
    ? await database().prepare("SELECT date_is_blocked(?::date, ?::uuid) AS blocked").bind(date, excludeEventId).first<{ blocked: boolean }>()
    : await database().prepare("SELECT date_is_blocked(?::date, NULL) AS blocked").bind(date).first<{ blocked: boolean }>();
  return Boolean(row?.blocked);
}

function publicMessage(status: DateReservationStatus, date: string) {
  if (status === "unavailable") {
    return "That date is in the past. Choose a future date, or leave an inquiry and we will help find another night.";
  }
  if (status === "reserved") {
    return `${date} is already reserved on our calendar. You can still leave an inquiry — a specialist will follow up about other dates. A date is never guaranteed until MB Events confirms a booking.`;
  }
  return `${date} looks open on our calendar right now. It is not reserved until MB Events confirms a booking. Leaving an inquiry does not hold the date.`;
}

export async function getDateAvailability(date: string): Promise<DateAvailability> {
  const settings = await getBusinessSettings();
  const timezone = settings.timezone || (await businessTimezoneOrDefault());
  if (!isValidEventDate(date)) {
    return {
      date,
      status: "unavailable",
      reserved: false,
      message: "Enter a valid event date.",
      guaranteed: false,
      timezone,
    };
  }
  const today = await todayInBusinessTimezone(timezone);
  if (date < today) {
    return { date, status: "unavailable", reserved: false, message: publicMessage("unavailable", date), guaranteed: false, timezone };
  }
  const reserved = await dateIsReserved(date);
  const status: DateReservationStatus = reserved ? "reserved" : "open";
  return { date, status, reserved, message: publicMessage(status, date), guaranteed: false, timezone };
}

// App-level guard that mirrors the SQL date_is_blocked / raise_if_date_taken rule.
export async function assertEventDateAvailable(eventId: string, eventDate?: string | null) {
  const row = await database().prepare("SELECT event_date::text AS event_date FROM events WHERE id = ?").bind(eventId).first<{ event_date: string | null }>();
  const date = eventDate ?? row?.event_date ?? null;
  if (!date) return;
  if (!isValidEventDate(date)) throw new AppError("Enter a valid event date.", 400);
  if (await dateIsReserved(date, eventId)) {
    throw new AppError("That calendar date is already reserved by an active hold or confirmed booking.", 409);
  }
}
