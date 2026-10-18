import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { addStage, saveStages } from "@/lib/crm";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const addSchema = z.object({ label: z.string().trim().min(2).max(80) }).strict();
const saveSchema = z.object({
  stages: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80),
    active: z.boolean(),
  })).min(1).max(50),
}).strict();

export async function POST(request: Request) {
  try {
    await requireActor(request, "users.manage");
    const body = parseInput(addSchema, await readJson(request));
    const created = await addStage(body.label);
    return Response.json({ ok: true, ...created }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireActor(request, "users.manage");
    const body = parseInput(saveSchema, await readJson(request));
    await saveStages(body.stages);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
