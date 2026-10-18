import { assertStripeTestMode, ensureCheckoutPayment } from "@/lib/finance";
import { env } from "@/lib/env";
import { publicOrigin } from "@/lib/request-origin";
import { assertBodyEvent, assertWriteOrigin, fail, PlannerError, readJson, sessionEvent } from "@/lib/planner-server";

const stripeKey = () => {
  const key = (env.STRIPE_SECRET_KEY ?? "").trim();
  assertStripeTestMode(key);
  return key;
};

async function stripe(path: string, init: { body: URLSearchParams; idempotencyKey: string }) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": init.idempotencyKey,
    },
    body: init.body,
  });
  const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new PlannerError(json.error?.message || "Payment provider error.", 502);
  return json;
}

// Starts Checkout for one due ledger row. The browser return does not mark it paid.
export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    const event = await sessionEvent(request, "client");
    const raw = (await readJson(request)) as { paymentId?: string; eventId?: unknown; event?: unknown };
    assertBodyEvent(event, raw);
    if (!stripeKey()) throw new PlannerError("Online payments are not set up yet. Please call (855) 627-6863 to pay.", 503);
    const paymentId = raw.paymentId ?? "";
    const jsonPayment = event.admin.payments.find((payment) => payment.id === paymentId);
    const eventId = event.row.event_id || event.row.id;
    const payment = await ensureCheckoutPayment({
      eventId,
      paymentId,
      label: jsonPayment?.label || "Payment",
      amountCents: jsonPayment && jsonPayment.status === "due" ? Math.round(jsonPayment.amount * 100) : 0,
      dueOn: jsonPayment?.due || null,
    });
    const origin = publicOrigin(request);
    const form = new URLSearchParams({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(payment.amountCents),
      "line_items[0][price_data][product_data][name]": `MB Events - ${payment.label}`,
      "metadata[event_id]": eventId,
      "metadata[payment_id]": payment.id,
      success_url: `${origin}/api/planner/pay?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/planner?tab=Payments`,
    });
    if (event.data.details.email.includes("@")) form.set("customer_email", event.data.details.email);
    const session = await stripe("checkout/sessions", { body: form, idempotencyKey: payment.id });
    return Response.json({ url: session.url });
  } catch (error) {
    return fail(error);
  }
}

// The return URL only shows a pending state. A verified webhook is what marks the payment paid.
export async function GET(request: Request) {
  const back = (state: string) => Response.redirect(new URL(`/planner?tab=Payments&payment=${state}`, publicOrigin(request)), 303);
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return back("error");
  return back("pending");
}
