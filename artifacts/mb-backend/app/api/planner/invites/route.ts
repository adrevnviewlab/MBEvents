import { hostContext, invitationResponse, patchInvitation } from "@/lib/invite-http";
import { limits } from "@/lib/rate-limit";
import { fail } from "@/lib/planner-server";

export async function GET(request: Request) {
  try {
    await limits.inviteRead(request);
    return await invitationResponse(await hostContext(request, false));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await hostContext(request, true);
    return await patchInvitation(ctx, request);
  } catch (error) {
    return fail(error);
  }
}
