// Starts the project-local Postgres cluster when Docker is not installed.
// The cluster lives in gitignored .data and listens on 127.0.0.1:5432.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, ".data", "pgsql-src", "pgsql", "bin", "pg_ctl.exe");
const data = join(root, ".data", "pgdata");
const log = join(root, ".data", "pg.log");

if (!existsSync(bin) || !existsSync(data)) {
  console.error("[pg] No local cluster. Install Docker and run pnpm db:up, or initialize Postgres in .data first.");
  process.exit(1);
}

const status = spawnSync(bin, ["-D", data, "status"], { encoding: "utf8" });
if (status.status === 0) {
  console.log("[pg] already running");
  process.exit(0);
}

const started = spawnSync(bin, ["-D", data, "-l", log, "-w", "start"], { encoding: "utf8" });
if (started.status !== 0) {
  console.error("[pg] could not start. See .data/pg.log");
  process.exit(started.status ?? 1);
}
console.log("[pg] started");
