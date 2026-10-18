import { confirmPasswordReset, requestPasswordReset } from "@/lib/admin";
import { limits } from "@/lib/rate-limit";
import { publicOrigin } from "@/lib/request-origin";
import { assertWriteOrigin, fail, readJson } from "@/lib/planner-server";

// Always the same response. A missing account is not distinguishable from a sent email.
export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.adminRecover(request);
    const body = (await readJson(request)) as { email?: unknown; token?: unknown; password?: unknown };
    if (body.token) {
      await confirmPasswordReset(String(body.token), String(body.password ?? ""));
      return Response.json({ ok: true });
    }
    await requestPasswordReset(String(body.email ?? "").slice(0, 200), publicOrigin(request));
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
