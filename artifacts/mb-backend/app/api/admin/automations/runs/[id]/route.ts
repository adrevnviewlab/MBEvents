import { requireActor } from "@/lib/admin";
import { cancelRun } from "@/lib/automations";
import { clientIp } from "@/lib/request-origin";
import { fail } from "@/lib/planner-server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "automations.write");
    const run = await cancelRun((await params).id, { email: actor.email, userId: actor.userId, ip: clientIp(request) });
    return Response.json({ run });
  } catch (error) {
    return fail(error);
  }
}
