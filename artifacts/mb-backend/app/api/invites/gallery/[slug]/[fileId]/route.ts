import { readApprovedMedia } from "@/lib/invites";
import { limits } from "@/lib/rate-limit";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ slug: string; fileId: string }> };

function asBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function GET(request: Request, { params }: Params) {
  try {
    await limits.inviteRead(request);
    const { slug, fileId } = await params;
    const token = new URL(request.url).searchParams.get("t")?.trim() ?? "";
    const file = await readApprovedMedia(slug, fileId, token);
    const inline = file.contentType.startsWith("image/") || file.contentType.startsWith("video/");
    return new Response(asBody(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
