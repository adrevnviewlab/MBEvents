// Demo office for local development. Safe to run again: it stops if the sample wedding is already there.
// Usage from artifacts/mb-backend:
//   DATABASE_URL=pglite:./.data/pglite node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/seed-demo.ts

process.env.DATABASE_URL ||= "pglite:./.data/pglite";
process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;

import type { LeadInput } from "../lib/lead.ts";

const { getDatabase } = await import("../lib/env.ts");
const { hashPassword } = await import("../lib/planner.ts");
const { leadSchema } = await import("../lib/lead.ts");
const crm = await import("../lib/crm.ts");
const places = await import("../lib/places.ts");
const finance = await import("../lib/finance.ts");
const calendar = await import("../lib/calendar.ts");
const operations = await import("../lib/operations.ts");
const invites = await import("../lib/invites.ts");
const automations = await import("../lib/automations.ts");
const { saveEvent } = await import("../lib/planner-server.ts");

const MARK = "elena.rossi@demo.mbevents.test";
const db = getDatabase();
if (!db) throw new Error("Database did not open. Set DATABASE_URL=pglite:./.data/pglite");

const already = await db.prepare("SELECT id FROM customers WHERE email = ?").bind(MARK).first();
if (already) {
  console.log("Demo data is already loaded.");
  process.exit(0);
}

type Person = { email: string; name: string; role: "coordinator" | "sales" | "staff"; title: string; phone: string; profile: string; skills: string[]; rate: number };
const people: Person[] = [
  { email: "maya.chen@demo.mbevents.test", name: "Maya Chen", role: "coordinator", title: "Lead coordinator", phone: "(516) 555-0142", profile: "coordinator", skills: ["timeline", "vendors"], rate: 0 },
  { email: "priya.shah@demo.mbevents.test", name: "Priya Shah", role: "sales", title: "Sales", phone: "(347) 555-0194", profile: "other", skills: ["consultations"], rate: 0 },
  { email: "jordan.hale@demo.mbevents.test", name: "Jordan Hale", role: "staff", title: "DJ", phone: "(718) 555-0160", profile: "dj", skills: ["open format", "weddings"], rate: 75000 },
  { email: "luis.ortega@demo.mbevents.test", name: "Luis Ortega", role: "staff", title: "MC", phone: "(917) 555-0118", profile: "mc", skills: ["bilingual", "hora"], rate: 50000 },
];

const actorEmail = people[0].email;
process.env.MB_ADMIN_EMAIL ||= actorEmail;
let actorId = "";

for (const person of people) {
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword("demo-local");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, person.email, person.name, person.role, passwordHash, now),
    db.prepare(
      `INSERT INTO admin_users (email, name, password_hash, created_at, created_by, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(person.email, person.name, passwordHash, now, actorEmail, id),
    db.prepare(
      `INSERT INTO staff (id, user_id, name, email, phone, job_title, profile_type, rate_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, id, person.name, person.email, person.phone, person.title, person.profile, person.rate || null),
  ]);
  for (const tag of person.skills) {
    await db.prepare("INSERT INTO staff_skills (id, staff_id, tag) VALUES (?, ?, ?)").bind(crypto.randomUUID(), id, tag).run();
  }
  if (person.email === actorEmail) actorId = id;
}

const actor = { email: actorEmail, userId: actorId, role: "coordinator" as const };
const placeActor = { email: actor.email, userId: actor.userId };

