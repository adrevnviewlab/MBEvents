import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { addLeadTask, setLeadTaskDone } from "@/lib/crm";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const createSchema = z.object({
  title: z.string().trim().min(2).max(200),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Add a due date."),
  assigneeId: z.string().uuid().nullable().optional(),
}).strict();

const updateSchema = z.object({
  taskId: z.string().uuid(),
  done: z.boolean(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "tasks.write");
    const { id } = await params;
    const body = parseInput(createSchema, await readJson(request));
    const created = await addLeadTask(id, body, actor);
    return Response.json({ ok: true, id: created.id }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "tasks.write");
    const { id } = await params;
    const body = parseInput(updateSchema, await readJson(request));
    await setLeadTaskDone(id, body.taskId, body.done, actor);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
