import { cookies } from "next/headers";
import { ADMIN_COOKIE, checkAdminLogin, createAdminSession, endAdminSession } from "@/lib/admin";
import { sessionCookie } from "@/lib/planner";
import { limits, pruneExpired } from "@/lib/rate-limit";
import { assertWriteOrigin, fail, readJson } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.adminLogin(request);
    const body = (await readJson(request)) as { email?: unknown; password?: unknown };
    const email = await checkAdminLogin(String(body.email ?? "").slice(0, 200), String(body.password ?? "").slice(0, 200));
    const { token, maxAge } = await createAdminSession(email);
    await pruneExpired().catch(() => {});
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(request, ADMIN_COOKIE, token, maxAge) } });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertWriteOrigin(request);
    await endAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(request, ADMIN_COOKIE, "x".repeat(40), 0) } });
  } catch (error) {
    return fail(error);
  }
}
