import { hostContext, patchTable, removeTable } from "@/lib/invite-http";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ tableId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    return await patchTable(await hostContext(request, true), (await params).tableId, request);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    return await removeTable(await hostContext(request, true), (await params).tableId);
  } catch (error) {
    return fail(error);
  }
}
