import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { mergeCustomers } from "@/lib/customers";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({ customerId: z.string().uuid() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "customers.write");
    const { id } = await params;
    const body = parseInput(schema, await readJson(request));
    await mergeCustomers(id, body.customerId, {
      email: actor.email,
      userId: actor.userId,
      role: actor.role,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
