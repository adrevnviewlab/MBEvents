import { devAuthOpen } from "@/lib/config";
import { CLIENT_COOKIE, sessionCookie, verifyPassword } from "@/lib/planner";
import { limits, pruneExpired } from "@/lib/rate-limit";
import { assertWriteOrigin, checkLogin, createSession, endSession, eventByCode, fail, PlannerError, readJson } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.clientLogin(request);
    const body = (await readJson(request)) as { code?: unknown; password?: unknown };
    const code = String(body.code ?? "").trim().toUpperCase();
    const password = String(body.password ?? "").trim().toUpperCase();
    if (!code || code.length > 20 || password.length > 100 || (!devAuthOpen() && !password)) throw new PlannerError(devAuthOpen() ? "Enter your event code." : "Enter your event code and password.");
    const row = devAuthOpen() ? await eventByCode("code", code) : await checkLogin("code", code, (r) => verifyPassword(password, r.password_hash));
    const { token, maxAge } = await createSession(row.id, "client");
    await pruneExpired().catch(() => {});
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(request, CLIENT_COOKIE, token, maxAge) } });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertWriteOrigin(request);
    await endSession(request, "client");
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(request, CLIENT_COOKIE, "x".repeat(20), 0) } });
  } catch (error) {
    return fail(error);
  }
}
