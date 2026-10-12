import { leadSchema } from "@/lib/lead";
import { notifyMb } from "@/lib/notify";
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

    const id = crypto.randomUUID();
    await db().batch([
      db().prepare(
        `INSERT INTO leads (id, source, name, email, phone, event_type, event_date, guest_count, location, venue_status, vibe, priorities, contact_method, campaign, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, input.source, input.name, input.email.toLowerCase(), input.phone, input.eventType, input.eventDate || null, input.guestCount || null,
        input.location || null, input.venueStatus || null, input.vibe || null, JSON.stringify(input.priorities), input.contactMethod,
        input.campaign || null, input.notes || null,
      ),
      db().prepare("INSERT INTO analytics_events (id, event_name, source, lead_id) VALUES (?, 'lead_created', ?, ?)").bind(crypto.randomUUID(), input.source, id),
    ]);
    await notifyMb(publicOrigin(request), "", `New ${input.source} inquiry from ${input.name}`, [
      `${input.eventType}${input.eventDate ? ` on ${input.eventDate}` : ""}`,
      [input.email, input.phone].filter(Boolean).join(" · "),
      input.notes ?? "",
    ], `/admin/leads/${id}`);
    return Response.json({ ok: true, leadId: id }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
