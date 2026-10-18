import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { can } from "@/lib/authz";
import {
  approveCatalogPrice,
  listPackages,
  listPricingRules,
  listServices,
  publishCatalogPrice,
  removeUpgrade,
  savePackage,
  savePricingRule,
  saveService,
  saveUpgrade,
  unpublishCatalogPrice,
} from "@/lib/finance";
import { fail } from "@/lib/planner-server";
import { clientIp } from "@/lib/request-origin";

const price = z.number().int().min(0).nullable();

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "office.access");
    const services = can(actor.role, "services.read") ? await listServices() : [];
    const packages = can(actor.role, "packages.read") ? await listPackages() : [];
    const rules = can(actor.role, "payments.read") ? await listPricingRules() : [];
    return Response.json({
      services,
      packages,
      rules,
      canEditServices: can(actor.role, "services.write"),
      canEditPackages: can(actor.role, "packages.write"),
      canEditRules: can(actor.role, "payments.write"),
      canPublish: can(actor.role, "prices.publish"),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_service"), id: z.string().uuid().optional(), name: z.string().trim().min(2).max(200), description: z.string().max(2000).optional(), priceCents: price, active: z.boolean().optional() }),
  z.object({ action: z.literal("save_package"), id: z.string().uuid().optional(), name: z.string().trim().min(2).max(200), description: z.string().max(2000).optional(), priceCents: price, active: z.boolean().optional() }),
  z.object({ action: z.literal("save_upgrade"), packageId: z.string().uuid(), serviceId: z.string().uuid(), optional: z.boolean() }),
  z.object({ action: z.literal("remove_upgrade"), packageId: z.string().uuid(), serviceId: z.string().uuid() }),
  z.object({ action: z.literal("approve_price"), kind: z.enum(["package", "service"]), id: z.string().uuid() }),
  z.object({ action: z.literal("publish_price"), kind: z.enum(["package", "service"]), id: z.string().uuid() }),
  z.object({ action: z.literal("unpublish_price"), kind: z.enum(["package", "service"]), id: z.string().uuid() }),
  z.object({
    action: z.literal("save_rule"),
    id: z.string().uuid().optional(),
    kind: z.enum(["overtime", "travel", "setup", "discount", "adjustment", "tax", "deposit"]),
    label: z.string().trim().min(1).max(120),
    amountCents: price,
    percent: z.number().min(0).max(100).nullable(),
    active: z.boolean(),
    includedMinutes: z.number().int().min(0).nullable().optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request, "office.access");
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Check the catalog details." }, { status: 400 });
    const body = parsed.data;
    const ip = clientIp(request);
    if (body.action === "save_service") {
      if (!can(actor.role, "services.write")) return Response.json({ error: "You don't have access to that." }, { status: 403 });
      return Response.json(await saveService({ ...body, actorEmail: actor.email, ip }));
    }
    if (body.action === "save_package") {
      if (!can(actor.role, "packages.write")) return Response.json({ error: "You don't have access to that." }, { status: 403 });
      return Response.json(await savePackage({ ...body, actorEmail: actor.email, ip }));
    }
    if (body.action === "save_upgrade" || body.action === "remove_upgrade") {
      if (!can(actor.role, "packages.write")) return Response.json({ error: "You don't have access to that." }, { status: 403 });
      if (body.action === "save_upgrade") await saveUpgrade({ ...body, actorEmail: actor.email, ip });
      else await removeUpgrade({ ...body, actorEmail: actor.email, ip });
      return Response.json({ ok: true });
    }
    if (body.action === "approve_price" || body.action === "publish_price" || body.action === "unpublish_price") {
      if (!can(actor.role, "prices.publish")) return Response.json({ error: "You don't have access to that." }, { status: 403 });
      if (body.action === "approve_price") return Response.json(await approveCatalogPrice({ ...body, actorEmail: actor.email, ip }));
      if (body.action === "publish_price") return Response.json(await publishCatalogPrice({ ...body, actorEmail: actor.email, ip }));
      return Response.json(await unpublishCatalogPrice({ ...body, actorEmail: actor.email, ip }));
    }
    if (!can(actor.role, "payments.write")) return Response.json({ error: "You don't have access to that." }, { status: 403 });
    return Response.json(await savePricingRule({ ...body, actorEmail: actor.email, ip }));
  } catch (error) {
    return fail(error);
  }
}
