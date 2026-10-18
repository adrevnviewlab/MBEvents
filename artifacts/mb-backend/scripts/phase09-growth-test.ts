/**
 * Phase 09: public website growth — leads, availability, directories, attribution, reporting honesty.
 */
process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@phase09.test";
delete process.env.RESEND_API_KEY;

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

const { getDatabase } = await import("../lib/env.ts");
const { leadSchema } = await import("../lib/lead.ts");
const { createInquiry, bookLead } = await import("../lib/crm.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const { getDateAvailability } = await import("../lib/availability.ts");
const places = await import("../lib/places.ts");
const { buildBusinessReport } = await import("../lib/analytics.ts");
const { setBookingHold, confirmBooking, completeBooking, rescheduleBooking } = await import("../lib/calendar.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const owner = { email: "owner@phase09.test", userId: null as string | null };
await saveBusinessSettings({ companyName: "MB Events", timezone: "America/New_York", actorEmail: owner.email });

check(
  "honeypot rejects filled website",
  await throws(() => Promise.resolve(leadSchema.parse({
    source: "contact",
    name: "Bot",
    email: "bot@example.com",
    phone: "",
    eventType: "Other",
    website: "https://spam.example",
    services: [],
  }))),
);

const attributed = await createInquiry(leadSchema.parse({
  source: "builder",
  name: "Casey Growth",
  email: "casey-phase09@example.com",
  phone: "5550909",
  eventType: "Wedding",
  eventDate: "2038-08-08",
  campaign: "spring-open-house",
  referredBy: "utm_instagram",
  services: [],
}));
const leadRow = await db.prepare(
  "SELECT campaign, referred_by, customer_id FROM leads WHERE id = ?",
).bind(attributed.id).first<{ campaign: string | null; referred_by: string | null; customer_id: string | null }>();
check("campaign is stored on the lead", leadRow?.campaign === "spring-open-house", JSON.stringify(leadRow));
check("referredBy is stored on the lead", leadRow?.referred_by === "utm_instagram", JSON.stringify(leadRow));

const customers = await db.prepare("SELECT COUNT(*)::int AS count FROM customers WHERE lower(email) = lower(?)").bind("casey-phase09@example.com").first<{ count: number }>();
check("customer email is not duplicated", customers?.count === 1, JSON.stringify(customers));

// Soft dedupe lives on the public HTTP route (2-minute window). Mirror that query here.
const soft = await db.prepare(
  "SELECT id FROM leads WHERE lower(email) = ? AND phone = ? AND source = ? AND created_at > ? LIMIT 1",
).bind("casey-phase09@example.com", "5550909", "builder", new Date(Date.now() - 2 * 60 * 1000).toISOString()).first<{ id: string }>();
check("soft dedupe window finds the inquiry", soft?.id === attributed.id, JSON.stringify(soft));

const openDate = await getDateAvailability("2038-08-20");
check("open date is not guaranteed", openDate.status === "open" && openDate.guaranteed === false && openDate.reserved === false);
check("open copy does not invent a hold", !/hold|guarant|confirmed for you/i.test(openDate.message) || openDate.message.includes("not reserved"), openDate.message);

const venue = await places.createVenue({
  name: "Phase09 Hall",
  description: "Public-ready room",
  capacity: "200",
  area: "Nassau",
  serviceArea: "Long Island",
}, owner);
const partner = await places.createVendor({
  name: "Phase09 Photo",
  category: "Photography",
  description: "Shot nights with MB",
  area: "Long Island",
}, owner);
check("unpublished venue is hidden", (await places.publicVenues()).every((row) => row.id !== venue.id));
check("unpublished partner is hidden", (await places.publicPartners()).every((row) => row.id !== partner.id));

const draftLead = crypto.randomUUID();
await db.prepare(
  "INSERT INTO leads (id, customer_id, source, name, email, phone, event_type) VALUES (?, ?, 'venue', 'Casey', 'casey-phase09@example.com', '5550909', 'Wedding')",
).bind(draftLead, leadRow?.customer_id).run();
await places.attachInquiryLinks(draftLead, { source: "venue", venueId: venue.id, vendorId: partner.id });
const blocked = await db.prepare("SELECT venue_id, vendor_id FROM leads WHERE id = ?").bind(draftLead).first<{ venue_id: string | null; vendor_id: string | null }>();
check("unpublished place ids do not attach from public inquiry", !blocked?.venue_id && !blocked?.vendor_id, JSON.stringify(blocked));

await places.updateVenue(venue.id, { published: true }, owner);
await places.updateVendor(partner.id, { published: true, verified: true }, owner);
check("published venue appears publicly", (await places.publicVenues()).some((row) => row.id === venue.id && row.name === "Phase09 Hall"));
check("published partner appears publicly", (await places.publicPartners()).some((row) => row.id === partner.id && row.verified === true));

await places.attachInquiryLinks(draftLead, { source: "venue", venueId: venue.id, vendorId: partner.id, referredBy: "friend" });
const linked = await db.prepare("SELECT venue_id, vendor_id, referred_by FROM leads WHERE id = ?").bind(draftLead).first<{ venue_id: string | null; vendor_id: string | null; referred_by: string | null }>();
check("published place ids attach on inquiry", linked?.venue_id === venue.id && linked?.vendor_id === partner.id && linked?.referred_by === "friend", JSON.stringify(linked));

const holdDate = "2038-09-09";
const booked = await bookLead({
  leadId: attributed.id,
  actor: owner,
  details: {
    clientNames: "Casey Growth",
    email: "casey-phase09@example.com",
    phone: "5550909",
    eventType: "Wedding",
    eventDate: holdDate,
    venueName: "Phase09 Hall",
    guestCount: "120",
  },
});
await rescheduleBooking(booked.id, owner, {
  eventDate: holdDate,
  startTime: "4:00 PM",
  endTime: "11:00 PM",
  timezone: "America/New_York",
});
await setBookingHold(booked.id, owner, new Date(Date.now() + 3 * 86400000).toISOString());
await confirmBooking(booked.id, owner);

const reserved = await getDateAvailability(holdDate);
check(
  "confirmed calendar date is reserved publicly",
  reserved.status === "reserved" && reserved.reserved === true && reserved.guaranteed === false,
  JSON.stringify(reserved),
);
check("reserved copy does not claim the visitor owns the date", !/confirmed for you|your date is booked|you are confirmed/i.test(reserved.message), reserved.message);

await completeBooking(booked.id, owner);
const reviewJobs = await db.prepare(
  `SELECT COUNT(*)::int AS count FROM message_jobs j
   JOIN automation_templates t ON t.id = j.template_id
   WHERE t.kind = 'review_request' AND j.entity_id = ?`,
).bind(booked.id).first<{ count: number }>();
const referralJobs = await db.prepare(
  `SELECT COUNT(*)::int AS count FROM message_jobs j
   JOIN automation_templates t ON t.id = j.template_id
   WHERE t.kind = 'referral' AND j.entity_id = ?`,
).bind(booked.id).first<{ count: number }>();
check("review request exists after complete", (reviewJobs?.count ?? 0) >= 1, JSON.stringify(reviewJobs));
check("referral ask exists after complete", (referralJobs?.count ?? 0) >= 1, JSON.stringify(referralJobs));

const report = await buildBusinessReport(db);
const profitability = report.profitability;
check(
  "profit stays not recorded without costs",
  profitability.recorded === false && !("profitCents" in profitability) && !("margin" in profitability),
  JSON.stringify(profitability),
);
check("lead source buckets use stored rows", Array.isArray(report.byLeadSource));
const leadCount = await db.prepare("SELECT COUNT(*)::int AS count FROM leads WHERE source = 'builder'").first<{ count: number }>();
check("builder inquiries are stored for reporting", (leadCount?.count ?? 0) >= 1, JSON.stringify(leadCount));
// Revenue-by-source stays empty until collected payment rows exist — do not invent it.
check(
  "source revenue stays empty without collected payments",
  report.byLeadSource.length === 0 || report.byLeadSource.every((row) => row.revenueCents === 0),
  JSON.stringify(report.byLeadSource),
);

const failed = results.filter((row) => !row.pass);
for (const row of results) {
  console.log(`${row.pass ? "PASS" : "FAIL"}  ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
