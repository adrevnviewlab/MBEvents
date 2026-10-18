import { requireActor } from "@/lib/admin";
import { fail } from "@/lib/planner-server";
import { buildChecklistBoard } from "@/lib/today";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "events.read");
    return Response.json(await buildChecklistBoard(actor.role), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
