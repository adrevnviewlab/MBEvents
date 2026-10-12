import { GUEST_COOKIE, sessionCookie } from "@/lib/planner";
import { limits } from "@/lib/rate-limit";
import { assertWriteOrigin, checkLogin, createSession, endSession, fail, PlannerError, readJson } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.guestLogin(request);
    const body = (await readJson(request)) as { code?: unknown; password?: unknown };
    const code = String(body.code ?? "").trim().toUpperCase();
    const password = String(body.password ?? "").trim().toUpperCase();
    if (!code || !password || code.length > 20 || password.length > 40) throw new PlannerError("Enter the guest code and password.");
    const row = await checkLogin("guest_code", code, async (r) => r.guest_password === password);
    const { token, maxAge } = await createSession(row.id, "guest");
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(request, GUEST_COOKIE, token, maxAge) } });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertWriteOrigin(request);
    await endSession(request, "guest");
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(request, GUEST_COOKIE, "x".repeat(20), 0) } });
  } catch (error) {
    return fail(error);
  }
}
