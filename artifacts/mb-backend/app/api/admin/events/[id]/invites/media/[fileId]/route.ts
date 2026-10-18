import { hostMediaFile, officeContext } from "@/lib/invite-http";
import { limits } from "@/lib/rate-limit";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await limits.inviteRead(request);
    const { id, fileId } = await params;
    return await hostMediaFile(await officeContext(request, id, false), fileId);
  } catch (error) {
    return fail(error);
  }
}
