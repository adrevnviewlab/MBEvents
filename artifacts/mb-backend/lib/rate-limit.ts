import { env } from "@/lib/env";
import { clientIp } from "@/lib/request-origin";

export class RateLimitError extends Error {
  status = 429;
  constructor(message = "Too many attempts. Please wait a few minutes and try again.") {
    super(message);
  }
}

// Fixed-window counter per key, stored in Postgres so it holds across serverless instances.
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const db = env.DB;
  if (!db) return;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, hits) VALUES (?, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ?) THEN 1 ELSE rate_limits.hits + 1 END,
         window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ?) THEN now() ELSE rate_limits.window_start END
       RETURNING hits`,
    )
    .bind(key, windowSeconds, windowSeconds)
    .first<{ hits: number }>();
  if ((row?.hits ?? 0) > limit) throw new RateLimitError();
}

// Shared limits, keyed by client IP.
export const limits = {
  adminLogin: (r: Request) => rateLimit(`admin-login:${clientIp(r)}`, 10, 15 * 60),
  clientLogin: (r: Request) => rateLimit(`client-login:${clientIp(r)}`, 10, 15 * 60),
  guestLogin: (r: Request) => rateLimit(`guest-login:${clientIp(r)}`, 20, 15 * 60),
  leadForm: (r: Request) => rateLimit(`lead:${clientIp(r)}`, 5, 10 * 60),
  guestRequest: (r: Request) => rateLimit(`guest-request:${clientIp(r)}`, 30, 60 * 60),
  message: (r: Request) => rateLimit(`message:${clientIp(r)}`, 30, 10 * 60),
};

// Housekeeping: drop expired sessions and stale counters. Called on successful logins.
export async function pruneExpired() {
  const db = env.DB;
  if (!db) return;
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE expires_at < now()"),
    db.prepare("DELETE FROM planner_sessions WHERE expires_at < now()"),
    db.prepare("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'"),
  ]);
}
