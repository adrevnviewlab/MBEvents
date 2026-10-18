import { z } from "zod";
import { upsertSignedContract } from "@/lib/finance";
import { fillMergeTags } from "@/lib/planner";
import { notifyMb } from "@/lib/notify";
import { publicOrigin } from "@/lib/request-origin";
import { assertBodyEvent, assertWriteOrigin, fail, PlannerError, readJson, saveAdminWithAutoCheck, sessionEvent } from "@/lib/planner-server";

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
    const raw = await readJson(request);
    assertBodyEvent(event, raw);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new PlannerError("Type your full name, draw your signature, and agree to sign.");
    const doc = event.admin.documents.find((d) => d.id === parsed.data.docId);
    if (!doc || doc.status === "draft") throw new PlannerError("This document is not available to sign.", 404);
    if (doc.status !== "sent") throw new PlannerError("A signed contract can't be changed.", 403);
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
    const signed = documents.find((item) => item.id === doc.id);
    if (signed && event.row.event_id) {
      const comma = parsed.data.signature.indexOf(",");
      const bytes = Uint8Array.from(Buffer.from(parsed.data.signature.slice(comma + 1), "base64"));
      await upsertSignedContract({
        eventId: event.row.event_id,
        title: signed.title,
        body: signed.body,
        signedName: signed.signedName,
        signedIp: signed.signedIp,
        signature: bytes,
        actorEmail: event.data.details.email || "client",
      });
    }
    await notifyMb(publicOrigin(request), event.row.id, `${doc.title} signed by ${parsed.data.name}`, [`${event.data.details.clientNames} signed "${doc.title}".`]);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
