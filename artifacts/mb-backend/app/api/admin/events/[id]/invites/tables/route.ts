import { officeContext, postTable, tablesResponse } from "@/lib/invite-http";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    return await tablesResponse(await officeContext(request, (await params).id, false));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    return await postTable(await officeContext(request, (await params).id, true), request);
  } catch (error) {
    return fail(error);
  }
}
