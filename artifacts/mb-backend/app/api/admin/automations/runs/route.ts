import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { scheduleAutomation } from "@/lib/automations";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({
  templateId: z.string().uuid(),
  entityType: z.enum(["lead", "event", "guest"]),
  entityId: z.string().uuid(),
  occurrence: z.string().max(120).optional(),
});

export async function POST(request: Request) {
  try {
    await requireActor(request, "automations.write");
    const input = parseInput(schema, await readJson(request));
    const run = await scheduleAutomation(input);
    return Response.json({ run }, { status: run.created ? 201 : 200 });
  } catch (error) {
    return fail(error);
  }
}
