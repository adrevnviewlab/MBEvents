// Logical backup of the application database. Does not print the connection string.
// Usage, from artifacts/mb-backend:
//   DATABASE_URL=postgres://... MB_BACKUP_DIR=./backups node scripts/backup.mjs
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./load-local-env.mjs";

function pgDumpBin() {
  const name = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
  const local = join(fileURLToPath(new URL("..", import.meta.url)), ".data", "pgsql-src", "pgsql", "bin", name);
  return existsSync(local) ? local : "pg_dump";
}

loadLocalEnv();

const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
if (!url) {
  console.error("[backup] Set DATABASE_URL to the Postgres database. Refusing to guess.");
  process.exit(1);
}
if (url.startsWith("pglite:")) {
  console.error("[backup] PGlite is only for automated tests. Point DATABASE_URL at Postgres.");
  process.exit(1);
}

const dir = process.env.MB_BACKUP_DIR || join(process.cwd(), "backups");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const file = join(dir, `mb-events-${stamp}.dump`);
const dump = spawnSync(pgDumpBin(), ["--format=custom", "--no-owner", "--file", file, "--dbname", url], { encoding: "utf8" });
if (dump.error) {
  console.error("[backup] pg_dump is not available. Install the PostgreSQL client tools, or use the host's point-in-time recovery.");
  process.exit(1);
}
if (dump.status !== 0) {
  console.error(`[backup] pg_dump failed with status ${dump.status}. The connection string was not printed.`);
  process.exit(dump.status ?? 1);
}
console.log(`[backup] wrote ${file}`);
