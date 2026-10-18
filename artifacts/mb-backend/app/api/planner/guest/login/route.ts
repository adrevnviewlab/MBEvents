import { devAuthOpen } from "@/lib/config";
import { GUEST_COOKIE, sessionCookie } from "@/lib/planner";
import { limits } from "@/lib/rate-limit";
import { assertWriteOrigin, checkLogin, createSession, db, endSession, eventByCode, fail, PlannerError, readJson, type EventRow } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.guestLogin(request);
    const body = (await readJson(request)) as { code?: unknown; password?: unknown; token?: unknown };
    const presented = String(body.token ?? "").trim();
    let row: EventRow;
    if (presented) {
      // High-entropy link secret. A miss does not lock the guest password.
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(presented)) throw new PlannerError("That guest link is no longer valid.", 401);
      const match = await db().prepare("SELECT * FROM planner_events WHERE guest_access_token = ?").bind(presented).first<EventRow>();
      if (!match) throw new PlannerError("That guest link is no longer valid.", 401);
      row = match;
    } else {
      // Older shared links still sign in with the guest code and password.
      const code = String(body.code ?? "").trim().toUpperCase();
      const password = String(body.password ?? "").trim().toUpperCase();
      if (!code || code.length > 20 || password.length > 40 || (!devAuthOpen() && !password)) throw new PlannerError(devAuthOpen() ? "Enter the guest code." : "Enter the guest code and password.");
      row = devAuthOpen()
        ? await eventByCode("guest_code", code)
        : await checkLogin("guest_code", code, async (r) => String(r.guest_password || "").toUpperCase() === password);
    }
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
