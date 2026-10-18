process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "calendar@example.com";

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

async function throwsMessage(run: () => Promise<unknown>, part: string) {
  try {
    await run();
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(part) ? message : `unexpected: ${message}`;
  }
}

const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const {
  assignStaff,
  cancelBooking,
  confirmBooking,
  getBooking,
  listCalendar,
  reserveEquipment,
  rescheduleBooking,
  setBookingHold,
} = await import("../lib/calendar.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");

await saveBusinessSettings({
  companyName: "MB Events",
  timezone: "America/New_York",
  actorEmail: "calendar@example.com",
});

const actor = { email: "calendar@example.com", userId: null };
let day = 1;
const nextDate = () => {
  const date = `2032-06-${String(day).padStart(2, "0")}`;
  day += 1;
  return date;
};
const futureHold = () => new Date(Date.now() + 3 * 86400000).toISOString();
const pastHold = () => new Date(Date.now() - 3600000).toISOString();

async function staff(name: string) {
  const id = crypto.randomUUID();
  await db!.prepare("INSERT INTO staff (id, name) VALUES (?, ?)").bind(id, name).run();
  return id;
}

async function gear(name: string, quantity: number) {
  const id = crypto.randomUUID();
  await db!.prepare("INSERT INTO equipment (id, name, quantity) VALUES (?, ?, ?)").bind(id, name, quantity).run();
  return id;
}

async function eventAt(label: string, date: string, start: string, end: string, timezone = "America/New_York") {
  const customerId = await ensureCustomer({ name: label, email: "", phone: "" });
  const id = crypto.randomUUID();
  await createEventRecord({ id, customerId, name: label, eventType: "Wedding", eventDate: date, startTime: start, endTime: end });
  await db!.prepare("UPDATE events SET timezone = ? WHERE id = ?").bind(timezone, id).run();
  return id;
}

async function holdAndConfirm(id: string) {
  await setBookingHold(id, actor, futureHold());
  await confirmBooking(id, actor);
}

async function windowOf(id: string) {
  return db!.prepare(
    "SELECT start_time, end_time, timezone, starts_at, setup_minutes, travel_buffer_minutes FROM events WHERE id = ?",
  ).bind(id).first<{ start_time: string; end_time: string; timezone: string; starts_at: string | null; setup_minutes: number | null; travel_buffer_minutes: number }>();
}

const created = await eventAt("New", nextDate(), "", "");
const fresh = await db.prepare("SELECT status, confirmed_at FROM bookings WHERE event_id = ?").bind(created).first<{ status: string; confirmed_at: string | null }>();
check("create stays tentative", fresh?.status === "tentative" && !fresh.confirmed_at, JSON.stringify(fresh));

const parsed = await eventAt("Clock", "2030-07-04", "4:00 PM", "11:00 PM");
const clock = await windowOf(parsed);
check("timezone stored and wall clock kept", clock?.timezone === "America/New_York" && clock.start_time === "4:00 PM" && clock.starts_at?.startsWith("2030-07-04T20:00"), JSON.stringify(clock));
check("travel buffer stays zero", clock?.travel_buffer_minutes === 0, String(clock?.travel_buffer_minutes));

const sameDay = nextDate();
const morningStaff = await staff("Morning");
const eveningStaff = await staff("Evening");
const morning = await eventAt("Morning", sameDay, "10:00", "12:00");
const evening = await eventAt("Evening", sameDay, "13:00", "15:00");
await holdAndConfirm(morning);
await assignStaff(morning, actor, morningStaff, "DJ");
const sameDateSecond = await throwsMessage(() => setBookingHold(evening, actor, futureHold()), "already reserved");
check("same date with different people is refused once the date is reserved", sameDateSecond.includes("already reserved"), sameDateSecond);
await assignStaff(evening, actor, eveningStaff, "DJ");
check("second event may still exist without reserving the date", true);

const clashDate = nextDate();
const shared = await staff("Shared");
const first = await eventAt("First", clashDate, "18:00", "22:00");
const second = await eventAt("Second", clashDate, "19:00", "21:00");
await holdAndConfirm(first);
await assignStaff(first, actor, shared, "DJ");
const staffOverlap = await throwsMessage(() => assignStaff(second, actor, shared, "DJ"), "already reserved");
check("overlapping staff is rejected", staffOverlap.includes("already reserved"), staffOverlap);

const speakers = await gear("Speakers", 1);
await reserveEquipment(first, actor, speakers, 1);
const gearOverlap = await throwsMessage(() => reserveEquipment(second, actor, speakers, 1), "already reserved");
check("overlapping equipment is rejected", gearOverlap.includes("already reserved"), gearOverlap);

