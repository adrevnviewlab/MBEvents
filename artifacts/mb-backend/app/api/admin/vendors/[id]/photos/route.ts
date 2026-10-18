import { requireActor } from "@/lib/admin";
import { AppError } from "@/lib/errors";
import { saveEventFile } from "@/lib/files";
import { clientIp } from "@/lib/request-origin";
import { fail } from "@/lib/planner-server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor(request, "vendors.write");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a photo.", 400);
    const saved = await saveEventFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      kind: "vendor_photo",
      vendorId: (await params).id,
      actorEmail: actor.email,
      userId: actor.userId,
      ip: clientIp(request),
    });
    return Response.json(saved, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