const venueInput = [
  { name: "The Glasshouse", area: "Long Island City", address: "45-10 Pearson St, Long Island City, NY", capacity: "220", description: "Brick loft with a skyline terrace. Sample room for the local demo.", amenities: "Loading dock, freight elevator, in-house catering", serviceArea: "Queens", notes: "Load-in through the Pearson Street dock. Ballroom power is on the west wall.", mbProduction: false },
  { name: "The Pierre", area: "Upper East Side", address: "2 E 61st St, New York, NY", capacity: "300", description: "Grand ballroom overlooking Central Park. Coat check and a dedicated freight elevator.", amenities: "Grand ballroom, park views, valet", serviceArea: "Manhattan", notes: "Union load-in. Confirm the dock window a week out.", mbProduction: false },
  { name: "Oheka Castle", area: "Huntington", address: "135 W Gate Dr, Huntington, NY", capacity: "250", description: "Gold Coast estate with formal gardens and a long drive for a sparkler send-off.", amenities: "Gardens, bridal suite, on-site rooms", serviceArea: "Long Island", notes: "Ceremony lawn is a ten-minute cart from the ballroom.", mbProduction: false },
  { name: "The Foundry", area: "Long Island City", address: "42-38 9th St, Long Island City, NY", capacity: "180", description: "Industrial rooms with a courtyard. Strong for cocktail hours and after-parties.", amenities: "Courtyard, string lights, indoor/outdoor", serviceArea: "Queens", notes: "Courtyard curfew is 10:00 PM.", mbProduction: false },
  { name: "Bourne Mansion", area: "Oakdale", address: "1 Park Dr, Oakdale, NY", capacity: "160", description: "Waterfront mansion used for smaller weddings and sweet sixteens.", amenities: "Waterfront lawn, tent pad, mansion rooms", serviceArea: "Suffolk County", notes: "Tent power is a separate panel behind the carriage house.", mbProduction: false },
];

const venueIds = new Map<string, string>();
for (const venue of venueInput) {
  const created = await places.createVenue(venue, placeActor);
  await places.updateVenue(created.id, { published: true, mbProduction: venue.mbProduction }, placeActor);
  venueIds.set(venue.name, created.id);
}

const vendorInput = [
  { name: "Flora Atelier", category: "Florals", contactName: "Nina Costa", email: "nina@demo.mbevents.test", phone: "(212) 555-0177", description: "Garden and black-and-gold arrangements. Day-of installs.", area: "Manhattan & Long Island", notes: "Prefers a 2-hour install window before guests.", relationshipNotes: "Reliable on Saturday turnarounds.", preferred: true, verified: true },
  { name: "Lumen Photo", category: "Photography", contactName: "Chris Adeyemi", email: "chris@demo.mbevents.test", phone: "(646) 555-0133", description: "Documentary coverage with a second shooter for receptions.", area: "New York metro", notes: "Needs a 10-minute first-look window.", relationshipNotes: "Shares a timeline with MB the week before.", preferred: true, verified: true },
  { name: "Sweetline Cakes", category: "Cake", contactName: "Helen Park", email: "helen@demo.mbevents.test", phone: "(718) 555-0188", description: "Cutting cakes and dessert tables. They stay through the cake moment.", area: "Brooklyn & Queens", notes: "Cake table needs to be in place before introductions.", relationshipNotes: "Call if the cake cutting moves more than 15 minutes.", preferred: false, verified: true },
  { name: "North Shore Tent", category: "Rentals", contactName: "Owen Blake", email: "owen@demo.mbevents.test", phone: "(631) 555-0104", description: "Sailcloth tents, dance floors, and lounge furniture.", area: "Long Island", notes: "Install the day before. Strike starts at 11:30 PM.", relationshipNotes: "Book early for June Saturdays.", preferred: true, verified: false },
];

const vendorIds = new Map<string, string>();
for (const vendor of vendorInput) {
  const created = await places.createVendor(vendor, placeActor);
  await places.updateVendor(created.id, { published: true, preferred: vendor.preferred, verified: vendor.verified }, placeActor);
  vendorIds.set(vendor.name, created.id);
}

const service = async (name: string, description: string, priceCents: number) =>
  (await finance.saveService({ name, description, priceCents, actorEmail: actor.email })).id;

const dj = await service("DJ & MC", "Open-format music, introductions, and reception direction.", 350000);
const uplighting = await service("Uplighting", "Wireless uplights washed in the room color.", 80000);
const danceFloor = await service("Dance floor lighting", "Moving heads over the dance floor.", 45000);
const sparks = await service("Cold spark send-off", "Two machines for the last dance or sparkler exit.", 60000);
await service("Photo booth", "Open-air booth with prints for the cocktail hour.", 95000);

const weddingPkg = (await finance.savePackage({ name: "Signature Wedding", description: "Ceremony, cocktail hour, and reception through the last dance.", priceCents: 650000, actorEmail: actor.email })).id;
const celebrationPkg = (await finance.savePackage({ name: "Celebration", description: "Reception coverage for a mitzvah, sweet sixteen, or birthday.", priceCents: 350000, actorEmail: actor.email })).id;
const corporatePkg = (await finance.savePackage({ name: "Corporate Evening", description: "Background music, remarks, and a short dance set.", priceCents: 480000, actorEmail: actor.email })).id;

