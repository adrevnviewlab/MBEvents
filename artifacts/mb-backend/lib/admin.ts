import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { assertCan, can, isRole, officeRoles, type Role } from "@/lib/authz";
import { devAuthOpen, readConfig } from "@/lib/config";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { hashPassword, sha256, verifyPassword } from "@/lib/planner";
import { hasAllowedWriteOrigin } from "@/lib/request-origin";
import { openSeal, seal } from "@/lib/secret-box";
import { base32Decode, newTotpSecret, totpMatches } from "@/lib/totp";
export { leadStages, stageLabel } from "@/lib/lead-stages";

export const ADMIN_COOKIE = "mb_admin";
const SESSION_DAYS = 14;
const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;
const CHALLENGE_MINUTES = 5;
const RESET_MINUTES = 30;

const ownerEmail = () => env.MB_ADMIN_EMAIL?.trim().toLowerCase() || "";

/** Accept "admin" as shorthand for the configured owner email. */
function resolveLoginEmail(raw: string) {
  const email = raw.trim().toLowerCase();
  if (!email) return "";
  if (email === "admin") return ownerEmail() || "admin@mb.local";
  return email;
}

export function isOwner(email: string) {
  return !!ownerEmail() && email.toLowerCase() === ownerEmail();
}

export type Actor = { email: string; userId: string | null; role: Role };

type SessionRow = { email: string; credential: string; mfa_verified: boolean; user_id: string | null; mfa_enabled: boolean | null; disabled_at: string | null; role: string | null };

// The signed-in admin's email, or null. Owner comes from MB_ADMIN_EMAIL; staff from users.
export async function getAdminEmail() {
  const actor = await getActor();
  return actor?.email ?? null;
}

function localActor(): Actor {
  return { email: ownerEmail() || "local@mb.events", userId: null, role: "admin" };
}

