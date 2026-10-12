import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { hashPassword, sha256, verifyPassword } from "@/lib/planner";
import { hasAllowedWriteOrigin } from "@/lib/request-origin";
export { leadStages, stageLabel } from "@/lib/lead-stages";

export const ADMIN_COOKIE = "mb_admin";
const SESSION_DAYS = 14;
const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

const ownerEmail = () => env.MB_ADMIN_EMAIL?.trim().toLowerCase() || "";

export function isOwner(email: string) {
  return !!ownerEmail() && email.toLowerCase() === ownerEmail();
}

// The signed-in admin's email, or null. Owner comes from MB_ADMIN_EMAIL; staff from admin_users.
export async function getAdminEmail() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9]{40,80}$/.test(token) || !env.DB) return null;
  const row = await env.DB.prepare("SELECT email, credential FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(token), new Date().toISOString())
    .first<{ email: string; credential: string }>()
    .catch(() => null);
  if (!row) return null;
  // A session is valid only for the credential it was issued under (password changes end it).
  const current = await credentialTag(row.email);
  return current && current === row.credential ? row.email : null;
}

// Short fingerprint of the account's current credential; "" when the account no longer exists.
async function credentialTag(email: string) {
  if (isOwner(email)) return env.MB_ADMIN_PASSWORD ? (await sha256(`owner:${env.MB_ADMIN_PASSWORD}`)).slice(0, 24) : "";
  const staff = await env.DB!.prepare("SELECT password_hash FROM admin_users WHERE email = ?").bind(email).first<{ password_hash: string }>();
  return staff ? (await sha256(`staff:${staff.password_hash}`)).slice(0, 24) : "";
}

// For admin pages: sends signed-out visitors to the login page.
export async function requireAdminPage(path: string) {
  const email = await getAdminEmail();
  if (!email) redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  return email;
}

// Throws for non-admins and cross-origin writes; used by the admin APIs.
export async function requireAdmin(request?: Request) {
  const { PlannerError } = await import("@/lib/planner-server");
  const email = await getAdminEmail();
  if (!email) throw new PlannerError("Please sign in.", 401);
  if (request && request.method !== "GET" && !hasAllowedWriteOrigin(request)) throw new PlannerError("Invalid origin", 403);
  return email;
}

// Checks credentials with per-email lockout. Returns the normalized email or throws.
export async function checkAdminLogin(rawEmail: string, password: string) {
  const { PlannerError } = await import("@/lib/planner-server");
  const db = env.DB;
  if (!db) throw new PlannerError("The database is not configured.", 503);
  const email = rawEmail.trim().toLowerCase();
  const invalid = new PlannerError("That email and password don't match.", 401);
  if (!email || !password) throw invalid;

  const lock = await db.prepare("SELECT failures, locked_until FROM admin_login_failures WHERE email = ?").bind(email).first<{ failures: number; locked_until: string | null }>();
  if (lock?.locked_until && lock.locked_until > new Date().toISOString()) throw new PlannerError("Too many attempts. Try again in 15 minutes.", 429);

  let ok = false;
  if (isOwner(email)) {
    const expected = env.MB_ADMIN_PASSWORD ?? "";
    ok = expected.length >= 8 && (await sha256(password)) === (await sha256(expected));
  } else {
    const staff = await db.prepare("SELECT password_hash FROM admin_users WHERE email = ?").bind(email).first<{ password_hash: string }>();
    ok = !!staff && (await verifyPassword(password, staff.password_hash));
  }

  if (!ok) {
    const failures = (lock?.failures ?? 0) + 1;
    const lockedUntil = failures >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await db.prepare("INSERT INTO admin_login_failures (email, failures, locked_until) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until")
      .bind(email, lockedUntil ? 0 : failures, lockedUntil).run();
    throw invalid;
  }
  if (lock) await db.prepare("DELETE FROM admin_login_failures WHERE email = ?").bind(email).run();
  return email;
}

export async function createAdminSession(email: string) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const now = new Date();
  await env.DB!.prepare("INSERT INTO admin_sessions (token_hash, email, credential, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), email, await credentialTag(email), now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 864e5).toISOString())
    .run();
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export async function endAdminSession(token: string | undefined) {
  if (token && env.DB) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export { hashPassword };
