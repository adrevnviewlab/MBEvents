import { z } from "zod";
import { requireActor } from "@/lib/admin";
import {
  assignStaff,
  cancelBooking,
  completeBooking,
  confirmBooking,
  getBooking,
  releaseEquipment,
  releaseStaff,
  rescheduleBooking,
  reserveEquipment,
  saveBookingNotes,
  saveBookingServices,
  saveCoordinator,
  saveLocation,
  setBookingHold,
} from "@/lib/calendar";
import { fail, readJson } from "@/lib/planner-server";

type Params = { params: Promise<{ eventId: string }> };

function eventIdOf(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return id;
}

export async function GET(request: Request, { params }: Params) {
  try {
    await requireActor(request, "events.read");
    const eventId = eventIdOf((await params).eventId);
    if (!eventId) return Response.json({ error: "Event not found." }, { status: 404 });
    return Response.json(await getBooking(eventId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

const note = z.string().max(500).optional();
const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), note }),
  z.object({ action: z.literal("cancel"), note }),
  z.object({ action: z.literal("complete"), note }),
  z.object({ action: z.literal("hold"), holdUntil: z.string().max(40).nullable(), note }),
  z.object({
    action: z.literal("reschedule"),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().trim().min(1).max(40),
    endTime: z.string().trim().min(1).max(40),
    timezone: z.string().trim().min(1).max(64).optional(),
    setupMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
    breakdownMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
    travelBufferMinutes: z.number().int().min(0).max(24 * 60).optional(),
    note,
  }),
  z.object({ action: z.literal("assign"), staffId: z.string().uuid(), roleLabel: z.string().max(80).optional() }),
  z.object({ action: z.literal("unassign"), assignmentId: z.string().uuid() }),
  z.object({ action: z.literal("reserve"), equipmentId: z.string().uuid(), quantity: z.number().int().min(1).max(1000) }),
  z.object({ action: z.literal("release"), reservationId: z.string().uuid() }),
  z.object({ action: z.literal("notes"), internalNotes: z.string().max(4000) }),
  z.object({ action: z.literal("services"), services: z.array(z.string().trim().min(1).max(80)).max(40) }),
  z.object({ action: z.literal("coordinator"), coordinatorId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("location"), location: z.string().max(200) }),
]);

export async function PATCH(request: Request, { params }: Params) {
  try {
    const eventId = eventIdOf((await params).eventId);
    if (!eventId) return Response.json({ error: "Event not found." }, { status: 404 });
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return Response.json({ error: "Check the booking details." }, { status: 400 });
    const body = parsed.data;
    if (body.action === "confirm" || body.action === "cancel" || body.action === "complete" || body.action === "hold" || body.action === "reschedule") {
      const actor = await requireActor(request, "bookings.write");
      if (body.action === "confirm") await confirmBooking(eventId, actor, body.note);
      if (body.action === "cancel") await cancelBooking(eventId, actor, body.note);
      if (body.action === "complete") await completeBooking(eventId, actor, body.note);
      if (body.action === "hold") await setBookingHold(eventId, actor, body.holdUntil, body.note);
      if (body.action === "reschedule") await rescheduleBooking(eventId, actor, body);
    } else if (body.action === "assign" || body.action === "unassign") {
      const actor = await requireActor(request, "assignments.write");
      if (body.action === "assign") await assignStaff(eventId, actor, body.staffId, body.roleLabel ?? "");
      else await releaseStaff(eventId, actor, body.assignmentId);
    } else if (body.action === "reserve" || body.action === "release") {
      const actor = await requireActor(request, "equipment.write");
      if (body.action === "reserve") await reserveEquipment(eventId, actor, body.equipmentId, body.quantity);
      else await releaseEquipment(eventId, actor, body.reservationId);
    } else if (body.action === "coordinator") {
      const actor = await requireActor(request, "events.write");
      await saveCoordinator(eventId, actor, body.coordinatorId);
    } else {
      const actor = await requireActor(request, "events.write");
      if (body.action === "notes") await saveBookingNotes(eventId, actor, body.internalNotes);
      if (body.action === "services") await saveBookingServices(eventId, body.services);
      if (body.action === "location") await saveLocation(eventId, body.location);
    }
    return Response.json({ ok: true, booking: await getBooking(eventId) });
  } catch (error) {
    return fail(error);
  }
}
