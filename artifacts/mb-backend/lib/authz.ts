// Office, client, and guest permissions. "*" is the admin wildcard.
// Existing staff logins are migrated as coordinator, which matches their current access.
// The staff role can be assigned later to people who should not open office tools.

import { AppError } from "@/lib/errors";

export const roles = ["admin", "manager", "sales", "coordinator", "staff", "client", "guest"] as const;
export type Role = (typeof roles)[number];

export const officeRoles = ["admin", "manager", "sales", "coordinator"] as const;

const all = [
  "office.access",
  "users.manage",
  "audit.read",
  "customers.read",
  "customers.write",
  "leads.read",
  "leads.write",
  "events.read",
  "events.write",
  "events.delete",
  "bookings.read",
  "bookings.write",
  "venues.read",
  "venues.write",
  "vendors.read",
  "vendors.write",
  "services.read",
  "services.write",
  "packages.read",
  "packages.write",
  "prices.publish",
  "settings.read",
  "settings.write",
  "proposals.read",
  "proposals.write",
  "contracts.read",
  "contracts.write",
  "payments.read",
  "payments.write",
  "invitations.read",
  "invitations.write",
  "guests.read",
  "guests.write",
  "tasks.read",
  "tasks.write",
  "equipment.read",
  "equipment.write",
  "assignments.read",
  "assignments.write",
  "notifications.read",
  "notifications.write",
  "automations.read",
  "automations.write",
  "files.read",
  "files.write",
  "staff.read",
  "portal.client",
  "portal.guest",
  "rsvp.write",
  "songs.request",
] as const;

export type Permission = (typeof all)[number];

export const rolePermissions: Record<Role, readonly string[]> = {
  admin: ["*"],
  manager: all.filter((permission) =>
    permission !== "users.manage"
    && permission !== "settings.write"
    && permission !== "prices.publish"
    && !permission.startsWith("portal.")
    && permission !== "rsvp.write"
    && permission !== "songs.request"
  ),
  sales: [
    "office.access",
    "settings.read",
    "customers.read",
    "customers.write",
    "leads.read",
    "leads.write",
    "events.read",
    "events.write",
    "bookings.read",
    "packages.read",
    "services.read",
    "proposals.read",
    "proposals.write",
    "payments.read",
    "venues.read",
    "vendors.read",
    "automations.read",
    "notifications.read",
    "tasks.read",
    "tasks.write",
  ],
  coordinator: [
    "office.access",
    "settings.read",
    "customers.read",
    "leads.read",
    "leads.write",
    "events.read",
    "events.write",
    "events.delete",
    "bookings.read",
    "bookings.write",
    "venues.read",
    "venues.write",
    "vendors.read",
    "vendors.write",
    "tasks.read",
    "tasks.write",
    "guests.read",
    "guests.write",
    "invitations.read",
    "invitations.write",
    "equipment.read",
    "equipment.write",
    "assignments.read",
    "assignments.write",
    "files.read",
    "files.write",
    "notifications.read",
    "notifications.write",
    "automations.read",
    "automations.write",
    "staff.read",
    "contracts.read",
    "payments.read",
  ],
  staff: ["events.read", "tasks.read", "assignments.read", "files.read", "guests.read"],
  client: ["portal.client", "events.read", "guests.read", "guests.write", "contracts.read", "payments.read", "files.read"],
  guest: ["portal.guest", "rsvp.write", "songs.request"],
};

export function isRole(value: string): value is Role {
  return (roles as readonly string[]).includes(value);
}

export function can(role: Role, permission: string) {
  const granted = rolePermissions[role];
  return granted.includes("*") || granted.includes(permission);
}

export function assertCan(role: Role, permission: string) {
  if (!can(role, permission)) throw new AppError("You don't have access to that.", 403);
}
