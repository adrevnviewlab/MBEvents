import { clientSections, type ClientSection } from "@/lib/planner";
import { assertWriteOrigin, clientView, eventExtras, fail, keepApprovedGuestSongs, PlannerError, readJson, saveSection, sessionEvent } from "@/lib/planner-server";

export async function GET(request: Request) {
  try {
    const event = await sessionEvent(request, "client");
    return Response.json(clientView(event, await eventExtras(event.row.id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

// Saves one client-editable section ({ section, value }).
export async function PATCH(request: Request) {
  try {
    assertWriteOrigin(request);
    const event = await sessionEvent(request, "client");
    const body = (await readJson(request)) as { section?: string; value?: unknown };
    if (!body.section || !(body.section in clientSections)) throw new PlannerError("Unknown section.");
    const section = body.section as ClientSection;
    const parsed = clientSections[section].safeParse(body.value);
    if (!parsed.success) throw new PlannerError("Some details look invalid. Please check and try again.");
    const value = section === "songs" ? await keepApprovedGuestSongs(event.row.id, event.data.songs, parsed.data as typeof event.data.songs) : parsed.data;
    await saveSection(event, section, value as never);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
