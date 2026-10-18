import { createInquiry } from "@/lib/crm";
import { leadSchema } from "@/lib/lead";
import { attachInquiryLinks } from "@/lib/places";
import { notifyInquiryConfirmation, notifyInquiryOffice } from "@/lib/communications";
import { limits } from "@/lib/rate-limit";
import { publicOrigin } from "@/lib/request-origin";
import { assertWriteOrigin, db, fail, PlannerError, readJson } from "@/lib/planner-server";

const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

// Public inquiry endpoint used by the website's Book My Event, Check My Date, venue, and contact forms.
export async function POST(request: Request) {
  try {
    assertWriteOrigin(request);
    await limits.leadForm(request);
    const parsed = leadSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return Response.json({ error: "Please check your details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const input = parsed.data;
    if (input.eventDate && input.eventDate < new Date().toISOString().slice(0, 10)) throw new PlannerError("Please choose a future date.");

    // A double-click or retry within two minutes returns the same lead instead of a duplicate.
    const existing = await db()
      .prepare("SELECT id FROM leads WHERE lower(email) = ? AND phone = ? AND source = ? AND created_at > ? LIMIT 1")
      .bind(input.email.toLowerCase(), input.phone, input.source, new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString())
      .first<{ id: string }>();
    if (existing) return Response.json({ ok: true, leadId: existing.id });

    const created = await createInquiry(input);
    await attachInquiryLinks(created.id, input);
    const origin = publicOrigin(request);
    await notifyInquiryOffice({
      leadId: created.id,
      origin,
      name: input.name,
      source: input.source,
      eventType: input.eventType,
      eventDate: input.eventDate,
      email: input.email,
      phone: input.phone,
      venueName: input.venueName,
      services: input.services,
      notes: input.notes,
    }).catch(() => undefined);
    await notifyInquiryConfirmation({
      leadId: created.id,
      email: input.email,
      name: input.name,
      eventType: input.eventType,
      eventDate: input.eventDate,
      origin,
    }).catch(() => undefined);
    return Response.json({ ok: true, leadId: created.id }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
