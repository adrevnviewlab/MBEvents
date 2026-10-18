// Loads .env.local (without printing values) and runs smoke against a closed-auth Next server.
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();
process.env.BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:8082").replace(/\/$/, "");
process.env.SKIP_MARKETING = process.env.SKIP_MARKETING || "1";
process.env.SKIP_LEAD = process.env.SKIP_LEAD || "1";

if (!process.env.MB_ADMIN_EMAIL || !process.env.MB_ADMIN_PASSWORD) {
  console.error("MB_ADMIN_EMAIL and MB_ADMIN_PASSWORD are required for smoke:prod");
  process.exit(1);
}

await import("./smoke-test.mjs");
