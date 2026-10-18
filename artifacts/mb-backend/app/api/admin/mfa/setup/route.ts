import { beginMfaSetup, confirmMfaSetup, disableMfa, requireAdmin } from "@/lib/admin";
import { assertWriteOrigin, fail, readJson } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    const email = await requireAdmin(request);
    const body = (await readJson(request)) as { code?: unknown; password?: unknown; disable?: unknown };
    if (body.disable === true) {
      await disableMfa(email, String(body.password ?? "").slice(0, 200), String(body.code ?? "").slice(0, 20));
      return Response.json({ ok: true });
    }
    if (body.code) {
      const recoveryCodes = await confirmMfaSetup(email, String(body.code).slice(0, 20));
      return Response.json({ ok: true, recoveryCodes });
    }
    const setup = await beginMfaSetup(email);
    return Response.json(setup);
  } catch (error) {
    return fail(error);
  }
}
