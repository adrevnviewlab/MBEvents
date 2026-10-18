import { officeContext, patchTable, removeTable } from "@/lib/invite-http";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string; tableId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, tableId } = await params;
    return await patchTable(await officeContext(request, id, true), tableId, request);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id, tableId } = await params;
    return await removeTable(await officeContext(request, id, true), tableId);
  } catch (error) {
    return fail(error);
  }
}
