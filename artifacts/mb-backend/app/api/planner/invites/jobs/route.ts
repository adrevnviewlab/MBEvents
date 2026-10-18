import { hostContext, postJob, postJobRun } from "@/lib/invite-http";
import { fail, readJson } from "@/lib/planner-server";

export async function POST(request: Request) {
  try {
    const ctx = await hostContext(request, true);
    const body = (await readJson(request)) as { run?: unknown };
    if (body.run === true) return await postJobRun(ctx);
    return await postJob(ctx, body);
  } catch (error) {
    return fail(error);
  }
}
