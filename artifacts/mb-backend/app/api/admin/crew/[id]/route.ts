import { requireActor } from "@/lib/admin";
import { saveStaffPerson, staffProfile } from "@/lib/crew";
import { addStaffBlock, removeStaffBlock, updateStaffRecord } from "@/lib/operations";
import { fail, PlannerError, readJson } from "@/lib/planner-server";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function cents(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : Number.NaN;
}

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const actor = await requireActor(request, "staff.read");
    const { id } = await params;
    return Response.json({ person: await staffProfile(actor.role, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await requireActor(request, "assignments.write");
    const { id } = await params;
    const body = (await readJson(request)) as Record<string, unknown>;
    const action = text(body.action) || "save";
    if (action === "block") {
      await addStaffBlock({
        actorRole: actor.role,
        actorUserId: actor.userId ?? "",
        staffId: id,
        startsAt: text(body.startsAt),
        endsAt: text(body.endsAt),
        note: text(body.note),
      });
    } else if (action === "removeBlock") {
      await removeStaffBlock({
        actorRole: actor.role,
        actorUserId: actor.userId ?? "",
        blockId: text(body.blockId),
      });
    } else if (action === "profile") {
      const rate = body.rateCents === undefined ? undefined : cents(body.rateCents);
      if (Number.isNaN(rate)) throw new PlannerError("Enter a whole amount in cents, or leave it blank.");
      const skills = Array.isArray(body.skills)
        ? body.skills.map(String)
        : String(body.skills ?? "").split(",");
      await updateStaffRecord({
        actorRole: actor.role,
        staffId: id,
        profileType: text(body.profileType) || "other",
        skills,
        rateCents: rate,
      });
    } else {
      const rate = body.rateCents === undefined ? undefined : cents(body.rateCents);
      if (Number.isNaN(rate)) throw new PlannerError("Enter a whole amount in cents, or leave it blank.");
      const skills = Array.isArray(body.skills)
        ? body.skills.map(String)
        : String(body.skills ?? "").split(",");
      await saveStaffPerson({
        actorRole: actor.role,
        staffId: id,
        name: text(body.name),
        email: text(body.email),
        phone: text(body.phone),
        jobTitle: text(body.jobTitle),
        profileType: text(body.profileType) || "other",
        skills,
        active: body.active === undefined ? true : Boolean(body.active),
        rateCents: rate,
      });
    }
    return Response.json({ person: await staffProfile(actor.role, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
