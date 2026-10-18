import { requireActor } from "@/lib/admin";
import { createStaffPerson, listStaffRoster } from "@/lib/crew";
import { fail, PlannerError, readJson } from "@/lib/planner-server";

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
    const actor = await requireActor(request, "staff.read");
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json(await listStaffRoster(actor.role, q), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "assignments.write");
    const body = (await readJson(request)) as Record<string, unknown>;
    const rate = cents(body.rateCents);
    if (Number.isNaN(rate)) throw new PlannerError("Enter a whole amount in cents, or leave it blank.");
    const skills = Array.isArray(body.skills)
      ? body.skills.map(String)
      : String(body.skills ?? "").split(",");
    const id = await createStaffPerson({
      actorRole: actor.role,
      name: text(body.name),
      email: text(body.email),
      phone: text(body.phone),
      jobTitle: text(body.jobTitle),
      profileType: text(body.profileType) || "other",
      skills,
      rateCents: rate,
    });
    return Response.json({ id, ...(await listStaffRoster(actor.role)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
