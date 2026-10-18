process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@availability.test";

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

async function throws(run: () => Promise<unknown>, part = "") {
  try {
    await run();
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return !part || message.includes(part) ? message : `unexpected: ${message}`;
  }
}

const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const { createInquiry } = await import("../lib/crm.ts");
const { leadSchema } = await import("../lib/lead.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const { getDateAvailability, dateIsReserved } = await import("../lib/availability.ts");
const { cancelBooking, confirmBooking, setBookingHold, rescheduleBooking, assignStaff } = await import("../lib/calendar.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const owner = { email: "owner@availability.test", userId: null };
const futureHold = () => new Date(Date.now() + 3 * 86400000).toISOString();
const pastHold = () => new Date(Date.now() - 3600000).toISOString();

await saveBusinessSettings({
  companyName: "MB Events",
  timezone: "America/New_York",
  actorEmail: owner.email,
});

async function eventOn(date: string, label: string, start = "16:00", end = "20:00") {
  const customerId = await ensureCustomer({ name: label, email: `${label.replace(/\s+/g, "").toLowerCase()}@availability.test`, phone: "" });
  const id = crypto.randomUUID();
  await createEventRecord({ id, customerId, name: label, eventType: "Wedding", eventDate: date, startTime: start, endTime: end });
  await db!.prepare("UPDATE events SET timezone = 'America/New_York' WHERE id = ?").bind(id).run();
  return id;
}

const inquiryDate = "2034-05-10";
const leadA = await createInquiry(leadSchema.parse({
  source: "availability",
  name: "Inquiry One",
  email: "one@availability.test",
  phone: "5550101",
  eventType: "Wedding",
  eventDate: inquiryDate,
  services: [],
}));
const leadB = await createInquiry(leadSchema.parse({
  source: "availability",
  name: "Inquiry Two",
  email: "two@availability.test",
  phone: "5550102",
  eventType: "Wedding",
  eventDate: inquiryDate,
  services: [],
}));
const openBefore = await getDateAvailability(inquiryDate);
check("two inquiries for the same date are allowed", !!leadA.id && !!leadB.id && leadA.id !== leadB.id);
check("inquiries do not reserve the date", openBefore.status === "open" && openBefore.reserved === false && openBefore.guaranteed === false, JSON.stringify(openBefore));
check("open copy never promises a guarantee", !/guarant/i.test(openBefore.message) && openBefore.message.includes("not reserved"));

const holdDate = "2034-05-11";
const first = await eventOn(holdDate, "Hold A");
const second = await eventOn(holdDate, "Hold B");
await setBookingHold(first, owner, futureHold());
const secondHold = await throws(() => setBookingHold(second, owner, futureHold()), "already reserved");
check("second active hold on the same date is refused", secondHold.includes("already reserved"), secondHold);
check("active hold reserves the public date", (await getDateAvailability(holdDate)).status === "reserved");

const raceDate = "2034-05-12";
const raceA = await eventOn(raceDate, "Race A");
const raceB = await eventOn(raceDate, "Race B");
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
    await tx.query("SELECT set_booking_hold($1::uuid, $2, $3, NULL, $4)", [raceA, holdIso, owner.email, "race-a"]);
  }),
  lite.transaction(async (tx) => {
    await tx.query("SELECT set_booking_hold($1::uuid, $2, $3, NULL, $4)", [raceB, holdIso, owner.email, "race-b"]);
  }),
]);
const held = await db.prepare(
  `SELECT count(*)::int AS count FROM bookings
   WHERE event_id IN (?, ?) AND hold_until IS NOT NULL AND hold_until > now()`,
).bind(raceA, raceB).first<{ count: number }>();
const winners = race.filter((item) => item.status === "fulfilled").length;
check("two simultaneous hold attempts leave one winner", winners === 1 && held?.count === 1, JSON.stringify({ winners, held, race: race.map((item) => item.status) }));

