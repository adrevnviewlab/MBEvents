import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { createVenue, listStaffVenues } from "@/lib/places";
import { clientIp } from "@/lib/request-origin";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  area: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  capacity: z.string().max(80).optional(),
  description: z.string().max(4000).optional(),
  amenities: z.string().max(2000).optional(),
  serviceArea: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),
  mbProduction: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    await requireActor(request, "venues.read");
    return Response.json({ venues: await listStaffVenues() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "venues.write");
    const input = parseInput(schema, await readJson(request));
    const venue = await createVenue(input, { email: actor.email, userId: actor.userId, ip: clientIp(request) });
    return Response.json({ venue }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