for (const packageId of [weddingPkg, celebrationPkg, corporatePkg]) {
  await finance.saveUpgrade({ packageId, serviceId: uplighting, optional: true, actorEmail: actor.email });
  await finance.saveUpgrade({ packageId, serviceId: danceFloor, optional: true, actorEmail: actor.email });
}
await finance.saveUpgrade({ packageId: weddingPkg, serviceId: sparks, optional: true, actorEmail: actor.email });
// Demo-only catalog. Real customer quotes still require approve + publish on the office database.
for (const id of [dj, uplighting, danceFloor, sparks, weddingPkg, celebrationPkg, corporatePkg]) {
  const kind = [weddingPkg, celebrationPkg, corporatePkg].includes(id) ? "package" as const : "service" as const;
  await finance.approveCatalogPrice({ kind, id, actorEmail: actor.email });
  await finance.publishCatalogPrice({ kind, id, actorEmail: actor.email });
}
await finance.savePricingRule({ kind: "deposit", label: "Deposit", amountCents: null, percent: 40, active: true, actorEmail: actor.email });
await finance.savePricingRule({ kind: "overtime", label: "Overtime, per hour", amountCents: 45000, percent: null, active: true, includedMinutes: 360, actorEmail: actor.email });

await automations.createTemplate({
  kind: "inquiry_confirmation",
  channel: "email",
  delayMinutes: 0,
  subject: "We received your inquiry",
  body: "Thank you for writing MB Events. A coordinator will reply within one business day.",
  active: false,
}, placeActor);
await automations.createTemplate({
  kind: "deposit_reminder",
  channel: "email",
  delayMinutes: 1440,
  subject: "Your date is waiting on the deposit",
  body: "The remaining deposit is in your planner. The date is held once it arrives.",
  active: false,
}, placeActor);

const inquiry = (input: LeadInput) => crm.createInquiry(leadSchema.parse(input));

const amira = await inquiry({ source: "availability", name: "Amira Hassan", email: "amira.hassan@demo.mbevents.test", phone: "(917) 555-0148", eventType: "Sweet 16", eventDate: "2027-04-17", guestCount: "100–150", location: "Long Island", venueStatus: "deciding", vibe: "High Energy", priorities: ["Music", "Lighting", "Big Entrance"], contactMethod: "phone", notes: "Looking at April Saturdays. Wants a candle lighting and a strong dance floor.", venueName: "Bourne Mansion", services: ["DJ & MC", "Uplighting"] });
const noah = await inquiry({ source: "contact", name: "Noah Patel", email: "noah.patel@demo.mbevents.test", phone: "(212) 555-0166", eventType: "Corporate", eventDate: "2027-02-11", guestCount: "150–250", location: "Manhattan", venueStatus: "selected", vibe: "Modern Luxury", priorities: ["Guest Experience"], contactMethod: "email", notes: "Awards dinner for a product team. Speeches first, dancing only if the room wants it.", venueName: "The Pierre", services: ["DJ & MC"] });
const sofia = await inquiry({ source: "builder", name: "Sofia Alvarez", email: "sofia.alvarez@demo.mbevents.test", phone: "(718) 555-0129", eventType: "Quinceañera", eventDate: "2027-05-08", guestCount: "150–250", location: "Queens", venueStatus: "need_venue", vibe: "Elegant", priorities: ["Dancing", "Photos", "Big Entrance"], contactMethod: "either", campaign: "spring-quince", notes: "Court of 14. Changing of the shoes and a waltz with her father.", services: ["DJ & MC", "Dance floor lighting"] });
const daniel = await inquiry({ source: "venue", name: "Daniel Kim", email: "daniel.kim@demo.mbevents.test", phone: "(646) 555-0190", eventType: "Wedding", eventDate: "2027-06-12", guestCount: "150–250", location: "Long Island City", venueStatus: "selected", vibe: "Modern Luxury", priorities: ["Music", "Lighting"], contactMethod: "email", notes: "Proposal is with them. They asked about cold sparks for the send-off.", venueName: "The Glasshouse", services: ["DJ & MC", "Uplighting", "Cold spark send-off"], referredBy: "The Glasshouse" });
const camille = await inquiry({ source: "blueprint", name: "Camille Laurent", email: "camille.laurent@demo.mbevents.test", phone: "(917) 555-0107", eventType: "Wedding", eventDate: "2026-12-31", guestCount: "50–100", location: "Manhattan", venueStatus: "selected", vibe: "Romantic", priorities: ["Music"], contactMethod: "email", notes: "New Year's Eve. They booked another company after the consult.", venueName: "The Pierre" });

