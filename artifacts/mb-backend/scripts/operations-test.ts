process.env.DATABASE_URL = "pglite:memory";

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

function hasValue(value: unknown, needle: string): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return String(value) === needle;
  if (typeof value === "string") return value.includes(needle);
  if (Array.isArray(value)) return value.some((item) => hasValue(item, needle));
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).some(([key, item]) => key === needle || hasValue(item, needle));
  return false;
}

const { can } = await import("../lib/authz.ts");
const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const {
  addChecklistItem,
  addRequirement,
  confirmEquipmentCheckout,
  confirmEquipmentReturn,
  createAssignment,
  eventReadiness,
  fileIncident,
  listIncidents,
  reserveEquipment,
  respondToAssignment,
  setRequirementMet,
  staffBrief,
} = await import("../lib/operations.ts");
const { clientView, guestPortalPayload } = await import("../lib/planner-server.ts");
const { newAdminData, newPlannerData } = await import("../lib/planner.ts");

check("staff cannot open office tools", can("staff", "events.read") && !can("staff", "office.access"));

const db = getDatabase();
if (!db) throw new Error("database did not open");

async function person(email: string, name: string) {
  const userId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  await db!.prepare("INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, 'staff')").bind(userId, email, name).run();
  await db!.prepare("INSERT INTO staff (id, user_id, name, email, profile_type) VALUES (?, ?, ?, ?, 'dj')").bind(staffId, userId, name, email).run();
  return { userId, staffId };
}

async function makeEvent(name: string, start: string, end: string) {
  const id = crypto.randomUUID();
  const customerId = await ensureCustomer({ name, email: `${id.slice(0, 8)}@example.com` });
  await createEventRecord({ id, customerId, name, eventType: "Wedding", eventDate: "2030-06-01", startTime: start, endTime: end, guestCount: "40" });
  await db!.prepare("UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE event_id = ?").bind(id).run();
  const window = await db!.prepare("SELECT starts_at, ends_at FROM events WHERE id = ?").bind(id).first<{ starts_at: string | null; ends_at: string | null }>();
  if (!window?.starts_at || !window.ends_at) throw new Error(`event window missing for ${name}`);
  return id;
}

const alex = await person("alex@example.com", "Alex");
const blair = await person("blair@example.com", "Blair");
const wedding = await makeEvent("Alex Wedding", "10:00", "14:00");
const secretEvent = await makeEvent("Other Secret Event", "12:00", "16:00");
const reception = await makeEvent("Alex Reception", "18:00", "22:00");

await db.prepare("UPDATE staff SET rate_cents = 424242 WHERE id = ?").bind(alex.staffId).run();
await db.prepare("UPDATE events SET internal_notes = 'secret-office-note' WHERE id = ?").bind(wedding).run();
await db.prepare("INSERT INTO payments (id, event_id, label, amount_cents) VALUES (?, ?, 'secret-invoice', 636363)").bind(crypto.randomUUID(), wedding).run();

const weddingAssignment = await createAssignment({
  actorRole: "coordinator",
  eventId: wedding,
  staffId: alex.staffId,
  roleLabel: "DJ",
  payoutCents: 515151,
  internalNotes: "secret-office-note",
});
check("overlapping assignment for the same staff member is rejected", await throws(() => createAssignment({
  actorRole: "coordinator",
  eventId: secretEvent,
  staffId: alex.staffId,
  roleLabel: "DJ",
})));
const blairAssignment = await createAssignment({
  actorRole: "coordinator",
  eventId: secretEvent,
  staffId: blair.staffId,
  roleLabel: "MC",
});
check("overlapping assignment for a different person is allowed", Boolean(blairAssignment));
const receptionAssignment = await createAssignment({
  actorRole: "coordinator",
  eventId: reception,
  staffId: alex.staffId,
  roleLabel: "DJ",
});
check("non-overlapping assignment for the same staff member is allowed", Boolean(receptionAssignment));
check("staff cannot assign themselves", await throws(() => createAssignment({
  actorRole: "staff",
  eventId: reception,
  staffId: alex.staffId,
  roleLabel: "Host",
})));

