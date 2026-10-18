import { ADMIN_COOKIE, finishMfaLogin, homeForEmail } from "@/lib/admin";
import { sessionCookie } from "@/lib/planner";
import { limits } from "@/lib/rate-limit";
import { assertWriteOrigin, fail, readJson } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.adminMfa(request);
    const body = (await readJson(request)) as { challenge?: unknown; code?: unknown };
    const { token, maxAge, email } = await finishMfaLogin(String(body.challenge ?? ""), String(body.code ?? "").slice(0, 40));
    return Response.json({ ok: true, home: await homeForEmail(email) }, { headers: { "Set-Cookie": sessionCookie(request, ADMIN_COOKIE, token, maxAge) } });
  } catch (error) {
    return fail(error);
  }
}
