import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { staffVendorById, updateVendor } from "@/lib/places";
import { clientIp } from "@/lib/request-origin";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().max(80).optional(),
  contactName: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  description: z.string().max(4000).optional(),
  area: z.string().max(120).optional(),
  notes: z.string().max(4000).optional(),
  relationshipNotes: z.string().max(4000).optional(),
  preferred: z.boolean().optional(),
  active: z.boolean().optional(),
  published: z.boolean().optional(),
  verified: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await requireActor(request, "vendors.read");
    return Response.json({ vendor: await staffVendorById((await params).id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await requireActor(request, "vendors.write");
    const input = parseInput(schema, await readJson(request));
    const vendor = await updateVendor((await params).id, input, { email: actor.email, userId: actor.userId, ip: clientIp(request) });
    return Response.json({ vendor });
  } catch (error) {
    return fail(error);
  }
}
