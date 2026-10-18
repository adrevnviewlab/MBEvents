import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { automationKinds, createTemplate, listRuns, listTemplates, processDueRuns } from "@/lib/automations";
import { clientIp } from "@/lib/request-origin";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({
  kind: z.enum(automationKinds),
  channel: z.enum(["email", "sms"]),
  delayMinutes: z.number().int().min(0).max(527040).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
  active: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    await requireActor(request, "automations.read");
    return Response.json({ templates: await listTemplates(), runs: await listRuns() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "automations.write");
    const input = parseInput(schema, await readJson(request));
    const template = await createTemplate(input, { email: actor.email, userId: actor.userId, ip: clientIp(request) });
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireActor(request, "automations.write");
    return Response.json(await processDueRuns());
  } catch (error) {
    return fail(error);
  }
}
