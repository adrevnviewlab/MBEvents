process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@settings.test";

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

async function throws(run: () => Promise<unknown>, part = "") {
  try {
    await run();
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return !part || message.includes(part);
  }
}

const { getDatabase } = await import("../lib/env.ts");
const { can } = await import("../lib/authz.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const { getBusinessSettings, saveBusinessSettings, depositDueOn } = await import("../lib/business-settings.ts");
const { approveCatalogPrice, publishCatalogPrice, savePackage, sendQuote } = await import("../lib/finance.ts");
const { confirmBooking, setBookingHold } = await import("../lib/calendar.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");

const owner = "owner@settings.test";
const staff = { email: "staff@settings.test", userId: null };

check("manager cannot publish prices", !can("manager", "prices.publish"));
check("manager cannot write booking policies", !can("manager", "settings.write"));
check("coordinator cannot write booking policies", !can("coordinator", "settings.write"));
check("admin can write booking policies", can("admin", "settings.write") && can("admin", "prices.publish"));

const initial = await getBusinessSettings();
check("settings row starts empty", initial.companyName === "" && initial.timezone === "" && initial.requireOwnerConfirm === true && initial.requireStaffBeforeConfirm === false && initial.depositDueDays === null, JSON.stringify(initial));
check("owner email comes from MB_ADMIN_EMAIL", initial.ownerEmail === owner);

check("staff cannot save settings", await throws(() => saveBusinessSettings({ companyName: "Nope", timezone: "America/New_York", actorEmail: staff.email }), "owner"));
check("company settings need a timezone", await throws(() => saveBusinessSettings({ companyName: "Nope", actorEmail: owner }), "timezone"));

const saved = await saveBusinessSettings({
  companyName: "Michael Bryan Events",
  contactPhone: "(855) 627-6863",
  timezone: "America/New_York",
  requireOwnerConfirm: true,
  requireStaffBeforeConfirm: false,
  depositDueDays: 7,
  actorEmail: owner,
});
check("owner can save company settings", saved.companyName === "Michael Bryan Events" && saved.timezone === "America/New_York" && saved.oneEventPerDate && saved.depositDueDays === 7);

const audit = await db.prepare("SELECT action, entity FROM admin_audit WHERE entity = 'business_settings' ORDER BY created_at DESC LIMIT 1")
  .first<{ action: string; entity: string }>();
check("settings changes are audited", audit?.action === "settings_changed" && audit.entity === "business_settings");

const again = await getBusinessSettings();
check("settings survive a new read", again.companyName === "Michael Bryan Events" && again.oneEventPerDate && again.depositDueDays === 7);

check("deposit due helper adds days", depositDueOn(7, new Date("2026-10-01T12:00:00Z")) === "2026-10-08");
check("blank deposit due stays blank", depositDueOn(null) === null);

const customerA = await ensureCustomer({ name: "Alpha", email: "alpha-settings@example.com", phone: "" });
const customerB = await ensureCustomer({ name: "Beta", email: "beta-settings@example.com", phone: "" });
const first = crypto.randomUUID();
const second = crypto.randomUUID();
await createEventRecord({ id: first, customerId: customerA, name: "Alpha", eventType: "Wedding", eventDate: "2033-08-12", startTime: "4:00 PM", endTime: "11:00 PM" });
await setBookingHold(first, { email: owner, userId: null }, new Date(Date.now() + 86400000).toISOString());
await createEventRecord({
  id: second,
  customerId: customerB,
  name: "Beta",
  eventType: "Wedding",
  eventDate: "2033-08-12",
  startTime: "5:00 PM",
  endTime: "10:00 PM",
});
check("second hold on the same date is refused", await throws(
  () => setBookingHold(second, { email: owner, userId: null }, new Date(Date.now() + 86400000).toISOString()),
  "already reserved",
));

const open = crypto.randomUUID();
await createEventRecord({ id: open, customerId: customerB, name: "Open", eventType: "Wedding", eventDate: "2033-08-19", startTime: "4:00 PM", endTime: "11:00 PM" });
await setBookingHold(open, { email: owner, userId: null }, new Date(Date.now() + 86400000).toISOString());
check("staff cannot confirm when owner approval is required", await throws(() => confirmBooking(open, staff), "owner"));
await confirmBooking(open, { email: owner, userId: null });
const confirmed = await db.prepare("SELECT status FROM bookings WHERE event_id = ?").bind(open).first<{ status: string }>();
check("owner can confirm", confirmed?.status === "confirmed");

const draft = await savePackage({ name: "Draft Party", priceCents: 50000, actorEmail: owner });
check("draft package is not quoted", await throws(() => sendQuote({ eventId: open, packageId: draft.id, actorEmail: owner }), "Approve and publish"));
await approveCatalogPrice({ kind: "package", id: draft.id, actorEmail: owner });
check("approved unpublished package is not quoted", await throws(() => sendQuote({ eventId: open, packageId: draft.id, actorEmail: owner }), "Approve and publish"));
await publishCatalogPrice({ kind: "package", id: draft.id, actorEmail: owner });
const quoted = await sendQuote({ eventId: open, packageId: draft.id, actorEmail: owner });
check("published package quotes the stored price", quoted.invoiceTotalCents === 50000, JSON.stringify(quoted));
check("no deposit suggestion without a deposit rule", quoted.deposit === null, JSON.stringify(quoted.deposit));

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
