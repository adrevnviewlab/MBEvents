import { z } from "zod";
import { fillMergeTags } from "@/lib/planner";
import { notifyMb } from "@/lib/notify";
import { publicOrigin } from "@/lib/request-origin";
import { assertWriteOrigin, fail, PlannerError, readJson, saveAdminWithAutoCheck, sessionEvent } from "@/lib/planner-server";

const schema = z.object({
  docId: z.string().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  signature: z.string().startsWith("data:image/png;base64,").max(200000),
  agree: z.literal(true),
});

// E-signature: freezes the merged document text alongside the signature.
export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    const event = await sessionEvent(request, "client");
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Type your full name, draw your signature, and agree to sign.");
    const doc = event.admin.documents.find((d) => d.id === parsed.data.docId);
    if (!doc || doc.status !== "sent") throw new PlannerError("This document is not available to sign.", 404);
    const documents = event.admin.documents.map((d) =>
      d.id === doc.id
        ? {
            ...d,
            body: fillMergeTags(d.body, event.data, event.admin),
            status: "signed" as const,
            signedName: parsed.data.name,
            signature: parsed.data.signature,
            signedAt: new Date().toISOString(),
            signedIp: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "",
          }
        : d,
    );
    await saveAdminWithAutoCheck(event, { documents });
    await notifyMb(publicOrigin(request), event.row.id, `${doc.title} signed by ${parsed.data.name}`, [`${event.data.details.clientNames} signed "${doc.title}".`]);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
