import { z } from "zod";
import { leadStages, requireAdmin } from "@/lib/admin";
import { db, fail, PlannerError, readJson } from "@/lib/planner-server";

const schema = z.object({ stage: z.enum(leadStages), notes: z.string().max(5000) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const email = await requireAdmin(request);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new PlannerError("Invalid lead.");
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Invalid details.");
    const previous = await db().prepare("SELECT stage, notes FROM leads WHERE id = ?").bind(id).first<{ stage: string; notes: string | null }>();
    if (!previous) throw new PlannerError("Lead not found.", 404);
    await db().batch([
      db().prepare("UPDATE leads SET stage = ?, notes = ?, updated_at = now() WHERE id = ?").bind(parsed.data.stage, parsed.data.notes, id),
      db().prepare("INSERT INTO admin_audit (id, actor_email, action, subject_id, before_value, after_value) VALUES (?, ?, 'lead_updated', ?, ?, ?)")
        .bind(crypto.randomUUID(), email, id, JSON.stringify(previous), JSON.stringify(parsed.data)),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
