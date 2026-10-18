import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { can } from "@/lib/authz";
import { bookLead } from "@/lib/crm";
import { ledgerForEvents, MONEY_SOURCE, MONEY_SOURCE_DETAIL } from "@/lib/finance";
import { plannerDataFor } from "@/lib/planning-templates";
import { guestAccessToken, hashPassword, newAdminData, randomCode } from "@/lib/planner";
import { createEventRecord, ensureCustomer } from "@/lib/records";
import { db, fail, PlannerError, readJson } from "@/lib/planner-server";

type ListRow = { id: string; code: string; updated_at: string; data: string; admin_data: string; unread: number; pending: number };

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "events.read");
    const rows = await db()
      .prepare(`SELECT e.id, e.code, e.updated_at, e.data, e.admin_data,
        (SELECT CAST(COUNT(*) AS integer) FROM planner_messages m WHERE m.event_id = e.id AND m.sender = 'client' AND m.read_at IS NULL) AS unread,
        (SELECT CAST(COUNT(*) AS integer) FROM planner_guest_requests r WHERE r.event_id = e.id AND r.status = 'pending') AS pending
        FROM planner_events e ORDER BY e.updated_at DESC LIMIT 300`)
      .all<ListRow>();
    const money = can(actor.role, "payments.read") ? await ledgerForEvents(rows.results.map((row) => row.id)) : null;
    return Response.json({
      moneySource: money ? MONEY_SOURCE : null,
      moneyDetail: money ? MONEY_SOURCE_DETAIL : null,
      events: rows.results.map((r) => {
        const d = JSON.parse(r.data).details;
        const ledger = money?.get(r.id);
        return {
          id: r.id,
          code: r.code,
          updatedAt: r.updated_at,
          clientNames: d.clientNames,
          eventType: d.eventType,
          eventDate: d.eventDate,
          venueName: d.venueName,
          unread: r.unread,
          pending: r.pending,
          ...(money ? { dueCents: ledger?.dueCents ?? null, paidCents: ledger?.paidCents ?? null, balanceCents: ledger?.balanceCents ?? null } : {}),
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

const createSchema = z.object({
  clientNames: z.string().trim().min(2).max(200),
  email: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(40).default(""),
  eventType: z.string().trim().min(1).max(80),
  eventDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
  venueName: z.string().trim().max(200).default(""),
  guestCount: z.string().trim().max(40).default(""),
  leadId: z.string().uuid().optional().or(z.literal("")),
});

// Creates a client portal and returns its one-time password.
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "events.write");
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Add the client name and event type.");
    const { leadId, ...details } = parsed.data;
    if (leadId) {
      const booked = await bookLead({ leadId, actor, details });
      return Response.json({ id: booked.id, code: booked.code, password: booked.password }, { status: 201 });
    }
    const id = crypto.randomUUID();
    const code = `MB-${randomCode(6)}`;
    const password = randomCode(10);
    const guestCode = `G-${randomCode(6)}`;
    const guestPassword = randomCode(6);
    const guestToken = guestAccessToken();
    const now = new Date().toISOString();
    const customerId = await ensureCustomer({ name: details.clientNames, email: details.email, phone: details.phone });
    await createEventRecord({ id, customerId, leadId, name: details.clientNames, eventType: details.eventType, eventDate: details.eventDate, guestCount: details.guestCount, location: details.venueName });
    try {
      await db().batch([
        db().prepare("INSERT INTO planner_events (id, created_at, updated_at, code, password_hash, guest_code, guest_password, guest_access_token, lead_id, event_id, data, admin_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, now, now, code, await hashPassword(password), guestCode, guestPassword, guestToken, leadId || null, id, JSON.stringify(await plannerDataFor(details)), JSON.stringify(newAdminData())),
        db().prepare("INSERT INTO admin_audit (id, created_at, actor_email, action, entity, subject_id, before_value, after_value) VALUES (?, ?, ?, 'planner_created', 'events', ?, NULL, ?)")
          .bind(crypto.randomUUID(), now, actor.email, id, JSON.stringify({ code })),
      ]);
    } catch (error) {
      await db().prepare("DELETE FROM events WHERE id = ?").bind(id).run().catch(() => {});
      throw error;
    }
    return Response.json({ id, code, password }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
