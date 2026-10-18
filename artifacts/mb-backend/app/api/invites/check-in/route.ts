import { publicCheckIn } from "@/lib/invite-http";
import { limits } from "@/lib/rate-limit";
import { assertWriteOrigin, fail } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.inviteCheckIn(request);
    return await publicCheckIn(request);
  } catch (error) {
    return fail(error);
  }
}
