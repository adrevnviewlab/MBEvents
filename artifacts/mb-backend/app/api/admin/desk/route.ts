import { requireActor } from "@/lib/admin";
import { fail } from "@/lib/planner-server";
import { buildOwnerDesk } from "@/lib/office-desk";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "office.access");
    return Response.json(await buildOwnerDesk(actor.role), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
