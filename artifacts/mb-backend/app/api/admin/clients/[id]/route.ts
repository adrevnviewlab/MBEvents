import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { customerProfile, updateCustomer } from "@/lib/customers";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
}).strict();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "customers.read");
    const { id } = await params;
    const profile = await customerProfile(id, actor.role);
    if (!profile) return Response.json({ error: "Customer not found." }, { status: 404 });
    return Response.json(profile, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "customers.write");
    const { id } = await params;
    const body = parseInput(patchSchema, await readJson(request));
    const customer = await updateCustomer(id, body, {
      email: actor.email,
      userId: actor.userId,
      role: actor.role,
    });
    if (!customer) return Response.json({ error: "Customer not found." }, { status: 404 });
    return Response.json({
      ok: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email || "",
        phone: customer.phone || "",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