const otherGear = await gear("Lights", 1);
await reserveEquipment(second, actor, otherGear, 1);
check("different equipment on a reserved date is allowed for a non-blocking event", true);

const touchDate = nextDate();
const touch = await eventAt("Touch", touchDate, "22:00", "23:00");
const earlier = await eventAt("Earlier", touchDate, "18:00", "22:00");
await holdAndConfirm(earlier);
await assignStaff(earlier, actor, shared, "DJ");
const touchHold = await throwsMessage(() => setBookingHold(touch, actor, futureHold()), "already reserved");
check("back-to-back windows still cannot both reserve the same date", touchHold.includes("already reserved"), touchHold);

const expiredDate = nextDate();
const held = await staff("Held");
const expired = await eventAt("Expired", expiredDate, "12:00", "14:00");
const afterExpired = await eventAt("After expired", expiredDate, "12:00", "14:00");
await setBookingHold(expired, actor, pastHold());
await assignStaff(expired, actor, held, "DJ");
await holdAndConfirm(afterExpired);
await assignStaff(afterExpired, actor, held, "DJ");
check("expired tentative hold does not block", true);

const liveDate = nextDate();
const livePerson = await staff("Live");
const live = await eventAt("Live hold", liveDate, "12:00", "14:00");
const blocked = await eventAt("Blocked", liveDate, "12:00", "14:00");
await setBookingHold(live, actor, futureHold());
await assignStaff(live, actor, livePerson, "DJ");
const liveBlock = await throwsMessage(() => assignStaff(blocked, actor, livePerson, "DJ"), "already reserved");
check("unexpired tentative hold blocks that person", liveBlock.includes("already reserved"), liveBlock);
const liveDateBlock = await throwsMessage(() => setBookingHold(blocked, actor, futureHold()), "already reserved");
check("unexpired hold also reserves the calendar date", liveDateBlock.includes("already reserved"), liveDateBlock);

const zoneDate = nextDate();
const zoneOther = nextDate();
const zonePerson = await staff("Zone");
const east = await eventAt("East", zoneDate, "13:00", "15:00", "America/New_York");
const central = await eventAt("Central", zoneOther, "14:00", "16:00", "America/Chicago");
await holdAndConfirm(east);
await holdAndConfirm(central);
await assignStaff(east, actor, zonePerson, "DJ");
const centralBefore = await windowOf(central);
const eastBefore = await windowOf(east);
const shifted = await throwsMessage(() => rescheduleBooking(central, actor, {
  eventDate: zoneDate,
  startTime: "14:00",
  endTime: "16:00",
  timezone: "America/New_York",
  travelBufferMinutes: 0,
}), "already reserved");
const centralAfterReject = await windowOf(central);
const eastAfterReject = await windowOf(east);
check("timezone change that would take a reserved date is rejected", shifted.includes("already reserved"), shifted);
check("rejected timezone change keeps the wall clock", centralAfterReject?.timezone === "America/Chicago" && centralAfterReject.start_time === "14:00", JSON.stringify(centralAfterReject));
check("rejected timezone change does not move the other event", eastBefore?.starts_at === eastAfterReject?.starts_at, `${eastBefore?.starts_at} vs ${eastAfterReject?.starts_at}`);
await cancelBooking(east, actor);
await rescheduleBooking(central, actor, {
  eventDate: zoneDate,
  startTime: "16:00",
  endTime: "18:00",
  timezone: "America/New_York",
  setupMinutes: 30,
  travelBufferMinutes: 0,
});
const centralMoved = await windowOf(central);
check("clear timezone change keeps the wall clock and updates the instant", centralMoved?.timezone === "America/New_York" && centralMoved.start_time === "16:00" && centralMoved.starts_at !== centralBefore?.starts_at && centralMoved.setup_minutes === 30, JSON.stringify(centralMoved));
check("the other event stays put", (await windowOf(east))?.starts_at === eastBefore?.starts_at);

await cancelBooking(first, actor);
const released = await db.prepare("SELECT status FROM bookings WHERE event_id = ?").bind(first).first<{ status: string }>();
const stillThere = await db.prepare("SELECT id FROM events WHERE id = ?").bind(first).first<{ id: string }>();
const history = await db.prepare("SELECT action, to_status FROM booking_history WHERE event_id = ? AND action = 'cancel'").bind(first).first<{ action: string; to_status: string }>();
const blocking = await db.prepare("SELECT COUNT(*)::int AS count FROM assignments WHERE event_id = ? AND blocking").bind(first).first<{ count: number }>();
await assignStaff(second, actor, shared, "DJ");
check("cancel keeps the event and booking", released?.status === "canceled" && stillThere?.id === first, JSON.stringify({ released, stillThere }));
check("cancel writes history and releases the person", history?.to_status === "canceled" && blocking?.count === 0, JSON.stringify({ history, blocking }));