await crm.updateLead(amira.id, { assigneeId: actorId, notes: "New inquiry. Call about April 17 and whether Bourne Mansion is still open." }, actor);
await crm.updateLead(noah.id, { stage: "contacted", assigneeId: actorId, notes: "Emailed the Pierre events manager. Waiting on their run of show." }, actor);
await crm.updateLead(sofia.id, { stage: "consultation_scheduled", assigneeId: actorId, consultationAt: "2026-10-20T19:00:00.000Z", notes: "Video consult Tuesday at 3:00 PM. Bring quince timeline samples." }, actor);
await crm.updateLead(daniel.id, { stage: "proposal_sent", assigneeId: actorId, budgetCents: 780000, venueName: "The Glasshouse", notes: "Signature Wedding plus uplighting and cold sparks. Follow up Friday." }, actor);
await crm.updateLead(camille.id, { stage: "lost", lostReason: "Booked another company for New Year's Eve.", notes: "Keep the contact for a referral next season." }, actor);
await crm.addLeadTask(amira.id, { title: "Call Amira about April 17", dueOn: "2026-10-17", assigneeId: actorId }, actor);
await crm.addLeadTask(daniel.id, { title: "Follow up on the Glasshouse proposal", dueOn: "2026-10-19", assigneeId: actorId }, actor);

async function book(leadId: string, details: { clientNames: string; email: string; phone: string; eventType: string; eventDate: string; venueName: string; guestCount: string }) {
  return crm.bookLead({ leadId, actor, details });
}

const elena = await book((await inquiry({ source: "builder", name: "Elena Rossi", email: MARK, phone: "(917) 555-0182", eventType: "Wedding", eventDate: "2026-11-21", guestCount: "150–250", location: "Long Island City", venueStatus: "selected", vibe: "Modern Luxury", priorities: ["Music", "Lighting", "Dancing"], contactMethod: "email", notes: "Black and gold. First dance is At Last. Father-daughter is The Way You Look Tonight.", venueName: "The Glasshouse", services: ["DJ & MC", "Uplighting"] })).id, {
  clientNames: "Elena Rossi & Marco Rossi", email: MARK, phone: "(917) 555-0182", eventType: "Wedding", eventDate: "2026-11-21", venueName: "The Glasshouse", guestCount: "180",
});
const leah = await book((await inquiry({ source: "contact", name: "Rachel Goldberg", email: "rachel.goldberg@demo.mbevents.test", phone: "(516) 555-0171", eventType: "Bat Mitzvah", eventDate: "2026-12-05", guestCount: "100–150", location: "Huntington", venueStatus: "selected", vibe: "High Energy", priorities: ["Dancing", "Big Entrance"], contactMethod: "phone", notes: "Hora right after the entrance. Candle lighting has 13 candles.", venueName: "Oheka Castle" })).id, {
  clientNames: "Leah Goldberg", email: "rachel.goldberg@demo.mbevents.test", phone: "(516) 555-0171", eventType: "Bat Mitzvah", eventDate: "2026-12-05", venueName: "Oheka Castle", guestCount: "140",
});
const northstar = await book((await inquiry({ source: "contact", name: "Alicia Grant", email: "alicia.grant@demo.mbevents.test", phone: "(212) 555-0155", eventType: "Corporate", eventDate: "2027-01-16", guestCount: "150–250", location: "Manhattan", venueStatus: "selected", vibe: "Modern Luxury", priorities: ["Guest Experience"], contactMethod: "email", notes: "Hold the date. Contract is with their events team.", venueName: "The Pierre" })).id, {
  clientNames: "Northstar Group", email: "alicia.grant@demo.mbevents.test", phone: "(212) 555-0155", eventType: "Corporate", eventDate: "2027-01-16", venueName: "The Pierre", guestCount: "200",
});
const reyes = await book((await inquiry({ source: "availability", name: "Carmen Reyes", email: "carmen.reyes@demo.mbevents.test", phone: "(347) 555-0122", eventType: "Sweet 16", eventDate: "2027-03-14", guestCount: "100–150", location: "Oakdale", venueStatus: "selected", vibe: "Nightclub", priorities: ["Lighting", "Dancing"], contactMethod: "either", notes: "Court entrance and a father-daughter dance.", venueName: "Bourne Mansion" })).id, {
  clientNames: "Isabel Reyes", email: "carmen.reyes@demo.mbevents.test", phone: "(347) 555-0122", eventType: "Sweet 16", eventDate: "2027-03-14", venueName: "Bourne Mansion", guestCount: "120",
});
const helen = await book((await inquiry({ source: "builder", name: "Helen Cho", email: "helen.cho@demo.mbevents.test", phone: "(646) 555-0184", eventType: "Private Party", eventDate: "2026-09-12", guestCount: "50–100", location: "Long Island City", venueStatus: "selected", vibe: "Elegant", priorities: ["Music"], contactMethod: "email", notes: "Anniversary dinner. Completed.", venueName: "The Foundry" })).id, {
  clientNames: "Helen & David Cho", email: "helen.cho@demo.mbevents.test", phone: "(646) 555-0184", eventType: "Private Party", eventDate: "2026-09-12", venueName: "The Foundry", guestCount: "70",
});

