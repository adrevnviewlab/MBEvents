import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { hashPassword, newAdminData, newPlannerData, randomCode } from "@/lib/planner";
import { db, fail, PlannerError, readJson } from "@/lib/planner-server";

type ListRow = { id: string; code: string; updated_at: string; data: string; admin_data: string; unread: number; pending: number };

export async function GET() {
  try {
    await requireAdmin();
    const rows = await db()
      .prepare(`SELECT e.id, e.code, e.updated_at, e.data, e.admin_data,
        (SELECT CAST(COUNT(*) AS integer) FROM planner_messages m WHERE m.event_id = e.id AND m.sender = 'client' AND m.read_at IS NULL) AS unread,
        (SELECT CAST(COUNT(*) AS integer) FROM planner_guest_requests r WHERE r.event_id = e.id AND r.status = 'pending') AS pending
        FROM planner_events e ORDER BY e.updated_at DESC LIMIT 300`)
      .all<ListRow>();
    return Response.json({
      events: rows.results.map((r) => {
        const d = JSON.parse(r.data).details;
        return { id: r.id, code: r.code, updatedAt: r.updated_at, clientNames: d.clientNames, eventType: d.eventType, eventDate: d.eventDate, venueName: d.venueName, unread: r.unread, pending: r.pending };
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
    const email = await requireAdmin(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Add the client name and event type.");
    const { leadId, ...details } = parsed.data;
    const id = crypto.randomUUID();
    const code = `MB-${randomCode(6)}`;
    const password = randomCode(10);
    const guestCode = `G-${randomCode(6)}`;
    const guestPassword = randomCode(6);
    const now = new Date().toISOString();
    await db().batch([
      db().prepare("INSERT INTO planner_events (id, created_at, updated_at, code, password_hash, guest_code, guest_password, lead_id, data, admin_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, now, now, code, await hashPassword(password), guestCode, guestPassword, leadId || null, JSON.stringify(newPlannerData(details)), JSON.stringify(newAdminData())),
      db().prepare("INSERT INTO admin_audit (id, created_at, actor_email, action, subject_id, before_value, after_value) VALUES (?, ?, ?, 'planner_created', ?, NULL, ?)")
        .bind(crypto.randomUUID(), now, email, id, JSON.stringify({ code })),
    ]);
    return Response.json({ id, code, password }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
