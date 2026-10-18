import { readPublishedPhoto } from "@/lib/places";
import { fail } from "@/lib/planner-server";

function asBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const file = await readPublishedPhoto("vendor_photo", (await params).id);
    return new Response(asBody(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
