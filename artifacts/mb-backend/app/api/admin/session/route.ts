import { getActor } from "@/lib/admin";
import { can, type Permission } from "@/lib/authz";

const navPermissions = [
  "office.access",
  "events.read",
  "events.write",
  "leads.read",
  "customers.read",
  "users.manage",
  "staff.read",
  "equipment.read",
  "venues.read",
  "vendors.read",
  "proposals.read",
  "payments.read",
  "invitations.read",
  "automations.read",
  "settings.read",
  "bookings.write",
  "tasks.read",
  "tasks.write",
] as const satisfies readonly Permission[];

export async function GET() {
  const actor = await getActor();
  if (!actor) return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const permissions: Record<string, boolean> = {};
  for (const permission of navPermissions) permissions[permission] = can(actor.role, permission);
  return Response.json({
    ok: true,
    email: actor.email,
    role: actor.role,
    permissions,
  }, { headers: { "Cache-Control": "no-store" } });
}
