import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { can } from "@/lib/authz";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";
import {
  createWorkspaceTask,
  listEventOptions,
  listWorkspaceTasks,
  type TaskFilters,
} from "@/lib/workspace-tasks";

const createSchema = z.object({
  title: z.string().trim().min(2).max(200),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  leadId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
  clientVisible: z.boolean().optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "tasks.read");
    const url = new URL(request.url);
    const filters: TaskFilters = {
      assigneeId: url.searchParams.get("assignee") || undefined,
      eventId: url.searchParams.get("event") || undefined,
      leadId: url.searchParams.get("lead") || undefined,
      deadline: (url.searchParams.get("deadline") as TaskFilters["deadline"]) || "all",
      status: (url.searchParams.get("status") as TaskFilters["status"]) || "open",
      q: url.searchParams.get("q") || undefined,
      limit: Number(url.searchParams.get("limit") || 200) || 200,
    };
    const [board, events] = await Promise.all([
      listWorkspaceTasks(actor.role, filters),
      listEventOptions(actor.role),
    ]);
    return Response.json({
      ...board,
      events,
      canWrite: can(actor.role, "tasks.write"),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "tasks.write");
    const body = parseInput(createSchema, await readJson(request));
    const created = await createWorkspaceTask(body, actor);
    return Response.json({ ok: true, id: created.id }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
