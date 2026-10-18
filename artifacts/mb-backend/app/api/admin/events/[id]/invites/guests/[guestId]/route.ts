import { officeContext, patchGuest, removeGuest, rotateGuest } from "@/lib/invite-http";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string; guestId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, guestId } = await params;
    return await patchGuest(await officeContext(request, id, true), guestId, request);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id, guestId } = await params;
    return await removeGuest(await officeContext(request, id, true), guestId);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id, guestId } = await params;
    return await rotateGuest(await officeContext(request, id, true), guestId, request);
  } catch (error) {
    return fail(error);
  }
}
