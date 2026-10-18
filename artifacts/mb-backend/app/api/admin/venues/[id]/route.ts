import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { staffVenueById, updateVenue } from "@/lib/places";
import { clientIp } from "@/lib/request-origin";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  area: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  capacity: z.string().max(80).optional(),
  description: z.string().max(4000).optional(),
  amenities: z.string().max(2000).optional(),
  serviceArea: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),
  active: z.boolean().optional(),
  published: z.boolean().optional(),
  mbProduction: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await requireActor(request, "venues.read");
    return Response.json({ venue: await staffVenueById((await params).id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await requireActor(request, "venues.write");
    const input = parseInput(schema, await readJson(request));
    const venue = await updateVenue((await params).id, input, { email: actor.email, userId: actor.userId, ip: clientIp(request) });
    return Response.json({ venue });
  } catch (error) {
    return fail(error);
  }
}
