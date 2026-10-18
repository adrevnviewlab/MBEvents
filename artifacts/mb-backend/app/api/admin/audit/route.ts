import { requireActor } from "@/lib/admin";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { fail } from "@/lib/planner-server";

export async function GET(request: Request) {
  try {
    await requireActor(request, "audit.read");
    if (!env.DB) throw new AppError("The database is not configured.", 503);
    const limitRaw = Number(new URL(request.url).searchParams.get("limit") ?? "80");
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 80;
    const rows = await env.DB.prepare(
      `SELECT id, created_at::text AS created_at, actor_email, action, entity, subject_id, ip
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT ?`,
    ).bind(limit).all<{
      id: string;
      created_at: string;
      actor_email: string;
      action: string;
      entity: string;
      subject_id: string;
      ip: string;
    }>();
    return Response.json({
      entries: rows.results.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        actorEmail: row.actor_email,
        action: row.action,
        entity: row.entity,
        subjectId: row.subject_id,
        ip: row.ip || "",
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
