import { evaluationSchema } from "@/lib/planner";
import { assertWriteOrigin, fail, PlannerError, readJson, saveEvent, sessionEvent } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    const event = await sessionEvent(request, "client");
    const parsed = evaluationSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Please rate each area from 1 to 5.");
    const evaluation = { ...parsed.data, submittedAt: new Date().toISOString() };
    await saveEvent(event.row.id, { data: { evaluation } });
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
