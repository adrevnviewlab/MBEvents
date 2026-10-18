import { listLeads } from "@/lib/crm";
import { requireActor } from "@/lib/admin";
import { fail } from "@/lib/planner-server";

export async function GET(request: Request) {
  try {
    await requireActor(request, "leads.read");
    const url = new URL(request.url);
    const result = await listLeads({
      q: url.searchParams.get("q") ?? "",
      stage: url.searchParams.get("stage") ?? "",
      source: url.searchParams.get("source") ?? "",
      assignee: url.searchParams.get("assignee") ?? "",
      sort: url.searchParams.get("sort") ?? "",
      focus: url.searchParams.get("focus") ?? "",
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
