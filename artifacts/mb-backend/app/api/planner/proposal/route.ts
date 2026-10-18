import { acceptProposal } from "@/lib/finance";
import { assertBodyEvent, assertWriteOrigin, fail, readJson, sessionEvent } from "@/lib/planner-server";
import { clientIp } from "@/lib/request-origin";

// Accepting a quote does not create a booking and does not charge a card.
export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    const event = await sessionEvent(request, "client");
    const raw = await readJson(request);
    assertBodyEvent(event, raw);
    const versionId = raw && typeof raw === "object" && typeof (raw as { versionId?: unknown }).versionId === "string" ? (raw as { versionId: string }).versionId : undefined;
    const result = await acceptProposal({
      eventId: event.row.event_id || event.row.id,
      versionId,
      acceptedBy: event.data.details.clientNames || "Client",
      actorEmail: event.data.details.email || "client",
      ip: clientIp(request),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return fail(error);
  }
}
