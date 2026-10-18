import type { Database } from "@/lib/env";
import { AppError } from "@/lib/errors";

// Assignment overlap is the calendar rule: event_block_bounds, including setup,
// breakdown, and travel buffer, for the same person on a blocking booking.
// Call assert_event_resources. Do not compare assignment rows with a second window.

export function schedulingError(error: unknown): never {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  if (text.includes("staff_conflict")) throw new AppError("That person is already booked during those hours.", 409);
  if (text.includes("staff_unavailable")) throw new AppError("That person is marked unavailable during those hours.", 409);
  if (text.includes("staff_not_found")) throw new AppError("That staff member was not found.", 404);
  if (text.includes("equipment_overbooked")) throw new AppError("That equipment is already reserved for those hours.", 409);
  throw error;
}

export async function assertStaffAssignmentAvailable(db: Database, eventId: string, staffId?: string) {
  try {
    if (staffId) await db.prepare("SELECT assert_staff_not_blocked(?, ?)").bind(staffId, eventId).run();
    await db.prepare("SELECT assert_event_resources(?, false)").bind(eventId).run();
  } catch (error) {
    schedulingError(error);
  }
}
