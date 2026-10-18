import { selectableVendors } from "@/lib/places";
import { fail, sessionEvent } from "@/lib/planner-server";

export async function GET(request: Request) {
  try {
    await sessionEvent(request, "client");
    return Response.json({ vendors: await selectableVendors() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
