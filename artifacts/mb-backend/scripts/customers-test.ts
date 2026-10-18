process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@clients.test";
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
const { can } = await import("../lib/authz.ts");
const { createInquiry, addLeadTask, bookLead } = await import("../lib/crm.ts");
const { leadSchema } = await import("../lib/lead.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const { listCustomers } = await import("../lib/office-desk.ts");
const {
  customerProfile,
  findCustomerDuplicates,
  mergeCustomers,
  updateCustomer,
} = await import("../lib/customers.ts");
const {
  approveCatalogPrice,
  publishCatalogPrice,
  savePackage,
  savePricingRule,
  sendQuote,
  acceptProposal,
} = await import("../lib/finance.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");

const actor = { email: "owner@clients.test", userId: null as string | null, role: "admin" as const };

check("sales can write customers", can("sales", "customers.write") && can("sales", "customers.read"));
check("coordinator reads customers only", can("coordinator", "customers.read") && !can("coordinator", "customers.write"));
check("staff cannot open customer directory", !can("staff", "customers.read"));
check("client role has no customer directory", !can("client", "customers.read") && !can("client", "customers.write"));

const lead = await createInquiry(leadSchema.parse({
  source: "contact",
  name: "Casey Client",
  email: "casey-client@example.com",
  phone: "5551212",
  eventType: "Wedding",
  eventDate: "2039-08-12",
  notes: "Prefers evening load-in. Internal only.",
  services: [],
}));
await addLeadTask(lead.id, { title: "Send mood board", dueOn: "2000-02-01", assigneeId: null }, actor);

const booked = await bookLead({
  leadId: lead.id,
  actor,
  details: {
    clientNames: "Casey Client",
    email: "casey-client@example.com",
    phone: "5551212",
    eventType: "Wedding",
    eventDate: "2039-08-12",
    venueName: "Harbor Hall",
    guestCount: "120",
  },
});

const pkg = await savePackage({ name: "Client Pack", priceCents: 20000, actorEmail: actor.email });
await approveCatalogPrice({ kind: "package", id: pkg.id, actorEmail: actor.email });
await publishCatalogPrice({ kind: "package", id: pkg.id, actorEmail: actor.email });
await savePricingRule({ kind: "deposit", label: "Client deposit", amountCents: 5000, percent: null, active: true, actorEmail: actor.email });
await sendQuote({ eventId: booked.id, packageId: pkg.id, actorEmail: actor.email });
await acceptProposal({ eventId: booked.id, acceptedBy: "Casey Client", actorEmail: "casey-client@example.com" });

const directory = await listCustomers("admin", "casey");
check("directory finds customer", directory.length === 1 && directory[0]?.id === lead.customerId, JSON.stringify(directory));
check("directory shows active booking", (directory[0]?.activeBookingCount ?? 0) >= 1);
check("directory shows follow-ups", (directory[0]?.openFollowUps ?? 0) >= 1);
check("directory balance visible to admin", directory[0]?.balanceCents != null);

const salesDir = await listCustomers("sales", "casey");
check("sales sees balance", salesDir[0]?.balanceCents != null);

const profile = await customerProfile(lead.customerId!, "admin");
check("profile loads", !!profile && profile.customer.email === "casey-client@example.com");
check("profile links event", !!profile?.events.some((row) => row.id === booked.id));
check("profile lists active booking", (profile?.activeBookings.length ?? 0) >= 1);
check("profile includes quote", (profile?.quotes.length ?? 0) >= 1);
check("profile includes payments", (profile?.payments.length ?? 0) >= 1);
check("profile keeps internal notes", profile?.internalNotes.some((note) => note.body.includes("Internal only")) === true);
check("profile next actions present", (profile?.nextActions.length ?? 0) >= 1);
check("profile planner access listed", profile?.plannerAccess.some((row) => row.plannerId === booked.id) === true);
check("profile finance gated for roles without payments", (await customerProfile(lead.customerId!, "sales"))?.finance != null);

// Coordinator has payments.read but not proposals.read / customers.write
const coord = await customerProfile(lead.customerId!, "coordinator");
check("coordinator can read profile", !!coord);
check("coordinator cannot edit contact", coord?.permissions.canWrite === false);
check("coordinator does not see quotes without proposals.read", coord?.permissions.showProposals === false && coord?.quotes.length === 0);

await updateCustomer(lead.customerId!, { phone: "5559999" }, actor);
const updated = await db.prepare("SELECT phone FROM customers WHERE id = ?").bind(lead.customerId!).first<{ phone: string }>();
check("contact update persists", updated?.phone === "5559999");
check("coordinator cannot update customer", await throws(() => updateCustomer(lead.customerId!, { phone: "1" }, { ...actor, role: "coordinator" })));

// Phone-only duplicate pair (separate customer rows — no second DB)
const phoneA = await ensureCustomer({ name: "Pat Phone", email: "", phone: "5553334444" });
const phoneB = await ensureCustomer({ name: "Pat Phone Two", email: "", phone: "(555) 333-4444" });
check("phone-only customers stay separate until merge", phoneA !== phoneB);
const eventId = crypto.randomUUID();
await createEventRecord({
  id: eventId,
  customerId: phoneB,
  name: "Pat Party",
  eventType: "Birthday",
  eventDate: "2040-01-15",
});
const dups = await findCustomerDuplicates(phoneA, "", "5553334444");
check("phone duplicate detected", dups.some((row) => row.id === phoneB && row.reason === "phone"), JSON.stringify(dups));
await mergeCustomers(phoneA, phoneB, actor);
const afterMerge = await db.prepare("SELECT customer_id FROM events WHERE id = ?").bind(eventId).first<{ customer_id: string }>();
const absorbedGone = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(phoneB).first<{ id: string }>();
check("merge moves events to survivor", afterMerge?.customer_id === phoneA);
check("merge deletes absorbed customer", !absorbedGone);
const survivorProfile = await customerProfile(phoneA, "admin");
check("merged profile shows event history", survivorProfile?.events.some((row) => row.id === eventId) === true);

check("cannot merge mismatched emails", await throws(async () => {
  const a = await ensureCustomer({ name: "A", email: "a-merge@example.com", phone: "" });
  const b = await ensureCustomer({ name: "B", email: "b-merge@example.com", phone: "" });
  await mergeCustomers(a, b, actor);
}));

const failed = results.filter((result) => !result.pass);
for (const result of results) {
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