await db.prepare("UPDATE leads SET stage = 'event_planning', updated_at = now() WHERE email = ?").bind(MARK).run();
await db.prepare("UPDATE leads SET stage = 'event_completed', updated_at = now() WHERE email = 'helen.cho@demo.mbevents.test'").run();

const mayaStaff = actorId;
const jordan = (await db.prepare("SELECT id FROM staff WHERE email = ?").bind("jordan.hale@demo.mbevents.test").first<{ id: string }>())!.id;
const luis = (await db.prepare("SELECT id FROM staff WHERE email = ?").bind("luis.ortega@demo.mbevents.test").first<{ id: string }>())!.id;

async function place(eventId: string, venue: string, date: string, start: string, end: string, coordinator: string) {
  await calendar.rescheduleBooking(eventId, actor, { eventDate: date, startTime: start, endTime: end, setupMinutes: 90, breakdownMinutes: 45, travelBufferMinutes: 30 });
  await calendar.setBookingHold(eventId, actor, "2026-12-20T18:00", "Demo hold");
  await db.prepare("UPDATE events SET venue_id = ?, coordinator_id = ? WHERE id = ?").bind(venueIds.get(venue) ?? null, coordinator, eventId).run();
}

await place(elena.id, "The Glasshouse", "2026-11-21", "4:30 PM", "11:00 PM", mayaStaff);
await place(leah.id, "Oheka Castle", "2026-12-05", "6:00 PM", "11:00 PM", mayaStaff);
await place(northstar.id, "The Pierre", "2027-01-16", "6:00 PM", "11:00 PM", mayaStaff);
await place(reyes.id, "Bourne Mansion", "2027-03-14", "7:00 PM", "12:00 AM", mayaStaff);
await place(helen.id, "The Foundry", "2026-09-12", "6:00 PM", "10:30 PM", mayaStaff);

await calendar.confirmBooking(elena.id, actor, "Deposit received.");
await calendar.confirmBooking(leah.id, actor, "Date confirmed with the family.");
await calendar.confirmBooking(reyes.id, actor, "Sweet sixteen confirmed.");
await calendar.confirmBooking(helen.id, actor, "Anniversary confirmed.");
await calendar.completeBooking(helen.id, actor, "Night wrapped. Room reset by 11:15 PM.");

