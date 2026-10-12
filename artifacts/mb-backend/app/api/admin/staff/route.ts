import { z } from "zod";
import { hashPassword, isOwner, requireAdmin } from "@/lib/admin";
import { randomCode } from "@/lib/planner";
import { db, fail, PlannerError, readJson } from "@/lib/planner-server";

async function requireOwner(request?: Request) {
  const email = await requireAdmin(request);
  if (!isOwner(email)) throw new PlannerError("Only the owner can manage staff.", 403);
  return email;
}

export async function GET() {
  try {
    await requireOwner();
    const rows = await db().prepare("SELECT email, name, created_at FROM admin_users ORDER BY created_at DESC").all();
    return Response.json({ staff: rows.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

const createSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), name: z.string().trim().max(120).default("") });

// Adds a staff login (or resets its password) and returns the password once.
export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Enter a valid email address.");
    const { email, name } = parsed.data;
    if (isOwner(email)) throw new PlannerError("That's the owner account; change it with MB_ADMIN_PASSWORD.");
    const password = randomCode(12);
    const now = new Date().toISOString();
    await db().batch([
      db().prepare("INSERT INTO admin_users (email, name, password_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash")
        .bind(email, name, await hashPassword(password), now, owner),
      db().prepare("DELETE FROM admin_sessions WHERE email = ?").bind(email),
    ]);
    return Response.json({ email, password }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireOwner(request);
    const email = (new URL(request.url).searchParams.get("email") ?? "").toLowerCase();
    if (!email) throw new PlannerError("Missing email.");
    await db().batch([
      db().prepare("DELETE FROM admin_users WHERE email = ?").bind(email),
      db().prepare("DELETE FROM admin_sessions WHERE email = ?").bind(email),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