check("staff accepted own assignment", (await respondToAssignment({
  actorUserId: alex.userId,
  actorEmail: "alex@example.com",
  assignmentId: weddingAssignment,
  decision: "accept",
})) === "confirmed");
check("staff declined own assignment", (await respondToAssignment({
  actorUserId: alex.userId,
  actorEmail: "alex@example.com",
  assignmentId: receptionAssignment,
  decision: "decline",
})) === "declined");
check("staff cannot accept someone else's assignment", await throws(() => respondToAssignment({
  actorUserId: blair.userId,
  actorEmail: "blair@example.com",
  assignmentId: weddingAssignment,
  decision: "accept",
})));
check("staff cannot decline someone else's assignment", await throws(() => respondToAssignment({
  actorUserId: blair.userId,
  actorEmail: "blair@example.com",
  assignmentId: receptionAssignment,
  decision: "decline",
})));

const vendorId = crypto.randomUUID();
await db.prepare(
  "INSERT INTO vendors (id, name, category, contact_name, email, phone, notes, relationship_notes) VALUES (?, 'Pat Co', 'photo', 'Pat Partner', 'pat@example.com', '555', 'secret-partner-note', 'secret-partner-note')",
).bind(vendorId).run();
await db.prepare(
  "INSERT INTO event_vendors (id, event_id, vendor_id, role, contact_name, company, phone, email) VALUES (?, ?, ?, 'photo', 'Pat Partner', 'Pat Co', '555', 'pat@example.com')",
).bind(crypto.randomUUID(), wedding, vendorId).run();
await addChecklistItem({ actorRole: "coordinator", eventId: wedding, title: "internal-only-task" });
await fileIncident({
  actorRole: "coordinator",
  actorUserId: blair.userId,
  actorEmail: "blair@example.com",
  eventId: secretEvent,
  body: "secret-other-incident",
});

