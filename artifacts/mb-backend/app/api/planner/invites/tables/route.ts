import { hostContext, postTable, tablesResponse } from "@/lib/invite-http";
import { fail } from "@/lib/planner-server";

export async function GET(request: Request) {
  try {
    return await tablesResponse(await hostContext(request, false));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    return await postTable(await hostContext(request, true), request);
  } catch (error) {
    return fail(error);
  }
}
