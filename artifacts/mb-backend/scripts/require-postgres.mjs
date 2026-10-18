// Dev and production entrypoints call this before migrations.
// Automated tests set DATABASE_URL=pglite:memory themselves and do not call this script.
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
if (!url) {
  console.error("[db] DATABASE_URL is required. Copy .env.example to .env.local and start Postgres with pnpm db:up or pnpm db:local.");
  process.exit(1);
}
if (url.startsWith("pglite:")) {
  console.error("[db] Refusing in-memory storage for the dev server and production. Point DATABASE_URL at Postgres. Tests keep their own pglite:memory database.");
  process.exit(1);
}
try {
  const parsed = new URL(url);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    console.error("[db] DATABASE_URL must be a Postgres URL.");
    process.exit(1);
  }
} catch {
  console.error("[db] DATABASE_URL must be a Postgres URL.");
  process.exit(1);
}
