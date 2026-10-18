import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { can } from "@/lib/authz";
import { getBusinessSettings, saveBusinessSettings } from "@/lib/business-settings";
import { fail, readJson } from "@/lib/planner-server";
import { clientIp } from "@/lib/request-origin";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "settings.read");
    const settings = await getBusinessSettings();
    return Response.json({
      settings,
      canEdit: can(actor.role, "settings.write") || (settings.ownerEmail && actor.email === settings.ownerEmail),
      ownerEmail: settings.ownerEmail,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

const bodySchema = z.object({
  companyName: z.string().max(200).optional(),
  contactEmail: z.string().max(200).optional(),
  contactPhone: z.string().max(40).optional(),
  contactAddress: z.string().max(400).optional(),
  timezone: z.string().max(64).optional(),
  oneEventPerDate: z.boolean().optional(),
  requireOwnerConfirm: z.boolean().optional(),
  requireStaffBeforeConfirm: z.boolean().optional(),
  depositDueDays: z.number().int().min(0).max(3650).nullable().optional(),
}).strict();

export async function PUT(request: Request) {
  try {
    const actor = await requireActor(request, "settings.write");
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return Response.json({ error: "Check the company settings." }, { status: 400 });
    const settings = await saveBusinessSettings({ ...parsed.data, actorEmail: actor.email, ip: clientIp(request) });
    return Response.json({ settings });
  } catch (error) {
    return fail(error);
  }
}
