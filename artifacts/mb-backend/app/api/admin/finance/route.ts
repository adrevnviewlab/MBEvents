import { requireActor } from "@/lib/admin";
import { listFinanceDesk } from "@/lib/event-budget";
import { fail } from "@/lib/planner-server";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "payments.read");
    const url = new URL(request.url);
    return Response.json(await listFinanceDesk(actor.role, {
      q: url.searchParams.get("q") ?? "",
      status: url.searchParams.get("status") ?? "",
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
