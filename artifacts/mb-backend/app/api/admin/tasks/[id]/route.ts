import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";
import { updateWorkspaceTask } from "@/lib/workspace-tasks";

const patchSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  done: z.boolean().optional(),
  clientVisible: z.boolean().optional(),
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "tasks.write");
    const { id } = await params;
    const body = parseInput(patchSchema, await readJson(request));
    await updateWorkspaceTask(id, body, actor);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
