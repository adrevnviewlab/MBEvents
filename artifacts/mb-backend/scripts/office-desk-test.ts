process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@desk.test";
delete process.env.RESEND_API_KEY;

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const { createInquiry, addLeadTask, bookLead } = await import("../lib/crm.ts");
const { leadSchema } = await import("../lib/lead.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const { setBookingHold } = await import("../lib/calendar.ts");
const {
  approveCatalogPrice,
  publishCatalogPrice,
  savePackage,
  savePricingRule,
  sendQuote,
  acceptProposal,
} = await import("../lib/finance.ts");
const { buildOwnerDesk, listCustomers, listEquipmentCatalog } = await import("../lib/office-desk.ts");
const { addEquipmentCategory, addEquipmentAsset, addChecklistItem, setChecklistDone, officeEvent } = await import("../lib/operations.ts");
const { can } = await import("../lib/authz.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const owner = { email: "owner@desk.test", userId: null as string | null };

await saveBusinessSettings({ companyName: "MB Events", timezone: "America/New_York", actorEmail: owner.email });

const empty = await buildOwnerDesk("admin");
check("empty desk has zero queues", Object.values(empty.counts).every((n) => n === 0), JSON.stringify(empty.counts));

const lead = await createInquiry(leadSchema.parse({
  source: "contact",
  name: "Dana Desk",
  email: "dana-desk@example.com",
  phone: "5550707",
  eventType: "Wedding",
  eventDate: "2038-06-01",
  services: [],
}));
await addLeadTask(lead.id, { title: "Call Dana", dueOn: "2000-01-01", assigneeId: null }, owner);

const booked = await bookLead({
  leadId: lead.id,
  actor: owner,
  details: {
    clientNames: "Dana Desk",
    email: "dana-desk@example.com",
    phone: "5550707",
    eventType: "Wedding",
    eventDate: "2038-06-01",
    venueName: "Hall",
    guestCount: "80",
  },
});

await setBookingHold(booked.id, owner, new Date(Date.now() + 86400000).toISOString());

const pkg = await savePackage({ name: "Desk Pack", priceCents: 10000, actorEmail: owner.email });
await approveCatalogPrice({ kind: "package", id: pkg.id, actorEmail: owner.email });
await publishCatalogPrice({ kind: "package", id: pkg.id, actorEmail: owner.email });
await savePricingRule({ kind: "deposit", label: "Desk deposit", amountCents: 2500, percent: null, active: true, actorEmail: owner.email });
await sendQuote({ eventId: booked.id, packageId: pkg.id, actorEmail: owner.email });
await acceptProposal({ eventId: booked.id, acceptedBy: "Dana Desk", actorEmail: "dana-desk@example.com" });

await db.prepare(
  `UPDATE planner_events
   SET admin_data = jsonb_set(coalesce(admin_data, '{}'::jsonb), '{documents}', ?::jsonb, true)
   WHERE event_id = ?`,
).bind(JSON.stringify([{ id: "doc1", title: "Agreement", body: "x", status: "sent", createdAt: "", signedName: "", signature: "", signedAt: "", signedIp: "" }]), booked.id).run();

const desk = await buildOwnerDesk("admin");
check("new lead appears", desk.counts.newLeads >= 1);
check("upcoming event appears", desk.counts.upcoming >= 1);
check("active hold appears", desk.counts.activeHolds >= 1);
check("deposit due appears", desk.counts.depositsDue >= 1);
check("urgent task appears", desk.counts.urgentTasks >= 1);
check("unsigned contract appears", desk.counts.unsignedContracts >= 1, JSON.stringify(desk.unsignedContracts));
check("desk links into planner control room", desk.upcoming[0]?.href.includes("/admin/planner/"), desk.upcoming[0]?.href);

const customers = await listCustomers("admin", "dana");
check("customer directory finds client", customers.length === 1 && customers[0]?.eventCount >= 1, JSON.stringify(customers));
check("customer has planner link", !!customers[0]?.latestPlannerId);

const catId = await addEquipmentCategory({ actorRole: "admin", name: "Lighting" });
await addEquipmentAsset({ actorRole: "admin", name: "Wash light", categoryId: catId, quantity: 4 });
const catalog = await listEquipmentCatalog("admin", "wash");
check("equipment catalog lists asset", catalog.assets.length === 1 && catalog.assets[0]?.name === "Wash light");
check("sales cannot read equipment catalog", !(await (async () => {
  try {
    await listEquipmentCatalog("sales");
    return true;
  } catch {
    return false;
  }
})()));

check("sales cannot manage users nav permission", !can("sales", "users.manage") && can("sales", "customers.read"));
check("staff cannot open office", !can("staff", "office.access") && can("coordinator", "equipment.read"));

await addChecklistItem({ actorRole: "admin", eventId: booked.id, title: "Load cases" });
const before = await officeEvent(booked.id, "admin");
const item = before.checklist[0];
check("checklist item created", !!item?.id && item.done === false);
if (item) {
  await setChecklistDone({ actorRole: "admin", actorUserId: "", itemId: item.id, done: true });
  const after = await officeEvent(booked.id, "admin");
  check("office can toggle checklist", after.checklist.some((row) => row.id === item.id && row.done === true));
}

const failed = results.filter((result) => !result.pass);
for (const result of results) {
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
