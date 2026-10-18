import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { mergeLeads } from "@/lib/crm";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({ leadId: z.string().uuid() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "leads.write");
    const { id } = await params;
    const body = parseInput(schema, await readJson(request));
    await mergeLeads(id, body.leadId, actor);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
