import { z } from "zod";
import { adminDataSchema, clientSections, hashPassword, randomCode, type ClientSection } from "@/lib/planner";
import { notifyClient } from "@/lib/notify";
import { db, eventExtras, fail, keepApprovedGuestSongs, parseEvent, PlannerError, readJson, saveAdminWithAutoCheck, saveSection, syncGuestSong, type EventRow } from "@/lib/planner-server";
import { requireAdmin } from "@/lib/admin";
import { publicOrigin } from "@/lib/request-origin";

type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new PlannerError("Invalid event.", 400);
  const row = await db().prepare("SELECT * FROM planner_events WHERE id = ?").bind(id).first<EventRow>();
  if (!row) throw new PlannerError("Event not found.", 404);
  return parseEvent(row);
}

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const event = await load((await params).id);
    const extras = await eventExtras(event.row.id);
    return Response.json({
      id: event.row.id,
      code: event.row.code,
      guestCode: event.row.guest_code,
      guestPassword: event.row.guest_password,
      leadId: event.row.lead_id,
      data: event.data,
      admin: event.admin,
      ...extras,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

const patchSchema = z.object({
  admin: adminDataSchema.optional(),
  section: z.string().optional(),
  value: z.unknown().optional(),
  request: z.object({ id: z.string().uuid(), status: z.enum(["pending", "approved", "declined"]) }).optional(),
  resetPassword: z.literal(true).optional(),
  resetGuest: z.literal(true).optional(),
}).strict();

export async function PATCH(request: Request, { params }: Params) {
  try {
    const email = await requireAdmin(request);
    const event = await load((await params).id);
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new PlannerError("Invalid details.");
    const body = parsed.data;
    const result: Record<string, unknown> = {};
    const now = new Date().toISOString();

    if (body.admin) {
      // Signatures and card payments recorded by the client side are immutable here,
      // so a stale admin tab can't overwrite them.
      const signed = new Map(event.admin.documents.filter((d) => d.status === "signed").map((d) => [d.id, d]));
      const online = new Map(event.admin.payments.filter((p) => p.ref.startsWith("cs_")).map((p) => [p.id, p]));
      const documents = body.admin.documents.map((d) => signed.get(d.id) ?? d);
      for (const doc of signed.values()) if (!documents.some((d) => d.id === doc.id)) documents.push(doc);
      const payments = body.admin.payments.map((p) => online.get(p.id) ?? p);
      for (const pay of online.values()) if (!payments.some((p) => p.id === pay.id)) payments.push(pay);
      await saveAdminWithAutoCheck(event, { ...body.admin, documents, payments });
      const newlySent = documents.filter((d) => d.status === "sent" && event.admin.documents.find((o) => o.id === d.id)?.status !== "sent");
      for (const doc of newlySent) {
        await notifyClient(publicOrigin(request), event.data.details.email, `Please review and sign: ${doc.title}`, [`MB Events shared "${doc.title}" with you. Please review and sign it in your planner.`], "Documents");
      }
      result.locked = { documents: [...signed.values()], payments: [...online.values()] };
    }
    if (body.section) {
      if (!(body.section in clientSections)) throw new PlannerError("Unknown section.");
      const section = body.section as ClientSection;
      const value = clientSections[section].safeParse(body.value);
      if (!value.success) throw new PlannerError("Invalid section details.");
      const next = section === "songs" ? await keepApprovedGuestSongs(event.row.id, event.data.songs, value.data as typeof event.data.songs) : value.data;
      await saveSection(event, section, next as never);
    }
    if (body.request) {
      await db().prepare("UPDATE planner_guest_requests SET status = ? WHERE id = ? AND event_id = ?").bind(body.request.status, body.request.id, event.row.id).run();
      await syncGuestSong(event.row.id, body.request.id);
    }
    if (body.resetPassword) {
      const password = randomCode(10);
      result.password = password;
      await db().batch([
        db().prepare("UPDATE planner_events SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?").bind(await hashPassword(password), event.row.id),
        db().prepare("DELETE FROM planner_sessions WHERE event_id = ? AND kind = 'client'").bind(event.row.id),
      ]);
    }
    if (body.resetGuest) {
      const guestPassword = randomCode(6);
      result.guestPassword = guestPassword;
      await db().batch([
        db().prepare("UPDATE planner_events SET guest_password = ? WHERE id = ?").bind(guestPassword, event.row.id),
        db().prepare("DELETE FROM planner_sessions WHERE event_id = ? AND kind = 'guest'").bind(event.row.id),
      ]);
    }
    await db().prepare("INSERT INTO admin_audit (id, created_at, actor_email, action, subject_id, before_value, after_value) VALUES (?, ?, ?, 'planner_updated', ?, NULL, ?)")
      .bind(crypto.randomUUID(), now, email, event.row.id, JSON.stringify(Object.keys(body))).run();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const email = await requireAdmin(request);
    const event = await load((await params).id);
    const id = event.row.id;
    await db().batch([
      db().prepare("DELETE FROM planner_sessions WHERE event_id = ?").bind(id),
      db().prepare("DELETE FROM planner_guest_requests WHERE event_id = ?").bind(id),
      db().prepare("DELETE FROM planner_messages WHERE event_id = ?").bind(id),
      db().prepare("DELETE FROM planner_events WHERE id = ?").bind(id),
      db().prepare("INSERT INTO admin_audit (id, created_at, actor_email, action, subject_id, before_value, after_value) VALUES (?, ?, ?, 'planner_deleted', ?, ?, NULL)")
        .bind(crypto.randomUUID(), new Date().toISOString(), email, id, JSON.stringify({ code: event.row.code })),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