await finance.sendQuote({ eventId: elena.id, packageId: weddingPkg, upgradeIds: [uplighting, sparks], actorEmail: actor.email });
await finance.sendQuote({ eventId: leah.id, packageId: celebrationPkg, upgradeIds: [danceFloor], actorEmail: actor.email });
await finance.sendQuote({ eventId: northstar.id, packageId: corporatePkg, upgradeIds: [uplighting], actorEmail: actor.email });
await finance.sendQuote({ eventId: helen.id, packageId: celebrationPkg, actorEmail: actor.email });
await db.prepare("UPDATE proposals SET status = 'accepted', updated_at = now() WHERE event_id IN (?, ?, ?)").bind(elena.id, leah.id, helen.id).run();

async function schedule(eventId: string, label: string, amountCents: number, dueOn: string, paid: boolean) {
  const payment = await finance.addSchedulePayment({ eventId, label, amountCents, dueOn, actorEmail: actor.email });
  if (paid) {
    await db.prepare("UPDATE payments SET status = 'paid', method = 'card', paid_at = now(), updated_at = now() WHERE id = ?").bind(payment.id).run();
  }
  return payment.id;
}

await schedule(elena.id, "Deposit", 292000, "2026-06-01", true);
await schedule(elena.id, "Final balance", 438000, "2026-11-07", false);
await schedule(leah.id, "Deposit", 158000, "2026-08-01", true);
await schedule(leah.id, "Final balance", 237000, "2026-11-21", false);
await schedule(northstar.id, "Deposit", 224000, "2026-11-01", false);
await schedule(helen.id, "Deposit", 140000, "2026-04-01", true);
await schedule(helen.id, "Final balance", 210000, "2026-08-29", true);

await finance.upsertSignedContract({
  eventId: elena.id,
  title: "Entertainment Agreement",
  body: "MB Events will provide DJ, MC, uplighting, and a cold spark send-off for Elena Rossi & Marco Rossi on November 21, 2026 at The Glasshouse.",
  signedName: "Elena Rossi",
  signedIp: "127.0.0.1",
  actorEmail: actor.email,
  userId: actor.userId,
});

const planner = await db.prepare("SELECT data, admin_data FROM planner_events WHERE id = ?").bind(elena.id).first<{ data: string; admin_data: string }>();
const weddingData = JSON.parse(planner!.data);
weddingData.details = {
  ...weddingData.details,
  startTime: "4:30 PM",
  endTime: "11:00 PM",
  venueAddress: "45-10 Pearson St, Long Island City, NY",
  venueContact: "Glasshouse events",
  ceremonyLocation: "Terrace, then the loft",
  clientBudget: "7800",
  notes: "Black and gold. Keep the cocktail hour acoustic and the reception open format.",
};
weddingData.checklist = weddingData.checklist.map((item: { text: string; done: boolean }, index: number) => ({ ...item, done: index < 4 }));
weddingData.songs = [
  { id: crypto.randomUUID().slice(0, 12), title: "At Last", artist: "Etta James", kind: "Special moment", moment: "First dance", note: "" },
  { id: crypto.randomUUID().slice(0, 12), title: "The Way You Look Tonight", artist: "Frank Sinatra", kind: "Special moment", moment: "Father-daughter", note: "" },
  { id: crypto.randomUUID().slice(0, 12), title: "September", artist: "Earth, Wind & Fire", kind: "Must play", moment: "", note: "Open dancing" },
  { id: crypto.randomUUID().slice(0, 12), title: "Levitating", artist: "Dua Lipa", kind: "Must play", moment: "", note: "" },
  { id: crypto.randomUUID().slice(0, 12), title: "Chicken Dance", artist: "", kind: "Do not play", moment: "", note: "Family request to skip it." },
];
weddingData.guests = [
  { id: crypto.randomUUID().slice(0, 12), name: "Giulia Rossi", party: 2, rsvp: "Yes", table: "1" },
  { id: crypto.randomUUID().slice(0, 12), name: "Andre Rossi", party: 4, rsvp: "Yes", table: "2" },
  { id: crypto.randomUUID().slice(0, 12), name: "Mina Patel", party: 2, rsvp: "Pending", table: "4" },
  { id: crypto.randomUUID().slice(0, 12), name: "Owen Blake", party: 1, rsvp: "No", table: "" },
];
weddingData.forms = {
  ...weddingData.forms,
  announcements: "Please welcome Elena and Marco Rossi.",
  pronunciations: "Rossi is ROH-see. Marco is MAR-ko.",
  cocktailStyle: "Jazz trio energy, low volume",
  dinnerStyle: "Background, then a lift for toasts",
  genresLove: "Motown, disco, current pop",
  genresAvoid: "Heavy metal",
  volume: "Balanced",
  mcStyle: "Balanced",
};
await saveEvent(elena.id, { data: weddingData });

