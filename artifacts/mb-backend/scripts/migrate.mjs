// Applies db/migrations/*.sql once each, in order, inside a transaction per file.
// Runs before `next build` on Vercel; safe to re-run. Prefers a direct (non-pooled) connection.
import { readdirSync, readFileSync } from "node:fs";

const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!url) {
  console.warn("[migrate] No DATABASE_URL / POSTGRES_URL set; skipping migrations.");
  process.exit(0);
}

// Preview builds (unmerged branches) must not change the production schema.
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" && !process.env.MIGRATE_PREVIEW) {
  console.warn(`[migrate] VERCEL_ENV=${process.env.VERCEL_ENV}; skipping migrations (set MIGRATE_PREVIEW=1 for a separate preview database).`);
  process.exit(0);
}

const dir = new URL("../db/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();

async function open() {
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(url.slice("pglite:".length));
    return {
      exec: (sql) => db.exec(sql),
      names: async () => (await db.query("SELECT name FROM _migrations")).rows.map((r) => r.name),
      apply: (name, sql) => db.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
      }),
      close: () => db.close(),
    };
  }
  const { default: postgres } = await import("postgres");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, { prepare: false, ssl: local ? false : "require", max: 1, onnotice: () => {} });
  return {
    exec: (text) => sql.unsafe(text),
    names: async () => (await sql`SELECT name FROM _migrations`).map((r) => r.name),
    apply: (name, text) => sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO _migrations (name) VALUES (${name})`;
    }),
    close: () => sql.end(),
  };
}

const db = await open();
await db.exec("CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
const applied = new Set(await db.names());
for (const file of files) {
  if (applied.has(file)) continue;
  await db.apply(file, readFileSync(new URL(file, dir), "utf8"));
  console.log(`[migrate] applied ${file}`);
}
console.log("[migrate] database is up to date.");
await db.close();
