import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { automationKinds, updateTemplate } from "@/lib/automations";
import { clientIp } from "@/lib/request-origin";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({
  kind: z.enum(automationKinds).optional(),
  channel: z.enum(["email", "sms"]).optional(),
  delayMinutes: z.number().int().min(0).max(527040).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "automations.write");
    const input = parseInput(schema, await readJson(request));
    const template = await updateTemplate((await params).id, input, { email: actor.email, userId: actor.userId, ip: clientIp(request) });
    return Response.json({ template });
  } catch (error) {
    return fail(error);
  }
}
