import { handleStripeWebhook } from "@/lib/finance";

export async function POST(request: Request) {
  const result = await handleStripeWebhook(await request.text(), request.headers.get("stripe-signature"));
  return Response.json(result.body, { status: result.status });
}
