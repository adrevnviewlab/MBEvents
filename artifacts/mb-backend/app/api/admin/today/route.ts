import { requireActor } from "@/lib/admin";
import { fail } from "@/lib/planner-server";
import { buildTodayBoard } from "@/lib/today";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "office.access");
    return Response.json(await buildTodayBoard(actor.role), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
