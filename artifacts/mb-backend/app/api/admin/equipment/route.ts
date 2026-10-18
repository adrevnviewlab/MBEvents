import { requireActor } from "@/lib/admin";
import { fail, PlannerError, readJson } from "@/lib/planner-server";
import { listEquipmentCatalog } from "@/lib/office-desk";
import { addEquipmentAsset, addEquipmentCategory } from "@/lib/operations";

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "equipment.read");
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json(await listEquipmentCatalog(actor.role, q), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "equipment.write");
    const body = (await readJson(request)) as Record<string, unknown>;
    const action = text(body.action);
    if (action === "category") {
      await addEquipmentCategory({ actorRole: actor.role, name: text(body.name) });
    } else if (action === "asset") {
      await addEquipmentAsset({
        actorRole: actor.role,
        name: text(body.name),
        categoryId: text(body.categoryId) || null,
        quantity: Number(body.quantity),
        backupEquipmentId: text(body.backupEquipmentId) || null,
      });
    } else {
      throw new PlannerError("Unknown action.");
    }
    return Response.json(await listEquipmentCatalog(actor.role), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
