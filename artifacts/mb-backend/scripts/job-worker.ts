/**
 * Process due message_jobs. Safe to run on a schedule (cron / host worker).
 * Does not invent recipients or enable SMS. Fails closed when email/SMS are unset.
 *
 * Usage:
 *   pnpm run jobs:once
 *   pnpm run jobs:worker
 */
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const { processDueRuns } = await import("@/lib/automations");

const once = process.argv.includes("--once") || process.env.MB_JOBS_ONCE === "1";
const intervalMs = Math.max(5_000, Number(process.env.MB_JOB_INTERVAL_MS || 60_000) || 60_000);

async function tick() {
  const result = await processDueRuns();
  const stamp = new Date().toISOString();
  console.log(`[jobs ${stamp}] processed=${result.processed} sent=${result.sent} unsent=${result.unsent}`);
  return result;
}

if (once) {
  await tick();
  process.exit(0);
}

console.log(`[jobs] worker interval ${intervalMs}ms (Ctrl+C to stop)`);
await tick();
setInterval(() => {
  tick().catch((error) => {
    console.error("[jobs] tick failed", error instanceof Error ? error.message : "error");
  });
}, intervalMs);
