import { requireActor } from "@/lib/admin";
import { readStoredFile } from "@/lib/files";
import { fail } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string }> };

function asBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function GET(request: Request, { params }: Params) {
  try {
    await requireActor(request, "files.read");
    const file = await readStoredFile((await params).id);
    return new Response(asBody(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
