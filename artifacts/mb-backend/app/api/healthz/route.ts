import { integrationFlags } from "@/lib/config";

export async function GET() {
  const flags = integrationFlags();
  // jobRunner is always external: run `pnpm jobs:once` on a schedule or `pnpm jobs:worker`.
  return Response.json({ ok: true, ...flags, jobRunner: "external" });
}
