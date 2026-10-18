import { z } from "zod";
import { audit } from "@/lib/audit";
import { applyPlanningTemplate, clientVisibleAdmin, getPlanningTemplate, planningPatch } from "@/lib/planning-templates";
import { adminDataSchema, autoCheck, clientSections, guestAccessToken, guestRequestPath, hashPassword, randomCode, type AdminData, type ClientSection } from "@/lib/planner";
import { notifyClient } from "@/lib/notify";
import { clientDeadlines, clientMoney, db, ensureGuestToken, eventExtras, fail, guestAccessFields, keepApprovedGuestSongs, parseEvent, PlannerError, readJson, saveAdminWithAutoCheck, saveEvent, saveSection, syncGuestSong, type EventRow } from "@/lib/planner-server";
import { fileStore } from "@/lib/storage";
import { requireAdmin } from "@/lib/admin";
import { clientIp, publicOrigin } from "@/lib/request-origin";

type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new PlannerError("Invalid event.", 400);
  const row = await db().prepare("SELECT * FROM planner_events WHERE id = ?").bind(id).first<EventRow>();
  if (!row) throw new PlannerError("Event not found.", 404);
  return parseEvent(row);
}

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin(_request, "events.read");
    const event = await load((await params).id);
    await ensureGuestToken(event.row);
    const extras = await eventExtras(event.row.id);
    const [budget, deadlines] = await Promise.all([
      clientMoney(event.row.event_id, event.admin),
      clientDeadlines(event.row.event_id),
    ]);
    return Response.json({
      id: event.row.id,
      // Booking / calendar / operations rows use events.id; planner portal uses planner_events.id.
      eventId: event.row.event_id,
      code: event.row.code,
      guestCode: event.row.guest_code,
      guestPassword: event.row.guest_password,
      ...guestAccessFields(event.row),
      leadId: event.row.lead_id,
      data: event.data,
      admin: event.admin,
      budget: { ...budget, clientBudget: event.data.details.clientBudget ?? "" },
      deadlines,
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
  applyTemplate: z.string().uuid().optional(),
}).strict();

export async function PATCH(request: Request, { params }: Params) {
  try {
    const email = await requireAdmin(request, "events.write");
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
      const nextAdmin = { ...body.admin, documents, payments } as AdminData;
      const beforeVisible = clientVisibleAdmin(event.admin);
      const afterVisible = clientVisibleAdmin(nextAdmin);
      if (JSON.stringify(beforeVisible) !== JSON.stringify(afterVisible)) {
        await audit({
          actorEmail: email,
          action: "planning_content_updated",
          entity: "events",
          subjectId: event.row.id,
          ip: clientIp(request),
          before: beforeVisible,
          after: afterVisible,
        });
      }
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
      const before = event.data[section];
      await saveSection(event, section, next as never);
      await audit({
        actorEmail: email,
        action: "planning_content_updated",
        entity: "events",
        subjectId: event.row.id,
        ip: clientIp(request),
        before: { [section]: before },
        after: { [section]: next },
      });
    }
    if (body.applyTemplate) {
      const template = await getPlanningTemplate(body.applyTemplate);
      if (!template) throw new PlannerError("Template not found.", 404);
      const applied = applyPlanningTemplate(event.data, template);
      const ticked = autoCheck(applied, event.admin);
      const patch = planningPatch(event.data, ticked ?? applied);
      if (Object.keys(patch).length) {
        await saveEvent(event.row.id, { data: patch });
        await audit({
          actorEmail: email,
          action: "planning_template_applied",
          entity: "events",
          subjectId: event.row.id,
          ip: clientIp(request),
          before: { checklist: event.data.checklist, timeline: event.data.timeline, dances: event.data.forms.dances },
          after: patch,
        });
      }
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
      const guestToken = guestAccessToken();
      result.guestPassword = guestPassword;
      result.guestToken = guestToken;
      result.guestPath = guestRequestPath(guestToken);
      await db().batch([
        db().prepare("UPDATE planner_events SET guest_password = ?, guest_access_token = ? WHERE id = ?").bind(guestPassword, guestToken, event.row.id),
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
    const email = await requireAdmin(request, "events.delete");
    const event = await load((await params).id);
    const id = event.row.id;
    const eventId = event.row.event_id;
    if (eventId) {
      const files = await db().prepare("SELECT storage_key FROM stored_files WHERE event_id = ?").bind(eventId).all<{ storage_key: string }>();
      for (const file of files.results) await fileStore().delete(file.storage_key).catch(() => {});
    }
    await db().batch([
      eventId ? db().prepare("DELETE FROM events WHERE id = ?").bind(eventId) : db().prepare("DELETE FROM planner_events WHERE id = ?").bind(id),
      db().prepare("INSERT INTO admin_audit (id, created_at, actor_email, action, entity, subject_id, before_value, after_value) VALUES (?, ?, ?, 'planner_deleted', 'events', ?, ?, NULL)")
        .bind(crypto.randomUUID(), new Date().toISOString(), email, id, JSON.stringify({ code: event.row.code })),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
