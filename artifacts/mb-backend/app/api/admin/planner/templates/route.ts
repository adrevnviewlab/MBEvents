import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { createPlanningTemplate, listPlanningTemplates } from "@/lib/planning-templates";
import { namedEventTypes, planningBlockIds } from "@/lib/planner";
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

export async function GET(request: Request) {
  try {
    await requireAdmin(request, "events.read");
    return Response.json({ templates: await listPlanningTemplates(), eventTypes: namedEventTypes }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const email = await requireAdmin(request, "events.write");
    const parsed = writeSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Add a template name and event type.");
    const template = await createPlanningTemplate(parsed.data, { email, ip: clientIp(request) });
    return Response.json(template, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
