import { z } from "zod";
import { unsubscribeByToken } from "@/lib/automations";
import { limits } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-origin";
import { fail, readJson } from "@/lib/planner-server";
import { parseInput } from "@/lib/validate";

const schema = z.object({ token: z.string().trim().min(1).max(200) });

async function run(request: Request, token: string) {
  await limits.unsubscribe(request);
  await unsubscribeByToken(token, { email: "customer", ip: clientIp(request) });
}

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    await run(request, token);
    return new Response("You are unsubscribed from marketing messages.", {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = parseInput(schema, await readJson(request));
    await run(request, input.token);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
