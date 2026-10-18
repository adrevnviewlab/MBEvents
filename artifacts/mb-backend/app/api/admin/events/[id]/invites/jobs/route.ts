import { officeContext, postJob, postJobRun } from "@/lib/invite-http";
import { fail, readJson } from "@/lib/planner-server";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await officeContext(request, (await params).id, true);
    const body = (await readJson(request)) as { run?: unknown };
    if (body.run === true) return await postJobRun(ctx);
    return await postJob(ctx, body);
  } catch (error) {
    return fail(error);
  }
}
