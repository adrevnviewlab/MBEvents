import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { updatePlanningTemplate } from "@/lib/planning-templates";
import { planningBlockIds } from "@/lib/planner";
import { fail, PlannerError, readJson } from "@/lib/planner-server";
import { clientIp } from "@/lib/request-origin";

const writeSchema = z.object({
  eventType: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  checklist: z.array(z.object({ text: z.string().max(300), due: z.string().max(200).default("") })).max(300).optional(),
  timeline: z.array(z.object({
    time: z.string().max(200).default(""),
    what: z.string().max(300),
    endTime: z.string().max(200).default("").optional(),
    kind: z.string().max(40).optional(),
  })).max(200).optional(),
  dances: z.array(z.object({ moment: z.string().max(120) })).max(40).optional(),
  blocks: z.array(z.enum(planningBlockIds)).max(20).optional(),
  published: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const email = await requireAdmin(request, "events.write");
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new PlannerError("Invalid template.", 400);
    const parsed = writeSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Check the template and try again.");
    const template = await updatePlanningTemplate(id, parsed.data, { email, ip: clientIp(request) });
    if (!template) throw new PlannerError("Template not found.", 404);
    return Response.json(template);
  } catch (error) {
    return fail(error);
  }
}
