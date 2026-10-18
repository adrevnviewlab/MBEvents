import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { guestAccessToken, guestRequestPath } from "../lib/planner.ts";

test("guest links carry a token and not a password", () => {
  const token = guestAccessToken();
  const path = guestRequestPath(token);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(guestAccessToken(), token);
  assert.equal(path, `/planner/guest?t=${token}`);
  assert.equal(path.includes("pw="), false);
  assert.equal(path.includes("password"), false);
});

test("guest token migration only adds a column", () => {
  const sql = readFileSync(new URL("../db/migrations/0004_guest_access_token.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS guest_access_token text/i);
  assert.equal(/\b(drop|delete|truncate)\b/i.test(sql), false);
});

test("existing planner rows survive a guest token", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite("memory://");
  await db.exec("CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const dir = new URL("../db/migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    await db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  const id = "00000000-0000-4000-8000-000000000001";
  const customerId = "00000000-0000-4000-8000-000000000002";
  await db.query("INSERT INTO customers (id, name, email) VALUES ($1, 'Keep', 'keep@example.test')", [customerId]);
  await db.query("INSERT INTO events (id, customer_id, name) VALUES ($1, $2, 'Keep')", [id, customerId]);
  await db.query(
    "INSERT INTO planner_events (id, code, password_hash, guest_code, guest_password, event_id, data, admin_data) VALUES ($1, $2, $3, $4, $5, $1, $6, $7)",
    [id, "MB-KEEP", "hash", "G-KEEP", "SECRET", "{}", "{}"],
  );
  const token = guestAccessToken();
  await db.query("UPDATE planner_events SET guest_access_token = $1 WHERE id = $2 AND guest_access_token IS NULL", [token, id]);
  const again = guestAccessToken();
  await db.query("UPDATE planner_events SET guest_access_token = $1 WHERE id = $2 AND guest_access_token IS NULL", [again, id]);
  const found = await db.query("SELECT id, guest_password, guest_access_token FROM planner_events WHERE guest_access_token = $1", [token]);
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].id, id);
  assert.equal(found.rows[0].guest_password, "SECRET");
  assert.equal(found.rows[0].guest_access_token, token);

  const replacement = guestAccessToken();
  await db.query("UPDATE planner_events SET guest_password = $1, guest_access_token = $2 WHERE id = $3", ["NEXT", replacement, id]);
  const oldLink = await db.query("SELECT id FROM planner_events WHERE guest_access_token = $1", [token]);
  const kept = await db.query("SELECT id, code, guest_password, guest_access_token FROM planner_events WHERE id = $1", [id]);
  assert.equal(oldLink.rows.length, 0);
  assert.equal(kept.rows.length, 1);
  assert.equal(kept.rows[0].code, "MB-KEEP");
  assert.equal(kept.rows[0].guest_password, "NEXT");
  assert.equal(kept.rows[0].guest_access_token, replacement);
  await db.close();
});
