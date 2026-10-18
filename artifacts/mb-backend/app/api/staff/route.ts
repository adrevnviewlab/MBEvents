import { requireEventsActor } from "@/lib/admin";
import { clientIp } from "@/lib/request-origin";
import { fail, PlannerError, readJson } from "@/lib/planner-server";
import {
  addStaffBlock,
  fileIncident,
  removeStaffBlock,
  respondToAssignment,
  setChecklistDone,
  setPacked,
  staffBrief,
  updateOwnProfile,
} from "@/lib/operations";

export async function GET(request: Request) {
  try {
    const actor = await requireEventsActor(request);
    if (!actor.userId) throw new PlannerError("This login is not linked to a person.", 403);
    return Response.json(await staffBrief(actor.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireEventsActor(request);
    if (!actor.userId) throw new PlannerError("This login is not linked to a person.", 403);
    const body = (await readJson(request)) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const brief = await staffBrief(actor.userId);
    const staffId = brief.profile?.id;
    if (!staffId) throw new PlannerError("No staff profile is linked to this login.", 403);
    if (action === "profile") {
      await updateOwnProfile(actor.userId, String(body.profileType ?? ""), Array.isArray(body.skills) ? body.skills.map(String) : []);
    } else if (action === "block") {
      await addStaffBlock({
        actorRole: actor.role,
        actorUserId: actor.userId,
        staffId,
        startsAt: String(body.startsAt ?? ""),
        endsAt: String(body.endsAt ?? ""),
        note: String(body.note ?? ""),
      });
    } else if (action === "removeBlock") {
      await removeStaffBlock({ actorRole: actor.role, actorUserId: actor.userId, blockId: String(body.blockId ?? "") });
    } else if (action === "respond") {
      const decision = body.decision === "decline" ? "decline" : body.decision === "accept" ? "accept" : "";
      if (!decision) throw new PlannerError("Choose accept or decline.");
      await respondToAssignment({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        assignmentId: String(body.assignmentId ?? ""),
        decision,
        ip: clientIp(request),
      });
    } else if (action === "incident") {
      await fileIncident({
        actorRole: actor.role,
        actorUserId: actor.userId,
        actorEmail: actor.email,
        eventId: String(body.eventId ?? ""),
        body: String(body.body ?? ""),
        ip: clientIp(request),
      });
    } else if (action === "checklist") {
      await setChecklistDone({ actorRole: actor.role, actorUserId: actor.userId, itemId: String(body.itemId ?? ""), done: Boolean(body.done) });
    } else if (action === "packing") {
      await setPacked({ actorRole: actor.role, actorUserId: actor.userId, itemId: String(body.itemId ?? ""), packed: Boolean(body.packed) });
    } else {
      throw new PlannerError("Unknown action.");
    }
    return Response.json(await staffBrief(actor.userId));
  } catch (error) {
    return fail(error);
  }
}
