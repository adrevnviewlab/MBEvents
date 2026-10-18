import { requireActor } from "@/lib/admin";
import { clientIp } from "@/lib/request-origin";
import { fail, PlannerError, readJson } from "@/lib/planner-server";
import {
  addChecklistItem,
  addEquipmentAsset,
  addEquipmentCategory,
  addPackingItem,
  addRequirement,
  addStaffBlock,
  cancelEquipmentReservation,
  confirmEquipmentCheckout,
  confirmEquipmentReturn,
  createAssignment,
  fileIncident,
  linkVendor,
  officeEvent,
  reserveEquipment,
  saveEventOps,
  saveReservationNotes,
  setChecklistAssignee,
  setChecklistDone,
  setPacked,
  setRequirementMet,
  updateStaffRecord,
} from "@/lib/operations";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function cents(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : Number.NaN;
}

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "events.read");
    const eventId = new URL(request.url).searchParams.get("eventId") ?? "";
    if (!eventId) throw new PlannerError("Missing event.");
    return Response.json(await officeEvent(eventId, actor.role), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "events.read");
    const body = (await readJson(request)) as Record<string, unknown>;
    const eventId = text(body.eventId);
    const action = text(body.action);
    if (!eventId) throw new PlannerError("Missing event.");
    if (action === "event") {
      await saveEventOps({
        actorRole: actor.role,
        eventId,
        loadInInstructions: text(body.loadInInstructions),
        setupSchedule: text(body.setupSchedule),
        breakdownSchedule: text(body.breakdownSchedule),
        internalNotes: text(body.internalNotes),
      });
    } else if (action === "checklist") {
      await addChecklistItem({
        actorRole: actor.role,
        eventId,
        title: text(body.title),
        assigneeId: typeof body.assigneeId === "string" && body.assigneeId ? body.assigneeId : null,
      });
    } else if (action === "checklistDone") {
      await setChecklistDone({
        actorRole: actor.role,
        actorUserId: actor.userId ?? "",
        itemId: text(body.itemId),
        done: Boolean(body.done),
      });
    } else if (action === "checklistAssign") {
      await setChecklistAssignee({
        actorRole: actor.role,
        itemId: text(body.itemId),
        assigneeId: typeof body.assigneeId === "string" && body.assigneeId ? body.assigneeId : null,
      });
    } else if (action === "requirement") {
      await addRequirement({ actorRole: actor.role, actorEmail: actor.email, actorUserId: actor.userId, eventId, label: text(body.label), ip: clientIp(request) });
    } else if (action === "requirementMet") {
      await setRequirementMet({
        actorRole: actor.role,
        actorEmail: actor.email,
        actorUserId: actor.userId,
        requirementId: text(body.requirementId),
        met: Boolean(body.met),
        ip: clientIp(request),
      });
    } else if (action === "assign") {
      const payout = cents(body.payoutCents);
      if (Number.isNaN(payout)) throw new PlannerError("Enter a whole amount in cents, or leave it blank.");
      await createAssignment({
        actorRole: actor.role,
        eventId,
        staffId: text(body.staffId),
        roleLabel: text(body.roleLabel),
        callTime: text(body.callTime),
        startsAt: text(body.startsAt) || null,
        endsAt: text(body.endsAt) || null,
        payoutCents: payout,
        internalNotes: text(body.internalNotes),
      });
    } else if (action === "profile") {
      const rate = body.rateCents === undefined ? undefined : cents(body.rateCents);
      if (Number.isNaN(rate)) throw new PlannerError("Enter a whole amount in cents, or leave it blank.");
      await updateStaffRecord({
        actorRole: actor.role,
        staffId: text(body.staffId),
        profileType: text(body.profileType),
        skills: Array.isArray(body.skills) ? body.skills.map(String) : String(body.skills ?? "").split(","),
        rateCents: rate,
      });
    } else if (action === "block") {
      await addStaffBlock({
        actorRole: actor.role,
        actorUserId: actor.userId ?? "",
        staffId: text(body.staffId),
        startsAt: text(body.startsAt),
        endsAt: text(body.endsAt),
        note: text(body.note),
      });
    } else if (action === "category") {
      await addEquipmentCategory({ actorRole: actor.role, name: text(body.name) });
    } else if (action === "asset") {
      const quantity = Number(body.quantity);
      await addEquipmentAsset({
        actorRole: actor.role,
        name: text(body.name),
        categoryId: text(body.categoryId) || null,
        quantity,
        backupEquipmentId: text(body.backupEquipmentId) || null,
      });
    } else if (action === "reserve") {
      await reserveEquipment({
        actorRole: actor.role,
        equipmentId: text(body.equipmentId),
        eventId,
        quantity: Number(body.quantity),
        startsAt: text(body.startsAt) || null,
        endsAt: text(body.endsAt) || null,
      });
    } else if (action === "packing") {
      await addPackingItem({ actorRole: actor.role, reservationId: text(body.reservationId), label: text(body.label) });
    } else if (action === "packed") {
      await setPacked({
        actorRole: actor.role,
        actorUserId: actor.userId ?? "",
        itemId: text(body.itemId),
        packed: Boolean(body.packed),
      });
    } else if (action === "reservationNotes") {
      await saveReservationNotes({
        actorRole: actor.role,
        reservationId: text(body.reservationId),
        maintenanceNotes: text(body.maintenanceNotes),
        damageNotes: text(body.damageNotes),
      });
    } else if (action === "checkout") {
      await confirmEquipmentCheckout({
        actorRole: actor.role,
        actorUserId: actor.userId ?? "",
        actorEmail: actor.email,
        reservationId: text(body.reservationId),
        ip: clientIp(request),
      });
    } else if (action === "return") {
      await confirmEquipmentReturn({
        actorRole: actor.role,
        actorUserId: actor.userId ?? "",
        actorEmail: actor.email,
        reservationId: text(body.reservationId),
        ip: clientIp(request),
      });
    } else if (action === "cancelReservation") {
      await cancelEquipmentReservation({ actorRole: actor.role, reservationId: text(body.reservationId) });
    } else if (action === "vendor") {
      await linkVendor({ actorRole: actor.role, eventId, vendorId: text(body.vendorId) });
    } else if (action === "incident") {
      await fileIncident({
        actorRole: actor.role,
        actorUserId: actor.userId ?? "",
        actorEmail: actor.email,
        eventId,
        body: text(body.body),
        ip: clientIp(request),
      });
    } else {
      throw new PlannerError("Unknown action.");
    }
    return Response.json(await officeEvent(eventId, actor.role));
  } catch (error) {
    return fail(error);
  }
}
