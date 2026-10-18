import { hostContext, postAssign } from "@/lib/invite-http";
import { fail } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    return await postAssign(await hostContext(request, true), request);
  } catch (error) {
    return fail(error);
  }
}
