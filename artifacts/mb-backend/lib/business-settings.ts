import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type BusinessSettings = {
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  timezone: string;
  oneEventPerDate: boolean;
  requireOwnerConfirm: boolean;
  requireStaffBeforeConfirm: boolean;
  depositDueDays: number | null;
  updatedAt: string | null;
  updatedBy: string;
  ownerEmail: string;
};

const empty: BusinessSettings = {
  companyName: "",
  contactEmail: "",
  contactPhone: "",
  contactAddress: "",
  timezone: "",
  oneEventPerDate: false,
  requireOwnerConfirm: true,
  requireStaffBeforeConfirm: false,
  depositDueDays: null,
  updatedAt: null,
  updatedBy: "",
  ownerEmail: "",
};

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

export function ownerAccountEmail() {
  return (env.MB_ADMIN_EMAIL || "").trim().toLowerCase();
}

export function isValidTimezone(value: string) {
  if (!value) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function mapRow(row: {
  company_name: string;
  contact_email: string;
  contact_phone: string;
  contact_address: string;
  timezone: string;
  one_event_per_date: boolean;
  require_owner_confirm: boolean;
  require_staff_before_confirm: boolean;
  deposit_due_days: number | null;
  updated_at: string | null;
  updated_by: string;
}): BusinessSettings {
  return {
    companyName: row.company_name || "",
    contactEmail: row.contact_email || "",
    contactPhone: row.contact_phone || "",
    contactAddress: row.contact_address || "",
    timezone: row.timezone || "",
    oneEventPerDate: Boolean(row.one_event_per_date),
    requireOwnerConfirm: row.require_owner_confirm !== false,
    requireStaffBeforeConfirm: Boolean(row.require_staff_before_confirm),
    depositDueDays: row.deposit_due_days == null ? null : Number(row.deposit_due_days),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || "",
    ownerEmail: ownerAccountEmail(),
  };
}

export async function getBusinessSettings(): Promise<BusinessSettings> {
  if (!env.DB) return { ...empty, ownerEmail: ownerAccountEmail() };
  const row = await database().prepare(
    `SELECT company_name, contact_email, contact_phone, contact_address, timezone,
            one_event_per_date, require_owner_confirm, require_staff_before_confirm,
            deposit_due_days, updated_at::text AS updated_at, updated_by
     FROM business_settings WHERE id = 'default'`,
  ).first<{
    company_name: string;
    contact_email: string;
    contact_phone: string;
    contact_address: string;
    timezone: string;
    one_event_per_date: boolean;
    require_owner_confirm: boolean;
    require_staff_before_confirm: boolean;
    deposit_due_days: number | null;
    updated_at: string | null;
    updated_by: string;
  }>();
  if (!row) return { ...empty, ownerEmail: ownerAccountEmail() };
  return mapRow(row);
}

export async function saveBusinessSettings(input: {
  companyName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactAddress?: string;
  timezone?: string;
  oneEventPerDate?: boolean;
  requireOwnerConfirm?: boolean;
  requireStaffBeforeConfirm?: boolean;
  depositDueDays?: number | null;
  actorEmail: string;
  ip?: string;
}) {
  const owner = ownerAccountEmail();
  if (!owner || input.actorEmail.toLowerCase() !== owner) {
    throw new AppError("Only the owner can change booking policies and company settings.", 403);
  }
  const before = await getBusinessSettings();
  const companyName = (input.companyName ?? before.companyName).trim().slice(0, 200);
  const contactEmail = (input.contactEmail ?? before.contactEmail).trim().toLowerCase().slice(0, 200);
  if (contactEmail && !contactEmail.includes("@")) throw new AppError("Enter a valid contact email, or leave it blank.", 400);
  const contactPhone = (input.contactPhone ?? before.contactPhone).trim().slice(0, 40);
  const contactAddress = (input.contactAddress ?? before.contactAddress).trim().slice(0, 400);
  const timezone = (input.timezone ?? before.timezone).trim();
  if (timezone && !isValidTimezone(timezone)) throw new AppError("Enter a valid business timezone, such as America/New_York.", 400);
  // Confirmed company policy: always one active hold or confirmed booking per date.
  const oneEventPerDate = true;
  if (!timezone) {
    throw new AppError("Set the business timezone. Date availability uses that timezone.", 400);
  }
  const requireOwnerConfirm = input.requireOwnerConfirm ?? before.requireOwnerConfirm;
  const requireStaffBeforeConfirm = input.requireStaffBeforeConfirm ?? before.requireStaffBeforeConfirm;
  let depositDueDays = input.depositDueDays === undefined ? before.depositDueDays : input.depositDueDays;
  if (depositDueDays != null) {
    if (!Number.isInteger(depositDueDays) || depositDueDays < 0 || depositDueDays > 3650) {
      throw new AppError("Deposit due days must be blank or a whole number of days.", 400);
    }
  }
  await database().prepare(
    `INSERT INTO business_settings (
       id, company_name, contact_email, contact_phone, contact_address, timezone,
       one_event_per_date, require_owner_confirm, require_staff_before_confirm, deposit_due_days, updated_at, updated_by
     ) VALUES (
       'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), ?
     )
     ON CONFLICT (id) DO UPDATE SET
       company_name = excluded.company_name,
       contact_email = excluded.contact_email,
       contact_phone = excluded.contact_phone,
       contact_address = excluded.contact_address,
       timezone = excluded.timezone,
       one_event_per_date = excluded.one_event_per_date,
       require_owner_confirm = excluded.require_owner_confirm,
       require_staff_before_confirm = excluded.require_staff_before_confirm,
       deposit_due_days = excluded.deposit_due_days,
       updated_at = now(),
       updated_by = excluded.updated_by`,
  ).bind(
    companyName,
    contactEmail,
    contactPhone,
    contactAddress,
    timezone,
    oneEventPerDate,
    requireOwnerConfirm,
    requireStaffBeforeConfirm,
    depositDueDays,
    input.actorEmail,
  ).run();
  const after = await getBusinessSettings();
  await audit({
    actorEmail: input.actorEmail,
    action: "settings_changed",
    entity: "business_settings",
    subjectId: "default",
    ip: input.ip,
    before,
    after,
  });
  return after;
}

export async function businessTimezoneOrDefault() {
  const settings = await getBusinessSettings();
  return settings.timezone || "America/New_York";
}

export function depositDueOn(days: number | null, from = new Date()) {
  if (days == null) return null;
  const due = new Date(from);
  due.setUTCDate(due.getUTCDate() + days);
  return due.toISOString().slice(0, 10);
}

// Kept for callers that imported the Phase 02 helper. Always enforces company policy.
export async function assertDateAvailable(eventId: string, eventDate?: string | null) {
  const { assertEventDateAvailable } = await import("@/lib/availability");
  await assertEventDateAvailable(eventId, eventDate);
}
