import { invitationResponse, officeContext, patchInvitation } from "@/lib/invite-http";
import { limits } from "@/lib/rate-limit";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await limits.inviteRead(request);
    return await invitationResponse(await officeContext(request, (await params).id, false));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    return await patchInvitation(await officeContext(request, (await params).id, true), request);
  } catch (error) {
    return fail(error);
  }
}
