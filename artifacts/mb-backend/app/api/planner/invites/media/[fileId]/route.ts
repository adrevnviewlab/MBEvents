import { hostContext, hostMediaFile } from "@/lib/invite-http";
import { limits } from "@/lib/rate-limit";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ fileId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await limits.inviteRead(request);
    return await hostMediaFile(await hostContext(request, false), (await params).fileId);
  } catch (error) {
    return fail(error);
  }
}
