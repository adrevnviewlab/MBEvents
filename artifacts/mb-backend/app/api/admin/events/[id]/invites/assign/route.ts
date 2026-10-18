import { officeContext, postAssign } from "@/lib/invite-http";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    return await postAssign(await officeContext(request, (await params).id, true), request);
  } catch (error) {
    return fail(error);
  }
}
