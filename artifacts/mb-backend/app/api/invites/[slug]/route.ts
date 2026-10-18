import { publicInviteResponse } from "@/lib/invite-http";
import { limits } from "@/lib/rate-limit";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await limits.inviteRead(request);
    const token = new URL(request.url).searchParams.get("t")?.trim() ?? "";
    return await publicInviteResponse((await params).slug, token);
  } catch (error) {
    return fail(error);
  }
}