export async function getActor(): Promise<Actor | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9]{40,80}$/.test(token) || !env.DB) return devAuthOpen() ? localActor() : null;
  const row = await env.DB.prepare(
    `SELECT s.email, s.credential, s.mfa_verified, s.user_id, u.mfa_enabled, u.disabled_at, u.role
     FROM admin_sessions s
     LEFT JOIN users u ON u.email = s.email
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), new Date().toISOString()).first<SessionRow>().catch(() => null);
  if (!row || row.disabled_at) return devAuthOpen() ? localActor() : null;
  if (row.mfa_enabled && !row.mfa_verified) return devAuthOpen() ? localActor() : null;
  const current = await credentialTag(row.email);
  if (!current || current !== row.credential) return devAuthOpen() ? localActor() : null;
  if (isOwner(row.email)) return { email: row.email, userId: row.user_id, role: "admin" };
  if (!row.role || !isRole(row.role)) return devAuthOpen() ? localActor() : null;
  return { email: row.email, userId: row.user_id, role: row.role };
}

async function credentialTag(email: string) {
  // Always return a stable tag — empty owner password still needs a non-empty session credential.
  if (isOwner(email)) return (await sha256(`owner:${env.MB_ADMIN_PASSWORD ?? ""}`)).slice(0, 24);
  const staff = await env.DB!.prepare("SELECT password_hash FROM users WHERE email = ?").bind(email).first<{ password_hash: string | null }>();
  const hash = staff?.password_hash ?? (await env.DB!.prepare("SELECT password_hash FROM admin_users WHERE email = ?").bind(email).first<{ password_hash: string }>())?.password_hash;
  return hash ? (await sha256(`staff:${hash}`)).slice(0, 24) : "";
}

export async function requireAdminPage(path: string, permission = "office.access") {
  const actor = await getActor();
  if (!actor) redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  if (!can(actor.role, "office.access") || !can(actor.role, permission)) {
    if (actor.role === "staff") redirect("/staff");
    redirect("/admin/login?reason=role");
  }
  return actor.email;
}

export async function requireEventsPage(path: string) {
  const actor = await getActor();
  if (!actor) redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  if (!can(actor.role, "events.read")) redirect("/admin/login?reason=role");
  return actor;
}

export async function requireEventsActor(request?: Request) {
  const { PlannerError } = await import("@/lib/planner-server");
  const actor = await getActor();
  if (!actor) throw new PlannerError("Please sign in.", 401);
  if (request && request.method !== "GET" && !hasAllowedWriteOrigin(request)) throw new PlannerError("Invalid origin", 403);
  if (!can(actor.role, "events.read")) throw new PlannerError("You don't have access to that.", 403);
  return actor;
}

export async function homeForEmail(email: string) {
  const row = await env.DB?.prepare("SELECT role FROM users WHERE email = ?").bind(email).first<{ role: string }>();
  return row?.role === "staff" ? "/staff" : "/admin";
}

// Throws for missing sessions, cross-origin writes, and roles that lack the permission.
export async function requireAdmin(request?: Request, permission = "office.access") {
  const { PlannerError } = await import("@/lib/planner-server");
  const actor = await getActor();
  if (!actor) throw new PlannerError("Please sign in.", 401);
  if (request && request.method !== "GET" && !hasAllowedWriteOrigin(request)) throw new PlannerError("Invalid origin", 403);
  if (!can(actor.role, "office.access") || !can(actor.role, permission)) throw new PlannerError("You don't have access to that.", 403);
  return actor.email;
}

export async function requireActor(request: Request | undefined, permission: string) {
  const { PlannerError } = await import("@/lib/planner-server");
  const actor = await getActor();
  if (!actor) throw new PlannerError("Please sign in.", 401);
  if (request && request.method !== "GET" && !hasAllowedWriteOrigin(request)) throw new PlannerError("Invalid origin", 403);
  try {
    assertCan(actor.role, permission);
    if (permission !== "office.access") assertCan(actor.role, "office.access");
  } catch (error) {
    if (error instanceof AppError) throw new PlannerError(error.message, error.status);
    throw error;
  }
  return actor;
}

export async function checkAdminLogin(rawEmail: string, password: string) {
  const { PlannerError } = await import("@/lib/planner-server");
  const db = env.DB;
  if (!db) throw new PlannerError("The database is not configured.", 503);
  const email = resolveLoginEmail(rawEmail);
  const invalid = new PlannerError("That email and password don't match.", 401);
  if (devAuthOpen()) return email || localActor().email;
  if (!email) throw invalid;

  const lock = await db.prepare("SELECT failures, locked_until FROM admin_login_failures WHERE email = ?").bind(email).first<{ failures: number; locked_until: string | null }>();
  if (lock?.locked_until && lock.locked_until > new Date().toISOString()) throw new PlannerError("Too many attempts. Try again in 15 minutes.", 429);

  let ok = false;
  if (isOwner(email)) {
    const expected = env.MB_ADMIN_PASSWORD ?? "";
    // Empty MB_ADMIN_PASSWORD = passwordless owner (username only).
    if (expected.length === 0) ok = password.length === 0;
    else ok = expected.length >= 8 && (await sha256(password)) === (await sha256(expected));
  } else {
    if (!password) throw invalid;
    const staff = await db.prepare("SELECT password_hash, disabled_at FROM users WHERE email = ?").bind(email).first<{ password_hash: string | null; disabled_at: string | null }>();
    const hash = staff?.password_hash ?? (await db.prepare("SELECT password_hash FROM admin_users WHERE email = ?").bind(email).first<{ password_hash: string }>())?.password_hash;
    ok = !!hash && (await verifyPassword(password, hash));
    if (ok && staff?.disabled_at) throw new PlannerError("This account is disabled. Ask an admin.", 403);
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

// Creates the owner user row from MB_ADMIN_EMAIL the first time they sign in. No password is copied into the database.
export async function ensureOwnerUser(email: string) {
  if (!isOwner(email) || !env.DB) return null;
  const row = await env.DB.prepare(
    `INSERT INTO users (id, email, name, role) VALUES (?, ?, '', 'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin', disabled_at = NULL
     RETURNING id, mfa_enabled`,
  ).bind(crypto.randomUUID(), email).first<{ id: string; mfa_enabled: boolean }>();
  return row;
}

export async function createAdminSession(email: string) {
  const user = await env.DB!.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const now = new Date();
  await env.DB!.prepare("INSERT INTO admin_sessions (token_hash, email, user_id, credential, mfa_verified, created_at, expires_at) VALUES (?, ?, ?, ?, true, ?, ?)")
    .bind(await sha256(token), email, user?.id ?? null, await credentialTag(email), now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 864e5).toISOString())
    .run();
  await audit({ actorEmail: email, userId: user?.id ?? null, action: "admin_login", entity: "users", subjectId: user?.id ?? email });
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export async function endAdminSession(token: string | undefined) {
  if (token && env.DB) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

function mfaKey() {
  const key = readConfig().MB_MFA_ENCRYPTION_KEY;
  if (!key || key.length < 16) throw new AppError("Admin MFA is not configured. Set MB_MFA_ENCRYPTION_KEY.", 503);
  return key;
}

export async function startMfaChallenge(email: string) {
  const user = await env.DB!.prepare("SELECT id, mfa_enabled FROM users WHERE email = ?").bind(email).first<{ id: string; mfa_enabled: boolean }>();
  if (!user?.mfa_enabled) return null;
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const expires = new Date(Date.now() + CHALLENGE_MINUTES * 60000).toISOString();
  await env.DB!.prepare("INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), user.id, expires).run();
  return token;
}

export async function completeMfaChallenge(token: string, code: string) {
  const { PlannerError } = await import("@/lib/planner-server");
  if (!env.DB || !/^[a-f0-9]{40,80}$/i.test(token)) throw new PlannerError("That sign-in challenge has expired.", 401);
  const challenge = await env.DB.prepare(
    `SELECT c.user_id, u.email, u.mfa_secret FROM mfa_challenges c
     JOIN users u ON u.id = c.user_id
     WHERE c.token_hash = ? AND c.expires_at > now()`,
  ).bind(await sha256(token)).first<{ user_id: string; email: string; mfa_secret: string | null }>();
  if (!challenge) throw new PlannerError("That sign-in challenge has expired.", 401);
  const recovery = await recoveryCodeMatches(challenge.user_id, code);
  if (!recovery) {
    const secret = challenge.mfa_secret ? await openSeal(challenge.mfa_secret, mfaKey()) : null;
    if (!secret || !(await totpMatches(base32Decode(secret), code))) throw new PlannerError("That code doesn't match.", 401);
  }
  await env.DB.prepare("DELETE FROM mfa_challenges WHERE token_hash = ?").bind(await sha256(token)).run();
  return challenge.email;
}

export async function finishMfaLogin(token: string, code: string) {
  const email = await completeMfaChallenge(token, code);
  return { ...(await createAdminSession(email)), email };
}

async function recoveryCodeMatches(userId: string, code: string) {
  const normalized = code.trim().toUpperCase().replace(/\s/g, "");
  if (!/^MB-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) return false;
  const hash = await sha256(normalized);
  const row = await env.DB!.prepare("SELECT id FROM mfa_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL").bind(userId, hash).first<{ id: string }>();
  if (!row) return false;
  await env.DB!.prepare("UPDATE mfa_recovery_codes SET used_at = now() WHERE id = ?").bind(row.id).run();
  return true;
}

export async function beginMfaSetup(email: string) {
  const secret = newTotpSecret();
  const pending = await seal(secret, mfaKey());
  await env.DB!.prepare("UPDATE users SET mfa_pending = ? WHERE email = ?").bind(pending, email).run();
  const label = encodeURIComponent(email);
  return { secret, otpauthUrl: `otpauth://totp/MB%20Events:${label}?secret=${secret}&issuer=MB%20Events&algorithm=SHA1&digits=6&period=30` };
}

export async function confirmMfaSetup(email: string, code: string) {
  const { PlannerError } = await import("@/lib/planner-server");
  const user = await env.DB!.prepare("SELECT id, mfa_pending FROM users WHERE email = ?").bind(email).first<{ id: string; mfa_pending: string | null }>();
  if (!user?.mfa_pending) throw new PlannerError("Start MFA setup first.", 400);
  const secret = await openSeal(user.mfa_pending, mfaKey());
  if (!secret || !(await totpMatches(base32Decode(secret), code))) throw new PlannerError("That code doesn't match.", 401);
  const codes = Array.from({ length: 8 }, () => `MB-${randomGroup()}-${randomGroup()}`);
  const hashed = await Promise.all(codes.map(async (item) => ({ id: crypto.randomUUID(), hash: await sha256(item) })));
  await env.DB!.batch([
    env.DB!.prepare("UPDATE users SET mfa_secret = ?, mfa_pending = NULL, mfa_enabled = true WHERE id = ?").bind(user.mfa_pending, user.id),
    env.DB!.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").bind(user.id),
    ...hashed.map((item) => env.DB!.prepare("INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)").bind(item.id, user.id, item.hash)),
  ]);
  await env.DB!.prepare("DELETE FROM admin_sessions WHERE email = ?").bind(email).run();
  await audit({ actorEmail: email, userId: user.id, action: "mfa_enabled", entity: "users", subjectId: user.id });
  return codes;
}

function randomGroup() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function disableMfa(email: string, password: string, code: string) {
  const { PlannerError } = await import("@/lib/planner-server");
  await checkAdminLogin(email, password);
  const user = await env.DB!.prepare("SELECT id, mfa_secret, mfa_enabled FROM users WHERE email = ?").bind(email).first<{ id: string; mfa_secret: string | null; mfa_enabled: boolean }>();
  if (!user?.mfa_enabled || !user.mfa_secret) throw new PlannerError("MFA is not on for this account.", 400);
  const secret = await openSeal(user.mfa_secret, mfaKey());
  if (!secret || !(await totpMatches(base32Decode(secret), code))) throw new PlannerError("That code doesn't match.", 401);
  await env.DB!.batch([
    env.DB!.prepare("UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_pending = NULL WHERE id = ?").bind(user.id),
    env.DB!.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").bind(user.id),
    env.DB!.prepare("DELETE FROM admin_sessions WHERE email = ?").bind(email),
  ]);
  await audit({ actorEmail: email, userId: user.id, action: "mfa_disabled", entity: "users", subjectId: user.id });
}

export async function requestPasswordReset(email: string, origin: string) {
  const normalized = email.trim().toLowerCase();
  const user = await env.DB?.prepare("SELECT id, email, password_hash FROM users WHERE email = ? AND disabled_at IS NULL").bind(normalized).first<{ id: string; email: string; password_hash: string | null }>();
  if (!user?.password_hash || isOwner(user.email)) return;
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const expires = new Date(Date.now() + RESET_MINUTES * 60000).toISOString();
  await env.DB!.prepare("INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, await sha256(token), expires).run();
  const { notifyAccount } = await import("@/lib/notify");
  const sent = await notifyAccount(user.email, "Reset your MB Events admin password", ["This link expires in 30 minutes. If you did not ask for it, ignore this email."], { url: `${origin}/admin/login?reset=${token}`, label: "Choose a new password" });
  const { notifyRow } = await import("@/lib/audit");
  await notifyRow({ userId: user.id, channel: "email", topic: "password_reset", status: sent ? "sent" : "failed" });
  await audit({ actorEmail: user.email, userId: user.id, action: "password_reset_requested", entity: "users", subjectId: user.id });
}

export async function confirmPasswordReset(token: string, password: string) {
  const { PlannerError } = await import("@/lib/planner-server");
  if (!env.DB || password.length < 10 || password.length > 200) throw new PlannerError("Use a password of at least 10 characters.", 400);
  if (!/^[a-f0-9]{40,80}$/i.test(token)) throw new PlannerError("That reset link has expired.", 400);
  const row = await env.DB.prepare(
    `SELECT r.id, r.user_id, u.email FROM password_resets r
     JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > now() AND u.password_hash IS NOT NULL`,
  ).bind(await sha256(token)).first<{ id: string; user_id: string; email: string }>();
  if (!row || isOwner(row.email)) throw new PlannerError("That reset link has expired.", 400);
  const passwordHash = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, row.user_id),
    env.DB.prepare("UPDATE admin_users SET password_hash = ? WHERE email = ?").bind(passwordHash, row.email),
    env.DB.prepare("UPDATE password_resets SET used_at = now() WHERE id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM admin_sessions WHERE email = ?").bind(row.email),
    env.DB.prepare("DELETE FROM admin_login_failures WHERE email = ?").bind(row.email),
  ]);
  await audit({ actorEmail: row.email, userId: row.user_id, action: "password_reset_completed", entity: "users", subjectId: row.user_id });
}

export function assignableRole(value: string): value is (typeof officeRoles)[number] | "staff" {
  return value === "staff" || (officeRoles as readonly string[]).includes(value);
}

export { hashPassword };
