import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { can } from "../lib/authz.ts";
import { openSeal, seal } from "../lib/secret-box.ts";
import { base32Decode, hotp, totp } from "../lib/totp.ts";
import { missingNames, requiredTables, requiredViews } from "../db/schema.mjs";

process.env.DATABASE_URL = "pglite:memory";
process.env.MB_MFA_ENCRYPTION_KEY = "foundation-test-key";
process.env.MB_FILE_STORAGE = "local";
const fileDir = await mkdtemp(join(tmpdir(), "mb-files-"));
process.env.MB_FILE_DIR = fileDir;

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

const rfcSecret = base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
check("totp RFC 6238 vector", (await hotp(rfcSecret, 1)) === "287082" && (await totp(rfcSecret, 59_000)) === "287082");
const sealed = await seal("totp-secret", process.env.MB_MFA_ENCRYPTION_KEY);
check("mfa secret round trip", (await openSeal(sealed, process.env.MB_MFA_ENCRYPTION_KEY)) === "totp-secret");
check("mfa secret wrong key", (await openSeal(sealed, "different-test-key!!")) === null);

check("admin can delete events", can("admin", "events.delete"));
check("coordinator can manage planners", can("coordinator", "events.write") && can("coordinator", "events.delete"));
check("coordinator cannot manage users", !can("coordinator", "users.manage"));
check("sales cannot delete events", can("sales", "office.access") && can("sales", "events.write") && !can("sales", "events.delete"));
check("staff cannot open office tools", can("staff", "events.read") && !can("staff", "office.access") && !can("staff", "events.write"));
check("client portal access", can("client", "portal.client") && !can("client", "office.access"));
check("guest can request songs", can("guest", "portal.guest") && can("guest", "songs.request") && !can("guest", "portal.client"));

const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord, syncEventDetails } = await import("../lib/records.ts");
const { saveEventFile, readStoredFile } = await import("../lib/files.ts");
const db = getDatabase();
if (!db) throw new Error("database did not open");

const tables = await db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'").all<{ table_name: string }>();
const views = await db.prepare("SELECT table_name FROM information_schema.views WHERE table_schema = 'public'").all<{ table_name: string }>();
const missing = [...missingNames(tables.results.map((row) => row.table_name), requiredTables), ...missingNames(views.results.map((row) => row.table_name), requiredViews)];
check("schema tables and audit view", missing.length === 0, missing.join(", "));

check("invalid role rejected", await throws(() => db.prepare("INSERT INTO users (id, email, role) VALUES (?, 'nope@example.com', 'owner')").bind(crypto.randomUUID()).run()));

const customerA = await ensureCustomer({ name: "Ada", email: "ada@example.com", phone: "555" });
const customerB = await ensureCustomer({ name: "Ada Again", email: "Ada@example.com", phone: "555" });
check("customer email is unique", customerA === customerB);
const customers = await db.prepare("SELECT COUNT(*)::int AS count FROM customers WHERE email = 'ada@example.com'").first<{ count: number }>();
check("one customer row", customers?.count === 1, String(customers?.count));

const eventId = crypto.randomUUID();
await createEventRecord({ id: eventId, customerId: customerA, name: "Ada Wedding", eventType: "Wedding", eventDate: "2030-06-01", guestCount: "100" });
check("second booking rejected", await throws(() => db.prepare("INSERT INTO bookings (id, event_id) VALUES (?, ?)").bind(crypto.randomUUID(), eventId).run()));
await syncEventDetails(eventId, { clientNames: "Ada Wedding", email: "ada@example.com", phone: "555", eventType: "Wedding", eventDate: "2030-07-04", startTime: "4:00 PM", endTime: "11:00 PM", guestCount: "120" });
const event = await db.prepare("SELECT event_date::text AS event_date, guest_count FROM events WHERE id = ?").bind(eventId).first<{ event_date: string; guest_count: string }>();
check("event date follows planner details", event?.event_date === "2030-07-04" && event.guest_count === "120", JSON.stringify(event));

const gear = crypto.randomUUID();
await db.prepare("INSERT INTO equipment (id, name, quantity) VALUES (?, 'Booth', 1)").bind(gear).run();
await db.prepare("INSERT INTO equipment_reservations (id, equipment_id, event_id, quantity) VALUES (?, ?, ?, 1)").bind(crypto.randomUUID(), gear, eventId).run();
check("equipment cannot be overbooked", await throws(() => db.prepare("INSERT INTO equipment_reservations (id, equipment_id, event_id, quantity) VALUES (?, ?, ?, 1)").bind(crypto.randomUUID(), gear, eventId).run()));

const otherEvent = crypto.randomUUID();
const otherCustomer = await ensureCustomer({ name: "Bea", email: "", phone: "5550100" });
await createEventRecord({ id: otherEvent, customerId: otherCustomer, name: "Bea Party", eventType: "Birthday", eventDate: "2030-08-01" });
const invitation = crypto.randomUUID();
const guest = crypto.randomUUID();
await db.prepare("INSERT INTO invitations (id, event_id, slug, title) VALUES (?, ?, 'ada-night', 'Ada')").bind(invitation, eventId).run();
await db.prepare("INSERT INTO guests (id, event_id, name) VALUES (?, ?, 'Guest')").bind(guest, otherEvent).run();
check("rsvp must match the event", await throws(() => db.prepare("INSERT INTO rsvps (id, guest_id, invitation_id, status) VALUES (?, ?, ?, 'yes')").bind(crypto.randomUUID(), guest, invitation).run()));

const saved = await saveEventFile({
  bytes: new TextEncoder().encode("contract"),
  filename: "agreement.txt",
  contentType: "text/plain",
  kind: "contract",
  eventId,
  actorEmail: "ada@example.com",
});
const loaded = await readStoredFile(saved.id);
check("contract file round trip", new TextDecoder().decode(loaded.bytes) === "contract" && saved.checksum.length === 64);

const prices = await db.prepare("SELECT COUNT(*)::int AS count FROM packages").first<{ count: number }>();
check("no package prices seeded", prices?.count === 0);

await rm(fileDir, { recursive: true, force: true });

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
