import { z } from "zod";
import { assignableRole, hashPassword, isOwner, requireActor } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { randomCode } from "@/lib/planner";
import { clientIp } from "@/lib/request-origin";
import { db, fail, PlannerError, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

export async function GET(request: Request) {
  try {
    await requireActor(request, "users.manage");
    const rows = await db().prepare(
      `SELECT u.email, u.name, u.role, u.created_at, u.mfa_enabled, u.disabled_at
       FROM users u
       WHERE u.role IN ('admin', 'manager', 'sales', 'coordinator', 'staff') AND u.password_hash IS NOT NULL
       ORDER BY u.created_at DESC`,
    ).all();
    return Response.json({ staff: rows.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120).default(""),
  role: z.enum(["admin", "manager", "sales", "coordinator", "staff"]).default("coordinator"),
});

// Adds an office login (or resets its password) and returns the password once.
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "users.manage");
    const { email, name, role } = parseInput(createSchema, await readJson(request));
    const officeRole = role ?? "coordinator";
    if (!assignableRole(officeRole)) throw new PlannerError("Choose a valid role.");
    if (isOwner(email) || email === actor.email) throw new PlannerError("Change the owner password with MB_ADMIN_PASSWORD.");
    const password = randomCode(12);
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const existing = await db().prepare("SELECT id, role FROM users WHERE email = ?").bind(email).first<{ id: string; role: string }>();
    const userId = existing?.id ?? crypto.randomUUID();
    await db().batch([
      db().prepare(
        `INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (email) DO UPDATE SET name = excluded.name, role = excluded.role, password_hash = excluded.password_hash, disabled_at = NULL`,
      ).bind(userId, email, name, officeRole, passwordHash, now),
      db().prepare(
        `INSERT INTO admin_users (email, name, password_hash, created_at, created_by, user_id) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash, user_id = excluded.user_id`,
      ).bind(email, name, passwordHash, now, actor.email, userId),
      db().prepare(
        `INSERT INTO staff (id, user_id, name, email) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, email = excluded.email, active = true`,
      ).bind(userId, userId, name || email, email),
      db().prepare("DELETE FROM admin_sessions WHERE email = ?").bind(email),
    ]);
    await audit({
      actorEmail: actor.email,
      userId: actor.userId,
      action: existing ? "user_password_reset" : "user_created",
      entity: "users",
      subjectId: userId,
      ip: clientIp(request),
      before: existing ? { role: existing.role } : undefined,
      after: { email, role: officeRole },
    });
    return Response.json({ email, password, role: officeRole }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireActor(request, "users.manage");
    const email = (new URL(request.url).searchParams.get("email") ?? "").toLowerCase();
    if (!email) throw new PlannerError("Missing email.");
    if (isOwner(email) || email === actor.email) throw new PlannerError("You can't remove the account you're signed in with.");
    const user = await db().prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    await db().batch([
      db().prepare("UPDATE users SET disabled_at = now(), password_hash = NULL WHERE email = ?").bind(email),
      db().prepare("DELETE FROM admin_users WHERE email = ?").bind(email),
      db().prepare("DELETE FROM admin_sessions WHERE email = ?").bind(email),
    ]);
    await audit({ actorEmail: actor.email, userId: actor.userId, action: "user_disabled", entity: "users", subjectId: user?.id ?? email, ip: clientIp(request), after: { email } });
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
