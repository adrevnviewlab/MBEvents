import { publicMediaUpload } from "@/lib/invite-http";
import { limits } from "@/lib/rate-limit";
import { assertWriteOrigin, fail } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.inviteMedia(request);
    return await publicMediaUpload(request);
  } catch (error) {
    return fail(error);
  }
}
