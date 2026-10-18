import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { setAttribution } from "@/lib/places";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({
  entity: z.enum(["lead", "event"]),
  id: z.string().uuid(),
  referredBy: z.string().trim().max(200).nullable().optional(),
  venueId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const input = parseInput(schema, await readJson(request));
    await requireActor(request, input.entity === "lead" ? "leads.write" : "events.write");
    await setAttribution(input);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
