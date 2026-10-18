import { hostContext, postGuest } from "@/lib/invite-http";
import { fail } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    return await postGuest(await hostContext(request, true), request);
  } catch (error) {
    return fail(error);
  }
}
