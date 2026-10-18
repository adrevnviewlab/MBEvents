import { requireActor } from "@/lib/admin";
import { fail } from "@/lib/planner-server";
import { listCustomers } from "@/lib/office-desk";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "customers.read");
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ customers: await listCustomers(actor.role, q) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
