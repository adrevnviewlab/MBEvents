import { getActor } from "@/lib/admin";
import { assertCan, can } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import {
  addGuest,
  assignGuestsToTable,
  centralEventId,
  checkIn,
  createTable,
  deleteGuest,
  deleteTable,
  invitationView,
  listTables,
  publicGallery,
  publicInvitation,
  readHostMedia,
  reviewGuestMedia,
  rotateGuestLink,
  rsvp,
  runDueMessageJobs,
  saveInvitation,
  scheduleMessage,
  staffAssigned,
  updateGuest,
  updateTable,
  uploadGuestMedia,
  type GuestListViewer,
} from "@/lib/invites";
import { assertWriteOrigin, fail, PlannerError, readJson, sessionEvent } from "@/lib/planner-server";
import { clientIp, publicOrigin } from "@/lib/request-origin";

export type InviteCtx = {
  eventId: string;
  email: string;
  userId?: string | null;
  ip?: string;
  viewer: GuestListViewer;
};

const noStore = { headers: { "Cache-Control": "no-store" } };

function assertManage(ctx: InviteCtx) {
  if (ctx.viewer.kind === "staff" || ctx.viewer.kind === "guest") throw new AppError("You don't have access to that.", 403);
}

export async function hostContext(request: Request, write: boolean): Promise<InviteCtx> {
  if (write) assertWriteOrigin(request);
  const event = await sessionEvent(request, "client");
  assertCan("client", "portal.client");
  assertCan("client", write ? "guests.write" : "guests.read");
  const email = event.data.details.email.includes("@") ? event.data.details.email : "client";
  const eventId = event.row.event_id;
  if (!eventId) throw new PlannerError("You don't have access to that.", 404);
  return { eventId, email, ip: clientIp(request), viewer: { kind: "host" } };
}

export async function officeContext(request: Request, rawId: string, write: boolean): Promise<InviteCtx> {
  if (write) assertWriteOrigin(request);
  const actor = await getActor();
  if (!actor) throw new PlannerError("Please sign in.", 401);
  const eventId = await centralEventId(rawId);
  if (actor.role === "staff") {
    if (write || !can(actor.role, "guests.read") || !(await staffAssigned(actor.userId, eventId))) {
      throw new PlannerError("You don't have access to that.", 403);
    }
    return { eventId, email: actor.email, userId: actor.userId, ip: clientIp(request), viewer: { kind: "staff" } };
  }
  if (!can(actor.role, "office.access") || !can(actor.role, "events.read")) throw new PlannerError("You don't have access to that.", 403);
  if (write) {
    if (!can(actor.role, "invitations.write")) throw new PlannerError("You don't have access to that.", 403);
  } else if (!can(actor.role, "invitations.read") && !can(actor.role, "guests.read")) {
    throw new PlannerError("You don't have access to that.", 403);
  }
  return { eventId, email: actor.email, userId: actor.userId, ip: clientIp(request), viewer: { kind: "office" } };
}

export function invitationResponse(ctx: InviteCtx) {
  return invitationView(ctx.eventId, ctx.viewer).then((view) => Response.json(view, noStore));
}

export async function patchInvitation(ctx: InviteCtx, request: Request) {
  assertManage(ctx);
  const saved = await saveInvitation(ctx.eventId, await readJson(request), { email: ctx.email, ip: ctx.ip });
  return Response.json({ invitation: saved });
}

export async function postGuest(ctx: InviteCtx, request: Request) {
  assertManage(ctx);
  const created = await addGuest(ctx.eventId, await readJson(request), publicOrigin(request));
  return Response.json(created, { status: 201 });
}

export async function patchGuest(ctx: InviteCtx, guestId: string, request: Request) {
  assertManage(ctx);
  return Response.json(await updateGuest(ctx.eventId, guestId, await readJson(request)));
}

export async function removeGuest(ctx: InviteCtx, guestId: string) {
  assertManage(ctx);
  await deleteGuest(ctx.eventId, guestId, { email: ctx.email, ip: ctx.ip });
  return Response.json({ ok: true });
}

export async function rotateGuest(ctx: InviteCtx, guestId: string, request: Request) {
  assertManage(ctx);
  return Response.json(await rotateGuestLink(ctx.eventId, guestId, publicOrigin(request)));
}

export async function tablesResponse(ctx: InviteCtx) {
  return Response.json({ tables: await listTables(ctx.eventId) }, noStore);
}

export async function postTable(ctx: InviteCtx, request: Request) {
  assertManage(ctx);
  return Response.json(await createTable(ctx.eventId, await readJson(request)), { status: 201 });
}

export async function patchTable(ctx: InviteCtx, tableId: string, request: Request) {
  assertManage(ctx);
  return Response.json(await updateTable(ctx.eventId, tableId, await readJson(request)));
}

export async function removeTable(ctx: InviteCtx, tableId: string) {
  assertManage(ctx);
  return Response.json(await deleteTable(ctx.eventId, tableId));
}

export async function postAssign(ctx: InviteCtx, request: Request) {
  assertManage(ctx);
  return Response.json(await assignGuestsToTable(ctx.eventId, await readJson(request)));
}

export async function postMediaReview(ctx: InviteCtx, request: Request) {
  assertManage(ctx);
  const body = (await readJson(request)) as { id?: unknown; status?: unknown };
  if (body.status !== "approved" && body.status !== "rejected") throw new AppError("Choose approve or reject.", 400);
  if (typeof body.id !== "string") throw new AppError("Photo not found.", 404);
  return Response.json(await reviewGuestMedia(ctx.eventId, body.id, body.status, { email: ctx.email, ip: ctx.ip }));
}

export async function postJob(ctx: InviteCtx, input: unknown) {
  assertManage(ctx);
  return Response.json(await scheduleMessage(ctx.eventId, input), { status: 201 });
}

export async function postJobRun(ctx: InviteCtx) {
  assertManage(ctx);
  return Response.json(await runDueMessageJobs(ctx.eventId));
}

export async function publicInviteResponse(slug: string, token: string) {
  return Response.json(await publicInvitation(slug, token), noStore);
}

export async function publicRsvp(request: Request) {
  const body = (await readJson(request)) as { token?: unknown };
  const token = String(body.token ?? "");
  return Response.json(await rsvp(token, body));
}

export async function publicCheckIn(request: Request) {
  const body = (await readJson(request)) as { token?: unknown; code?: unknown };
  const secret = String(body.token || body.code || "");
  return Response.json(await checkIn(secret, { email: "guest-check-in", ip: clientIp(request) }));
}

export async function hostMediaFile(ctx: InviteCtx, fileId: string) {
  if (ctx.viewer.kind === "guest") throw new AppError("You don't have access to that.", 403);
  const file = await readHostMedia(ctx.eventId, fileId);
  const inline = file.contentType.startsWith("image/") || file.contentType.startsWith("video/");
  const copy = new ArrayBuffer(file.bytes.byteLength);
  new Uint8Array(copy).set(file.bytes);
  return new Response(copy, {
    headers: {
      "Content-Type": file.contentType || "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function publicMediaUpload(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const token = String(form.get("token") ?? "");
  if (!(file instanceof File)) throw new AppError("Choose a photo or video.", 400);
  const saved = await uploadGuestMedia(token, { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, contentType: file.type || "" });
  return Response.json(saved, { status: 201 });
}

export async function publicGalleryResponse(slug: string, token: string) {
  return Response.json({ media: await publicGallery(slug, token) }, noStore);
}

export { fail };