const now = new Date().toISOString();
await db.prepare(
  `INSERT INTO planner_events (id, created_at, updated_at, code, password_hash, guest_code, guest_password, event_id, data, admin_data)
   VALUES (?, ?, ?, 'MB-OPS', 'hash', 'G-OPS', 'secret', ?, ?::jsonb, '{}'::jsonb)
   ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
).bind(
  wedding,
  now,
  now,
  wedding,
  JSON.stringify({
    timeline: [{ id: "t1", time: "7:00 PM", what: "Grand entrance", song: "Song A", who: "DJ" }],
    songs: [
      { id: "s1", title: "Must-Song", artist: "Artist", kind: "Must play", moment: "Entrance", note: "" },
      { id: "s2", title: "Secret-Do-Not", artist: "X", kind: "Do not play", moment: "", note: "" },
    ],
  }),
).run();

const brief = await staffBrief(alex.userId);
check("staff brief includes the assigned event", brief.events.some((event) => event.id === wedding));
check("staff brief does not include another event", !brief.events.some((event) => event.name === "Other Secret Event") && !hasValue(brief, "secret-other-incident"));
check("staff brief does not include rates", !hasValue(brief, "424242") && !hasValue(brief, "515151"));
check("staff brief does not include invoices", !hasValue(brief, "secret-invoice") && !hasValue(brief, "636363"));
check("staff brief does not include internal notes", !hasValue(brief, "secret-office-note") && !hasValue(brief, "secret-partner-note"));
check("staff brief includes the vendor contact", hasValue(brief, "Pat Partner"));
check("staff brief includes the internal checklist", hasValue(brief, "internal-only-task"));
const weddingBrief = brief.events.find((event) => event.id === wedding);
check("staff brief includes client run-of-show", !!weddingBrief?.runOfShow.timeline.some((item) => item.what === "Grand entrance") && !!weddingBrief?.runOfShow.mustPlay.some((song) => song.title === "Must-Song"), JSON.stringify(weddingBrief?.runOfShow));
check("staff cannot read incidents for another event", await throws(() => listIncidents({ actorRole: "staff", actorUserId: alex.userId, eventId: secretEvent })));

const gear = crypto.randomUUID();
await db.prepare("INSERT INTO equipment (id, name, quantity) VALUES (?, 'Speaker', 1)").bind(gear).run();
const backup = await db.prepare("SELECT backup_equipment_id FROM equipment WHERE id = ?").bind(gear).first<{ backup_equipment_id: string | null }>();
check("backup asset is not auto assigned", backup?.backup_equipment_id === null);
const weddingGear = await reserveEquipment({ actorRole: "coordinator", equipmentId: gear, eventId: wedding, quantity: 1 });
check("overlapping equipment quantity is rejected", await throws(() => reserveEquipment({ actorRole: "coordinator", equipmentId: gear, eventId: secretEvent, quantity: 1 })));
const laterReservation = await reserveEquipment({ actorRole: "coordinator", equipmentId: gear, eventId: reception, quantity: 1 });
check("non-overlapping equipment reservation is allowed", Boolean(laterReservation));
await confirmEquipmentCheckout({
  actorRole: "staff",
  actorUserId: alex.userId,
  actorEmail: "alex@example.com",
  reservationId: weddingGear,
});
await confirmEquipmentReturn({
  actorRole: "staff",
  actorUserId: alex.userId,
  actorEmail: "alex@example.com",
  reservationId: weddingGear,
});
await db.prepare("UPDATE bookings SET status = 'canceled' WHERE event_id = ?").bind(wedding).run();
check("canceled booking does not hold equipment", Boolean(await reserveEquipment({ actorRole: "coordinator", equipmentId: gear, eventId: secretEvent, quantity: 1 })));

check("readiness is unset with no requirements", (await eventReadiness(reception)) === "unset");
const requirementId = await addRequirement({
  actorRole: "coordinator",
  actorEmail: "office@example.com",
  actorUserId: null,
  eventId: reception,
  label: "Spare microphone",
});
check("readiness is not ready while a requirement is open", (await eventReadiness(reception)) === "not_ready");
check("readiness is ready only when every requirement is met", (await setRequirementMet({
  actorRole: "coordinator",
  actorEmail: "office@example.com",
  actorUserId: null,
  requirementId,
  met: true,
})) === "ready");

const ownIncident = await fileIncident({
  actorRole: "staff",
  actorUserId: alex.userId,
  actorEmail: "alex@example.com",
  eventId: wedding,
  body: "Cable failed during soundcheck",
});
check("assigned staff can file an incident", Boolean(ownIncident));
check("staff cannot file an incident for another event", await throws(() => fileIncident({
  actorRole: "staff",
  actorUserId: alex.userId,
  actorEmail: "alex@example.com",
  eventId: secretEvent,
  body: "Should not save",
})));
check("incident reports are append-only", await throws(() => db.prepare("UPDATE incident_reports SET body = 'changed' WHERE id = ?").bind(ownIncident).run()));

async function audited(action: string) {
  const row = await db!.prepare("SELECT id FROM admin_audit WHERE action = ?").bind(action).first<{ id: string }>();
  return Boolean(row);
}
check("assignment accept is audited", await audited("assignment_accepted"));
check("assignment decline is audited", await audited("assignment_declined"));
check("equipment checkout is audited", await audited("equipment_checked_out"));
check("equipment return is audited", await audited("equipment_returned"));
check("incident create is audited", await audited("incident_created"));
check("requirement change is audited", await audited("requirement_updated"));

const planner = newPlannerData({
  clientNames: "Alex",
  email: "alex@example.com",
  phone: "",
  eventType: "Wedding",
  eventDate: "2030-06-01",
  venueName: "",
  guestCount: "40",
});
planner.checklist = [{ id: "client-item", text: "client-portal-checklist-item", due: "", done: false }];
const portalEvent = {
  row: { code: "C", guest_code: "G", guest_password: "pw", guest_access_token: "" },
  data: planner,
  admin: newAdminData(),
} as unknown as Parameters<typeof clientView>[0];
const client = clientView(portalEvent, { requests: [], messages: [] });
const guest = guestPortalPayload(portalEvent, []);
check("client payload does not include internal notes or rates", hasValue(client, "client-portal-checklist-item") && !hasValue(client, "secret-office-note") && !hasValue(client, "424242") && !hasValue(client, "515151") && !hasValue(client, "internal-only-task"));
check("guest payload does not include internal notes or rates", !hasValue(guest, "secret-office-note") && !hasValue(guest, "424242") && !hasValue(guest, "515151") && !hasValue(guest, "internal-only-task") && !hasValue(guest, "secret-invoice"));

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