const admin = JSON.parse(planner!.admin_data);
admin.payments = [
  { id: crypto.randomUUID().slice(0, 12), label: "Deposit", amount: 2920, due: "2026-06-01", status: "paid", paidAt: "2026-06-02", method: "card", ref: "" },
  { id: crypto.randomUUID().slice(0, 12), label: "Final balance", amount: 4380, due: "2026-11-07", status: "due", paidAt: "", method: "", ref: "" },
];
admin.noteForClient = "Final balance is due two weeks before the wedding. The guest request link is open.";
await saveEvent(elena.id, { admin });

await db.prepare("INSERT INTO planner_messages (id, event_id, sender, body) VALUES (?, ?, 'mb', ?)").bind(crypto.randomUUID(), elena.id, "Welcome to your planner. The timeline is a starting point. Send song changes anytime.").run();
await db.prepare("INSERT INTO planner_messages (id, event_id, sender, body, read_at) VALUES (?, ?, 'client', ?, NULL)").bind(crypto.randomUUID(), elena.id, "Can we move the cake cutting to 9:15? Marco's grandmother arrives late.").run();
await db.prepare("INSERT INTO planner_guest_requests (id, event_id, guest_name, title, artist, note, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')").bind(crypto.randomUUID(), leah.id, "Ava Goldberg", "Dancing Queen", "ABBA", "For the candle lighting.", ).run();
await db.prepare("INSERT INTO planner_guest_requests (id, event_id, guest_name, title, artist, note, status) VALUES (?, ?, ?, ?, ?, ?, 'approved')").bind(crypto.randomUUID(), leah.id, "Jonah Goldberg", "I Gotta Feeling", "Black Eyed Peas", "Hora follow-up.").run();

await operations.createAssignment({ actorRole: "coordinator", eventId: elena.id, staffId: jordan, roleLabel: "DJ", callTime: "2:30 PM", payoutCents: 75000, internalNotes: "Booth on the west wall." });
await operations.createAssignment({ actorRole: "coordinator", eventId: elena.id, staffId: luis, roleLabel: "MC", callTime: "3:30 PM", payoutCents: 50000 });
await operations.createAssignment({ actorRole: "coordinator", eventId: elena.id, staffId: mayaStaff, roleLabel: "Coordinator", callTime: "2:00 PM" });
await operations.createAssignment({ actorRole: "coordinator", eventId: leah.id, staffId: jordan, roleLabel: "DJ", callTime: "4:00 PM", payoutCents: 75000 });
await operations.createAssignment({ actorRole: "coordinator", eventId: leah.id, staffId: luis, roleLabel: "MC", callTime: "4:30 PM", payoutCents: 50000 });

const sound = await operations.addEquipmentCategory({ actorRole: "coordinator", name: "Sound" });
const lighting = await operations.addEquipmentCategory({ actorRole: "coordinator", name: "Lighting" });
const effects = await operations.addEquipmentCategory({ actorRole: "coordinator", name: "Effects" });
const speakers = await operations.addEquipmentAsset({ actorRole: "coordinator", name: "QSC K12 speakers", categoryId: sound, quantity: 4 });
const lights = await operations.addEquipmentAsset({ actorRole: "coordinator", name: "Wireless uplights", categoryId: lighting, quantity: 16 });
const movers = await operations.addEquipmentAsset({ actorRole: "coordinator", name: "Moving heads", categoryId: lighting, quantity: 8 });
await operations.addEquipmentAsset({ actorRole: "coordinator", name: "Cold spark machines", categoryId: effects, quantity: 2 });
await operations.addEquipmentAsset({ actorRole: "coordinator", name: "Wireless microphones", categoryId: sound, quantity: 6 });
await operations.reserveEquipment({ actorRole: "coordinator", equipmentId: speakers, eventId: elena.id, quantity: 2 });
await operations.reserveEquipment({ actorRole: "coordinator", equipmentId: lights, eventId: elena.id, quantity: 12 });
await operations.reserveEquipment({ actorRole: "coordinator", equipmentId: movers, eventId: elena.id, quantity: 4 });
await operations.reserveEquipment({ actorRole: "coordinator", equipmentId: speakers, eventId: leah.id, quantity: 2 });

