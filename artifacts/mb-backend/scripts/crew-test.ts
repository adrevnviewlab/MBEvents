process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@crew.test";

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

async function throws(run: () => Promise<unknown>) {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
}

const { can } = await import("../lib/authz.ts");
const { getDatabase } = await import("../lib/env.ts");
const { getBusinessSettings } = await import("../lib/business-settings.ts");
const crew = await import("../lib/crew.ts");
const {
  addPackingItem,
  addStaffBlock,
  confirmEquipmentCheckout,
  createAssignment,
  officeEvent,
  reserveEquipment,
  setPacked,
} = await import("../lib/operations.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const { listEquipmentCatalog } = await import("../lib/office-desk.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");

check("coordinator can read staff roster", can("coordinator", "staff.read"));
check("sales cannot read staff roster", !can("sales", "staff.read"));
check("technician is an approved profile type", crew.profileTypes.includes("technician"));

check("staff is not required before owner confirm by default", (await getBusinessSettings()).requireStaffBeforeConfirm === false);

const techId = await crew.createStaffPerson({
  actorRole: "coordinator",
  name: "Taylor Tech",
  email: "taylor@crew.test",
  phone: "5552000",
  jobTitle: "Lead tech",
  profileType: "technician",
  skills: ["FOH", "Lighting"],
});

const djId = await crew.createStaffPerson({
  actorRole: "coordinator",
  name: "Dana DJ",
  email: "dana@crew.test",
  phone: "5552001",
  profileType: "dj",
  skills: ["Open format"],
});

const roster = await crew.listStaffRoster("coordinator", "taylor");
check("roster lists technician", roster.people.some((person) => person.id === techId && person.profileType === "technician"));
check("roster shows contact to staff readers", roster.people.some((person) => person.id === techId && person.phone === "5552000"));

check("sales cannot open roster", await throws(() => crew.listStaffRoster("sales")));

const customerId = await ensureCustomer({ name: "Crew Client", email: "client@crew.test" });
const eventId = crypto.randomUUID();
await createEventRecord({
  id: eventId,
  customerId,
  name: "Crew Gala",
  eventType: "Gala",
  eventDate: "2038-09-10",
  startTime: "18:00",
  endTime: "23:00",
});
await db.prepare("UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE event_id = ?").bind(eventId).run();
const window = await db.prepare("SELECT starts_at, ends_at FROM events WHERE id = ?").bind(eventId).first<{ starts_at: string; ends_at: string }>();
if (!window?.starts_at || !window?.ends_at) throw new Error("missing event window");

await createAssignment({
  actorRole: "coordinator",
  eventId,
  staffId: techId,
  roleLabel: "Technician",
  startsAt: window.starts_at,
  endsAt: window.ends_at,
  internalNotes: "Run FOH check",
});

await addStaffBlock({
  actorRole: "coordinator",
  actorUserId: "",
  staffId: techId,
  startsAt: window.starts_at,
  endsAt: window.ends_at,
  note: "Personal hold",
});

const profile = await crew.staffProfile("coordinator", techId);
check("staff profile lists event assignment", profile.assignments.some((row) => row.eventId === eventId && row.href.includes("room=staff")));
check("staff profile flags block conflict", profile.conflictCount >= 1 && profile.assignments.some((row) => row.blockConflict));
check("staff profile keeps responsibilities", profile.assignments.some((row) => row.internalNotes.includes("FOH")));

await db.prepare(
  "INSERT INTO event_checklist (id, event_id, title, sort_order, assignee_id) VALUES (?, ?, 'Cue sheets', 1, ?)",
).bind(crypto.randomUUID(), eventId, techId).run();
const withTasks = await crew.staffProfile("coordinator", techId);
check("staff profile lists assigned checklist tasks", withTasks.tasks.some((task) => task.title === "Cue sheets"));

const ops = await officeEvent(eventId, "coordinator");
check("control room shows assignment conflict flag", ops.assignments.some((row) => row.staffId === techId && row.blockConflict));
check("control room links to staff roster", ops.assignments.some((row) => row.profileHref?.includes(techId)));

const categoryId = crypto.randomUUID();
await db.prepare("INSERT INTO equipment_categories (id, name) VALUES (?, 'Audio')").bind(categoryId).run();
const gearId = crypto.randomUUID();
await db.prepare(
  "INSERT INTO equipment (id, name, category, category_id, quantity) VALUES (?, 'Mixer', 'Audio', ?, 2)",
).bind(gearId, categoryId).run();

const reservationId = await reserveEquipment({
  actorRole: "coordinator",
  equipmentId: gearId,
  eventId,
  quantity: 1,
});
await confirmEquipmentCheckout({
  actorRole: "coordinator",
  actorUserId: "",
  actorEmail: "owner@crew.test",
  reservationId,
});
const packingId = await addPackingItem({ actorRole: "coordinator", reservationId, label: "XLR snakes" });
await setPacked({ actorRole: "coordinator", actorUserId: "", itemId: packingId, packed: true });

const catalog = await listEquipmentCatalog("coordinator");
check("equipment catalog reports reserved quantity", catalog.assets.some((asset) => asset.id === gearId && asset.reservedQuantity === 1 && asset.availableHint === 1));

const asset = await crew.equipmentAssetProfile("coordinator", gearId);
check("equipment profile lists event reservation", asset.reservations.some((row) => row.eventId === eventId && row.status === "out"));
check("equipment profile packing summary", asset.packingSummary.total === 1 && asset.packingSummary.packed === 1);
check("equipment profile links to control room", asset.reservations.some((row) => row.href.includes("room=equipment")));

const opsGear = await officeEvent(eventId, "coordinator");
check("control room equipment summary includes checkout", opsGear.reservations.some((row) => row.id === reservationId && row.checked_out_at));
check("control room packing checklist present", opsGear.packing.some((row) => row.label === "XLR snakes" && row.packed));

await crew.saveStaffPerson({
  actorRole: "coordinator",
  staffId: djId,
  name: "Dana DJ",
  email: "dana@crew.test",
  phone: "5552999",
  profileType: "dj",
  skills: ["Open format", "Weddings"],
  active: true,
});
const dj = await crew.staffProfile("coordinator", djId);
check("staff contact can be updated", dj.phone === "5552999" && dj.skills.includes("Weddings"));

check("invalid profile type rejected", await throws(() => crew.createStaffPerson({
  actorRole: "coordinator",
  name: "Bad Role",
  profileType: "ninja",
})));

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