const confirmDate = "2034-05-13";
const confirmed = await eventOn(confirmDate, "Confirmed");
const rival = await eventOn(confirmDate, "Rival");
await setBookingHold(confirmed, owner, futureHold());
await confirmBooking(confirmed, owner);
const againstConfirmed = await throws(() => setBookingHold(rival, owner, futureHold()), "already reserved");
check("active hold versus confirmed booking — confirm reserves the date", againstConfirmed.includes("already reserved"), againstConfirmed);
check("confirmed date is reserved publicly", (await getDateAvailability(confirmDate)).status === "reserved");

const expiredDate = "2034-05-14";
const expired = await eventOn(expiredDate, "Expired");
const after = await eventOn(expiredDate, "After");
await setBookingHold(expired, owner, pastHold());
check("expired hold does not reserve the date", !(await dateIsReserved(expiredDate)) && (await getDateAvailability(expiredDate)).status === "open");
await setBookingHold(after, owner, futureHold());
check("expired hold stops blocking availability", (await getDateAvailability(expiredDate)).status === "reserved");

const crewDate = "2034-05-15";
const crewA = await eventOn(crewDate, "Crew A", "10:00", "12:00");
const crewB = await eventOn(crewDate, "Crew B", "18:00", "22:00");
const personA = crypto.randomUUID();
const personB = crypto.randomUUID();
await db.prepare("INSERT INTO staff (id, name) VALUES (?, 'Crew A'), (?, 'Crew B')").bind(personA, personB).run();
await setBookingHold(crewA, owner, futureHold());
await assignStaff(crewA, owner, personA, "DJ");
const differentCrew = await throws(() => setBookingHold(crewB, owner, futureHold()), "already reserved");
check("different crews on the same date still cannot both reserve it", differentCrew.includes("already reserved"), differentCrew);

const moveDate = "2034-05-16";
const blockedDate = "2034-05-17";
const mover = await eventOn(moveDate, "Mover");
const blocker = await eventOn(blockedDate, "Blocker");
await setBookingHold(blocker, owner, futureHold());
await setBookingHold(mover, owner, futureHold());
const rescheduleBlocked = await throws(() => rescheduleBooking(mover, owner, {
  eventDate: blockedDate,
  startTime: "16:00",
  endTime: "20:00",
  timezone: "America/New_York",
}), "already reserved");
const moverDate = await db.prepare("SELECT event_date::text AS event_date FROM events WHERE id = ?").bind(mover).first<{ event_date: string }>();
check("reschedule into a blocked date is refused", rescheduleBlocked.includes("already reserved") && moverDate?.event_date === moveDate, `${rescheduleBlocked} ${moverDate?.event_date}`);

const boundary = await getDateAvailability("2034-05-18");
check("future date in business timezone can be open", boundary.status === "open" && boundary.timezone === "America/New_York", JSON.stringify(boundary));
const past = await getDateAvailability("2020-01-01");
check("past date is unavailable", past.status === "unavailable", JSON.stringify(past));

await cancelBooking(blocker, owner);
check("cancellation releases availability", (await getDateAvailability(blockedDate)).status === "open");
await rescheduleBooking(mover, owner, {
  eventDate: blockedDate,
  startTime: "16:00",
  endTime: "20:00",
  timezone: "America/New_York",
});
check("canceled date can receive a reschedule", (await db.prepare("SELECT event_date::text AS event_date FROM events WHERE id = ?").bind(mover).first<{ event_date: string }>())?.event_date === blockedDate);

const staffDate = "2034-05-20";
const shared = crypto.randomUUID();
await db.prepare("INSERT INTO staff (id, name) VALUES (?, 'Shared DJ')").bind(shared).run();
const left = await eventOn(staffDate, "Staff Left", "18:00", "22:00");
const right = await eventOn(staffDate, "Staff Right", "18:00", "22:00");
await setBookingHold(left, owner, futureHold());
await confirmBooking(left, owner);
await assignStaff(left, owner, shared, "DJ");
const staffClash = await throws(() => assignStaff(right, owner, shared, "DJ"), "already reserved");
check("existing staff conflicts still work on a reserved date", staffClash.includes("already reserved"), staffClash);

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