const loadIn = await operations.addRequirement({ actorRole: "coordinator", actorEmail: actor.email, actorUserId: actor.userId, eventId: elena.id, label: "Dock time confirmed with The Glasshouse" });
await operations.setRequirementMet({ actorRole: "coordinator", actorEmail: actor.email, actorUserId: actor.userId, requirementId: loadIn, met: true });
await operations.addRequirement({ actorRole: "coordinator", actorEmail: actor.email, actorUserId: actor.userId, eventId: elena.id, label: "Final song list from Elena" });
await operations.addRequirement({ actorRole: "coordinator", actorEmail: actor.email, actorUserId: actor.userId, eventId: leah.id, label: "Candle-lighting order from Rachel" });

await operations.linkVendor({ actorRole: "coordinator", eventId: elena.id, vendorId: vendorIds.get("Flora Atelier")! });
await operations.linkVendor({ actorRole: "coordinator", eventId: elena.id, vendorId: vendorIds.get("Lumen Photo")! });
await operations.linkVendor({ actorRole: "coordinator", eventId: elena.id, vendorId: vendorIds.get("Sweetline Cakes")! });

await db.prepare("INSERT INTO event_costs (id, event_id, label, amount_cents, notes) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), helen.id, "Staff", 125000, "DJ and MC for the anniversary.").run();
await db.prepare("INSERT INTO event_costs (id, event_id, label, amount_cents, notes) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), helen.id, "Transport", 8500, "Van from the Queens shop.").run();

await invites.saveInvitation(elena.id, {
  title: "Elena & Marco",
  slug: "elena-and-marco",
  message: "Join us for dinner and dancing at The Glasshouse. Please reply by November 1.",
  mode: "invite_only",
  published: true,
  plusOneCap: 1,
  rsvpDeadline: "2026-11-01T23:59:00.000Z",
  themeColor: "#1c1917",
  themeAccent: "#c4a574",
  questions: [{ label: "Meal preference" }],
}, { email: actor.email });

const guestRows = [
  { name: "Giulia Rossi", email: "giulia.rossi@demo.mbevents.test", partySize: 2, table: "1", rsvp: "yes" },
  { name: "Andre Rossi", email: "andre.rossi@demo.mbevents.test", partySize: 4, table: "2", rsvp: "yes" },
  { name: "Mina Patel", email: "mina.patel@demo.mbevents.test", partySize: 2, table: "4", rsvp: "pending" },
  { name: "Owen Blake", email: "owen.blake@demo.mbevents.test", partySize: 1, table: "", rsvp: "no" },
] as const;
for (const guest of guestRows) {
  const created = await invites.addGuest(elena.id, guest, "http://localhost:5173");
  await invites.updateGuest(elena.id, created.id, { rsvp: guest.rsvp });
}

await db.prepare(
  "UPDATE events SET internal_notes = ? WHERE id = ?",
).bind("Black and gold. Booth on the west wall. Cake cutting moved to 9:15 if the room is seated.", elena.id).run();
await db.prepare("UPDATE leads SET referred_by = 'The Glasshouse', venue_id = ? WHERE email = ?").bind(venueIds.get("The Glasshouse"), "daniel.kim@demo.mbevents.test").run();

const counts = await db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM leads) AS leads,
    (SELECT COUNT(*) FROM events) AS events,
    (SELECT COUNT(*) FROM venues) AS venues,
    (SELECT COUNT(*) FROM vendors) AS vendors,
    (SELECT COUNT(*) FROM payments) AS payments
`).first<{ leads: number; events: number; venues: number; vendors: number; payments: number }>();
console.log(`Demo data loaded. ${counts?.leads} leads, ${counts?.events} events, ${counts?.venues} venues, ${counts?.vendors} partners, ${counts?.payments} payments.`);
console.log("Invitation: http://localhost:5173/invite/elena-and-marco");
process.exit(0);
