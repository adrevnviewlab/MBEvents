import { env } from "@/lib/env";
import { notifyMb } from "@/lib/notify";
import { money } from "@/lib/planner";
import { publicOrigin } from "@/lib/request-origin";
import { assertWriteOrigin, db, fail, parseEvent, PlannerError, readJson, saveAdminWithAutoCheck, sessionEvent, type EventRow } from "@/lib/planner-server";

const stripeKey = () => (env as unknown as { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY?.trim();

async function stripe(path: string, init?: { body: URLSearchParams }) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: init ? "POST" : "GET",
    headers: { Authorization: `Bearer ${stripeKey()}`, ...(init ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: init?.body,
  });
  const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new PlannerError(json.error?.message || "Payment provider error.", 502);
  return json;
}

// Starts a Stripe Checkout session for one scheduled payment.
export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    if (!stripeKey()) throw new PlannerError("Online payments are not set up yet. Please call (855) 627-6863 to pay.", 503);
    const event = await sessionEvent(request, "client");
    const { paymentId } = (await readJson(request)) as { paymentId?: string };
    const payment = event.admin.payments.find((p) => p.id === paymentId);
    if (!payment || payment.status !== "due" || payment.amount <= 0) throw new PlannerError("That payment is not due.", 404);
    const origin = publicOrigin(request);
    const form = new URLSearchParams({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(Math.round(payment.amount * 100)),
      "line_items[0][price_data][product_data][name]": `MB Events - ${payment.label}`,
      "metadata[event_id]": event.row.id,
      "metadata[payment_id]": payment.id,
      success_url: `${origin}/api/planner/pay?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/planner?tab=Payments`,
    });
    if (event.data.details.email.includes("@")) form.set("customer_email", event.data.details.email);
    const session = await stripe("checkout/sessions", { body: form });
    return Response.json({ url: session.url });
  } catch (error) {
    return fail(error);
  }
}

// Stripe redirects here after checkout; verify with Stripe and record the payment.
export async function GET(request: Request) {
  const back = (state: string) => Response.redirect(new URL(`/planner?tab=Payments&payment=${state}`, publicOrigin(request)), 303);
  try {
    const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
    if (!stripeKey() || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return back("error");
    const session = (await stripe(`checkout/sessions/${sessionId}`)) as { payment_status?: string; metadata?: Record<string, string> };
    if (session.payment_status !== "paid" || !session.metadata?.event_id) return back("pending");
    const row = await db().prepare("SELECT * FROM planner_events WHERE id = ?").bind(session.metadata.event_id).first<EventRow>();
    if (!row) return back("error");
    const event = parseEvent(row);
    if (!event.admin.payments.some((p) => p.ref === sessionId)) {
      const payments = event.admin.payments.map((p) =>
        p.id === session.metadata!.payment_id ? { ...p, status: "paid" as const, paidAt: new Date().toISOString().slice(0, 10), method: "Card (online)", ref: sessionId } : p,
      );
      await saveAdminWithAutoCheck(event, { payments });
      const paid = payments.find((p) => p.ref === sessionId);
      await notifyMb(publicOrigin(request), row.id, `Payment received from ${event.data.details.clientNames}`, [`${paid?.label}: ${money(paid?.amount ?? 0)} paid by card.`]);
    }
    return back("success");
  } catch (error) {
    console.error("Payment confirmation failed", error);
    return back("error");
  }
}