const bare = await eventAt("Bare", nextDate(), "", "");
await setBookingHold(bare, actor, futureHold());
const noWindow = await throwsMessage(() => confirmBooking(bare, actor), "start and end");
const bareRow = await db.prepare("SELECT status, confirmed_at FROM bookings WHERE event_id = ?").bind(bare).first<{ status: string; confirmed_at: string | null }>();
check("confirm needs a time window", noWindow.includes("start and end") && bareRow?.status === "tentative" && !bareRow.confirmed_at, noWindow);

const stale = await eventAt("Stale", nextDate(), "15:00", "17:00");
await setBookingHold(stale, actor, pastHold());
const staleConfirm = await throwsMessage(() => confirmBooking(stale, actor), "unexpired hold");
check("confirm refuses an expired hold", staleConfirm.includes("unexpired hold"), staleConfirm);

const confirmDate = nextDate();
const confirmPerson = await staff("Confirm clash");
const seated = await eventAt("Seated", confirmDate, "12:00", "14:00");
const conflicted = await eventAt("Conflicted", confirmDate, "12:00", "14:00");
await assignStaff(seated, actor, confirmPerson, "DJ");
await assignStaff(conflicted, actor, confirmPerson, "DJ");
await holdAndConfirm(seated);
await db.prepare("UPDATE bookings SET hold_until = ? WHERE event_id = ?").bind(futureHold(), conflicted).run();
const refused = await throwsMessage(() => confirmBooking(conflicted, actor), "already reserved");
const refusedRow = await db.prepare("SELECT status, confirmed_at FROM bookings WHERE event_id = ?").bind(conflicted).first<{ status: string; confirmed_at: string | null }>();
check("confirm is refused when the date or a person is already reserved", refused.includes("already reserved") && refusedRow?.status === "tentative" && !refusedRow.confirmed_at, refused);

const openDate = nextDate();
const openPerson = await staff("Open");
const open = await eventAt("Open", openDate, "11:00", "13:00");
await setBookingHold(open, actor, futureHold());
await assignStaff(open, actor, openPerson, "DJ");
await confirmBooking(open, actor);
const openRow = await db.prepare("SELECT status, confirmed_at FROM bookings WHERE event_id = ?").bind(open).first<{ status: string; confirmed_at: string | null }>();
check("confirm succeeds only when the window is clear", openRow?.status === "confirmed" && !!openRow.confirmed_at, JSON.stringify(openRow));

await db.prepare("UPDATE events SET internal_notes = ? WHERE id = ?").bind("staff only", open).run();
const listed = await listCalendar({ from: openDate, to: nextDate() });
const detail = await getBooking(open);
check("calendar list omits internal notes", listed.some((item) => item.id === open) && !("internalNotes" in listed[0]), JSON.stringify(Object.keys(listed[0] || {})));
check("booking detail keeps internal notes", detail.internalNotes === "staff only", detail.internalNotes);

const raceDate = nextDate();
const raceA = await eventAt("Race A", raceDate, "16:00", "20:00");
const raceB = await eventAt("Race B", raceDate, "16:00", "20:00");

type Lite = {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  transaction: <T>(fn: (tx: Lite) => Promise<T>) => Promise<T>;
};
const cache = (globalThis as unknown as { __mbPglite?: Map<string, Promise<Lite>> }).__mbPglite;
const lite = await cache?.get("memory");
if (!lite) throw new Error("pglite cache missing");

const holdIso = futureHold();
const race = await Promise.allSettled([
  lite.transaction(async (tx) => {
    await tx.query("SELECT set_booking_hold($1::uuid, $2, $3, NULL, $4)", [raceA, holdIso, actor.email, "race-a"]);
  }),
  lite.transaction(async (tx) => {
    await tx.query("SELECT set_booking_hold($1::uuid, $2, $3, NULL, $4)", [raceB, holdIso, actor.email, "race-b"]);
  }),
]);
const heldCount = await db.prepare(
  `SELECT count(*)::int AS count FROM bookings
   WHERE event_id IN (?, ?) AND hold_until IS NOT NULL AND hold_until > now()`,
).bind(raceA, raceB).first<{ count: number }>();
const oneWon = race.filter((item) => item.status === "fulfilled").length === 1 && heldCount?.count === 1;
check("one of two concurrent date holds wins", oneWon, JSON.stringify({ race: race.map((item) => item.status), count: heldCount?.count }));
console.log("concurrency: date holds use an advisory lock so only one active reservation wins the calendar date.");

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
