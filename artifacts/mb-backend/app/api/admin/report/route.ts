import { requireAdmin } from "@/lib/admin";
import { buildBusinessReport } from "@/lib/analytics";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { fail } from "@/lib/planner-server";

export async function GET(request: Request) {
  try {
    await requireAdmin(request, "payments.read");
    if (!env.DB) throw new AppError("The database is not configured.", 503);
    const url = new URL(request.url);
    const report = await buildBusinessReport(env.DB, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
