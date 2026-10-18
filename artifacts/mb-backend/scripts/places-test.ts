process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@places.test";

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

const { getDatabase } = await import("../lib/env.ts");
const { can } = await import("../lib/authz.ts");
const places = await import("../lib/places.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");

const actor = { email: "owner@places.test", userId: null as string | null };

check("sales can read venues and vendors", can("sales", "venues.read") && can("sales", "vendors.read"));
check("sales cannot write venues", !can("sales", "venues.write"));
check("coordinator can write both", can("coordinator", "venues.write") && can("coordinator", "vendors.write"));
check("staff cannot open directory", !can("staff", "venues.read") && !can("staff", "vendors.read"));

const venue = await places.createVenue({
  name: "Harbor Hall",
  area: "North Shore",
  address: "1 Pier Rd",
  capacity: "200",
  amenities: "No confetti indoors",
  notes: "Load-in via side door",
  mbProduction: true,
}, actor);

const vendor = await places.createVendor({
  name: "Lens & Light",
  category: "Photo",
  contactName: "Sam Photo",
  email: "sam@lens.test",
  phone: "5550100",
  preferred: true,
  notes: "Prefers email",
  relationshipNotes: "Good on weekends",
}, actor);

const customerId = await ensureCustomer({ name: "Pat Client", email: "pat-places@example.com", phone: "5551212" });
const eventId = crypto.randomUUID();
await createEventRecord({
  id: eventId,
  customerId,
  name: "Pat Party",
  eventType: "Birthday",
  eventDate: "2039-05-01",
});
await db.prepare("UPDATE events SET venue_id = ? WHERE id = ?").bind(venue.id, eventId).run();
await db.prepare(
  "INSERT INTO event_vendors (id, event_id, vendor_id, role, contact_name, company, phone, email, source_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
).bind(crypto.randomUUID(), eventId, vendor.id, "Photographer", "Sam Photo", "Lens & Light", "5550100", "sam@lens.test", "team-1").run();

await db.prepare(
  "INSERT INTO planner_events (id, code, password_hash, guest_code, guest_password, event_id, data, admin_data) VALUES (?, ?, 'x', ?, 'g', ?, '{}', '{}')",
).bind(eventId, `MB${eventId.slice(0, 8)}`, `G${eventId.slice(0, 8)}`, eventId).run();

await db.prepare(
  "INSERT INTO leads (id, customer_id, venue_id, vendor_id, source, name, email, phone, event_type) VALUES (?, ?, ?, ?, 'contact', 'Pat Client', 'pat-places@example.com', '5551212', 'Birthday')",
).bind(crypto.randomUUID(), customerId, venue.id, vendor.id).run();

await db.prepare(
  "INSERT INTO tasks (id, event_id, title, due_on, done) VALUES (?, ?, 'Send shot list', '2039-04-15', false)",
).bind(crypto.randomUUID(), eventId).run();

const venueProfile = await places.staffVenueById(venue.id);
check("venue profile lists linked events", venueProfile.events.some((row) => row.id === eventId && !!row.href));
check("venue availability disclaimer present", venueProfile.availability.thirdPartyCalendar === false && venueProfile.availability.detail.includes("does not control"));
check("venue pricing not invented", venueProfile.pricing.tracked === false);
check("venue notes preserved", venueProfile.notes.includes("Load-in") && venueProfile.amenities.includes("confetti"));

const vendorProfile = await places.staffVendorById(vendor.id);
check("vendor profile lists assignments", vendorProfile.assignments.some((row) => row.id === eventId && row.role === "Photographer"));
check("vendor finance not invented", vendorProfile.finance.quotesTracked === false && vendorProfile.finance.balancesTracked === false);
check("vendor tasks from assigned events", vendorProfile.tasks.some((task) => task.title === "Send shot list"));
check("relationship notes stay on staff profile", vendorProfile.relationshipNotes.includes("weekends"));

const venues = await places.listStaffVenues();
const vendors = await places.listStaffVendors();
check("venue directory includes event count", venues.find((row) => row.id === venue.id)?.eventCount === 1);
check("vendor directory includes assignment count", vendors.find((row) => row.id === vendor.id)?.assignmentCount === 1);

const publicPartners = await places.publicPartners();
check("unpublished vendor stays off public list", !publicPartners.some((row) => row.id === vendor.id));
await places.updateVendor(vendor.id, { published: true }, actor);
const published = await places.publicPartners();
check("published vendor appears publicly without relationship notes", published.some((row) => row.id === vendor.id) && !JSON.stringify(published).includes("weekends"));

const failed = results.filter((result) => !result.pass);
for (const result of results) {
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
