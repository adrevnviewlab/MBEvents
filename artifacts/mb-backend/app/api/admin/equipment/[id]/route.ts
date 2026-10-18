import { requireActor } from "@/lib/admin";
import { equipmentAssetProfile } from "@/lib/crew";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const actor = await requireActor(request, "equipment.read");
    const { id } = await params;
    return Response.json({ asset: await equipmentAssetProfile(actor.role, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
