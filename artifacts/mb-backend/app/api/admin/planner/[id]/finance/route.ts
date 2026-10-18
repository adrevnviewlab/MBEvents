import { z } from "zod";
import { requireActor } from "@/lib/admin";
import { can } from "@/lib/authz";
import {
  deleteEventCost,
  eventBudgetSummary,
  expenseCategories,
  importStaffPayoutCost,
  listAssignablePayouts,
  saveEventCost,
} from "@/lib/event-budget";
import {
  addSchedulePayment,
  applyPlannerReconcile,
  dryRunPlannerReconcile,
  eventLedger,
  MONEY_SOURCE,
  MONEY_SOURCE_DETAIL,
  recordAdjustment,
  recordOfflinePayment,
  sendChangeOrder,
  sendQuote,
  voidDuePayment,
} from "@/lib/finance";
import { fail, PlannerError } from "@/lib/planner-server";
import { clientIp } from "@/lib/request-origin";

type Params = { params: Promise<{ id: string }> };

function eventIdOf(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PlannerError("Invalid event.", 400);
  return id;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const actor = await requireActor(request, "events.read");
    const eventId = eventIdOf((await params).id);
    const canMoney = can(actor.role, "payments.read") || can(actor.role, "proposals.read");
    const ledger = canMoney ? await eventLedger(eventId) : null;
    const budget = can(actor.role, "payments.read") ? await eventBudgetSummary(eventId, actor.role) : null;
    const payouts = can(actor.role, "payments.read") ? await listAssignablePayouts(eventId) : [];
    return Response.json({
      moneySource: MONEY_SOURCE,
      moneyDetail: MONEY_SOURCE_DETAIL,
      ledger,
      budget,
      payoutImports: payouts,
      expenseCategories,
      canQuote: can(actor.role, "proposals.write"),
      canPay: can(actor.role, "payments.write"),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send_quote"), packageId: z.string().uuid(), upgradeIds: z.array(z.string().uuid()).max(40).optional() }),
  z.object({
    action: z.literal("change_order"),
    serviceId: z.string().uuid().nullable().optional(),
    description: z.string().max(200).optional(),
    quantity: z.number().positive().max(1000),
    unitAmountCents: z.number().int().min(0).nullable(),
  }),
  z.object({
    action: z.literal("schedule"),
    label: z.string().trim().min(1).max(120),
    amountCents: z.number().int().positive().max(100_000_000),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    kind: z.enum(["balance", "other"]).optional(),
  }),
  z.object({
    action: z.literal("offline"),
    paymentId: z.string().uuid(),
    method: z.string().trim().min(1).max(80),
    evidenceRef: z.string().trim().min(1).max(120),
    note: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal("reconcile_dry_run") }),
  z.object({ action: z.literal("reconcile_apply"), runId: z.string().uuid(), approve: z.literal(true) }),
  z.object({
    action: z.literal("adjustment"),
    paymentId: z.string().uuid().nullable().optional(),
    kind: z.enum(["refund", "cancellation"]),
    amountCents: z.number().int().positive(),
    note: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal("void"), paymentId: z.string().uuid() }),
  z.object({
    action: z.literal("save_cost"),
    costId: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1).max(200),
    category: z.enum(expenseCategories),
    amountCents: z.number().int().min(0).max(100_000_000),
    estimatedCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    notes: z.string().max(2000).optional(),
    vendorId: z.string().uuid().nullable().optional(),
  }),
  z.object({ action: z.literal("delete_cost"), costId: z.string().uuid() }),
  z.object({ action: z.literal("import_staff_payout"), assignmentId: z.string().uuid() }),
]);

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireActor(request, "office.access");
    const eventId = eventIdOf((await params).id);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) throw new PlannerError("Check the payment details.");
    const body = parsed.data;
    const ip = clientIp(request);
    if (body.action === "send_quote" || body.action === "change_order") {
      if (!can(actor.role, "proposals.write")) throw new PlannerError("You don't have access to that.", 403);
      const result = body.action === "send_quote"
        ? await sendQuote({ eventId, packageId: body.packageId, upgradeIds: body.upgradeIds, actorEmail: actor.email, ip })
        : await sendChangeOrder({ eventId, serviceId: body.serviceId, description: body.description, quantity: body.quantity, unitAmountCents: body.unitAmountCents, actorEmail: actor.email, ip });
      return Response.json(result);
    }
    if (!can(actor.role, "payments.write")) throw new PlannerError("You don't have access to that.", 403);
    if (body.action === "schedule") {
      return Response.json(await addSchedulePayment({
        eventId,
        label: body.label,
        amountCents: body.amountCents,
        dueOn: body.dueOn,
        kind: body.kind,
        actorEmail: actor.email,
        ip,
      }));
    }
    if (body.action === "offline") {
      return Response.json(await recordOfflinePayment({
        eventId,
        paymentId: body.paymentId,
        method: body.method,
        evidenceRef: body.evidenceRef,
        note: body.note,
        actorEmail: actor.email,
        ip,
      }));
    }
    if (body.action === "reconcile_dry_run") {
      return Response.json(await dryRunPlannerReconcile({ eventId, actorEmail: actor.email, ip }));
    }
    if (body.action === "reconcile_apply") {
      return Response.json(await applyPlannerReconcile({
        runId: body.runId,
        approve: true,
        actorEmail: actor.email,
        ip,
      }));
    }
    if (body.action === "void") return Response.json(await voidDuePayment({ eventId, paymentId: body.paymentId, actorEmail: actor.email, ip }));
    if (body.action === "save_cost") {
      const id = await saveEventCost({
        actorRole: actor.role,
        actorEmail: actor.email,
        actorUserId: actor.userId,
        eventId,
        costId: body.costId,
        label: body.label,
        category: body.category,
        amountCents: body.amountCents,
        estimatedCents: body.estimatedCents,
        notes: body.notes,
        vendorId: body.vendorId,
        ip,
      });
      return Response.json({ id, budget: await eventBudgetSummary(eventId, actor.role) });
    }
    if (body.action === "delete_cost") {
      await deleteEventCost({
        actorRole: actor.role,
        actorEmail: actor.email,
        actorUserId: actor.userId,
        eventId,
        costId: body.costId,
        ip,
      });
      return Response.json({ budget: await eventBudgetSummary(eventId, actor.role) });
    }
    if (body.action === "import_staff_payout") {
      const id = await importStaffPayoutCost({
        actorRole: actor.role,
        actorEmail: actor.email,
        actorUserId: actor.userId,
        eventId,
        assignmentId: body.assignmentId,
        ip,
      });
      return Response.json({ id, budget: await eventBudgetSummary(eventId, actor.role) });
    }
    return Response.json(await recordAdjustment({ eventId, paymentId: body.paymentId, kind: body.kind, amountCents: body.amountCents, note: body.note, actorEmail: actor.email, ip }));
  } catch (error) {
    return fail(error);
  }
}
