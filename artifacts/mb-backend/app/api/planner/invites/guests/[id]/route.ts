import { hostContext, patchGuest, removeGuest, rotateGuest } from "@/lib/invite-http";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    return await patchGuest(await hostContext(request, true), (await params).id, request);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    return await removeGuest(await hostContext(request, true), (await params).id);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    return await rotateGuest(await hostContext(request, true), (await params).id, request);
  } catch (error) {
    return fail(error);
  }
}
