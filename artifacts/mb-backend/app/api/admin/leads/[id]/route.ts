import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { parseBudgetDollars, updateLead } from "@/lib/crm";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({
  stage: z.string().trim().min(1).max(80).optional(),
  notes: z.string().max(5000).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  consultationAt: z.string().max(40).nullable().optional(),
  budget: z.string().max(20).optional(),
  lostReason: z.string().max(2000).nullable().optional(),
  venueName: z.string().trim().max(200).nullable().optional(),
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "leads.write");
    const { id } = await params;
    const body = parseInput(schema, await readJson(request));
    await updateLead(id, {
      stage: body.stage,
      notes: body.notes,
      assigneeId: body.assigneeId,
      consultationAt: body.consultationAt,
      budgetCents: body.budget !== undefined ? parseBudgetDollars(body.budget) : undefined,
      lostReason: body.lostReason,
      venueName: body.venueName,
    }, actor);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
