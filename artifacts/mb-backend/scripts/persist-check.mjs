// Proves Postgres keeps office records across a new connection.
// Uses only the database mbevents_persist_check. Never writes to or deletes mbevents.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadLocalEnv } from "./load-local-env.mjs";

const CHECK_DB = "mbevents_persist_check";
const MARKER = "persist-check@mb.local";

loadLocalEnv();

const officeUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";
const command = process.argv[2] || "setup";

function fail(message) {
  console.error(`[persist] ${message}`);
  process.exit(1);
}

function redact(text) {
  return String(text || "").replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://***@");
}

if (!officeUrl) fail("Set DATABASE_URL to the local Postgres database.");
if (officeUrl.startsWith("pglite:")) fail("Refusing PGlite. Point DATABASE_URL at Postgres.");

let office;
try {
  office = new URL(officeUrl);
} catch {
  fail("DATABASE_URL must be a Postgres URL.");
}
if (office.protocol !== "postgres:" && office.protocol !== "postgresql:") fail("DATABASE_URL must be a Postgres URL.");
const officeName = office.pathname.replace(/^\//, "");
if (officeName !== "mbevents") fail("DATABASE_URL must point at the mbevents database.");

function databaseUrl(name) {
  const next = new URL(officeUrl);
  next.pathname = `/${name}`;
  return next.toString();
}

function open(name) {
  return postgres(databaseUrl(name), { prepare: false, ssl: false, max: 1, onnotice: () => {} });
}

async function setup() {
  const admin = open("postgres");
  const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${CHECK_DB}`;
  if (!existing.length) await admin.unsafe(`CREATE DATABASE ${CHECK_DB}`);
  await admin.end();

  const migrated = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(CHECK_DB),
      DATABASE_URL_UNPOOLED: databaseUrl(CHECK_DB),
      POSTGRES_URL: "",
      POSTGRES_URL_NON_POOLING: "",
    },
    encoding: "utf8",
  });
  if (migrated.stdout) process.stdout.write(redact(migrated.stdout));
  if (migrated.status !== 0) {
    if (migrated.stderr) process.stderr.write(redact(migrated.stderr));
    fail("Migrations did not apply to the persistence-check database.");
  }

  const db = open(CHECK_DB);
  const already = await db`SELECT id FROM leads WHERE email = ${MARKER}`;
  if (!already.length) {
    await db.begin(async (tx) => {
      const [customer] = await tx`
        INSERT INTO customers (id, name, email) VALUES (gen_random_uuid(), 'Persist Check', ${MARKER}) RETURNING id`;
      const [lead] = await tx`
        INSERT INTO leads (id, name, email, event_type, source, customer_id)
        VALUES (gen_random_uuid(), 'Persist Check', ${MARKER}, 'Wedding', 'builder', ${customer.id}) RETURNING id`;
      const [event] = await tx`
        INSERT INTO events (id, customer_id, lead_id, name, event_type, event_date, start_time, end_time)
        VALUES (gen_random_uuid(), ${customer.id}, ${lead.id}, 'Persist Check', 'Wedding', '2026-11-01', '18:00', '23:00') RETURNING id`;
      const [booking] = await tx`
        INSERT INTO bookings (id, event_id, status, hold_until)
        VALUES (gen_random_uuid(), ${event.id}, 'tentative', now() + interval '48 hours') RETURNING id`;
      await tx`
        INSERT INTO proposals (id, event_id, title, status)
        VALUES (gen_random_uuid(), ${event.id}, 'Persist Check quote', 'draft')`;
      const [person] = await tx`
        INSERT INTO staff (id, name, email, profile_type) VALUES (gen_random_uuid(), 'Persist DJ', ${MARKER}, 'dj') RETURNING id`;
      await tx`
        INSERT INTO assignments (id, event_id, staff_id, role_label) VALUES (gen_random_uuid(), ${event.id}, ${person.id}, 'DJ')`;
      const [invitation] = await tx`
        INSERT INTO invitations (id, event_id, slug, title) VALUES (gen_random_uuid(), ${event.id}, 'persist-check', 'Persist Check') RETURNING id`;
      const [guest] = await tx`
        INSERT INTO guests (id, event_id, name, email) VALUES (gen_random_uuid(), ${event.id}, 'Persist Guest', ${MARKER}) RETURNING id`;
      await tx`
        INSERT INTO rsvps (id, guest_id, invitation_id, status) VALUES (gen_random_uuid(), ${guest.id}, ${invitation.id}, 'yes')`;
      await tx`
        INSERT INTO payments (id, event_id, booking_id, label, amount_cents, status)
        VALUES (gen_random_uuid(), ${event.id}, ${booking.id}, 'Persist deposit', 10000, 'due')`;
    });
  }
  await db.end();
  console.log("[persist] wrote the check rows");
}

async function verify() {
  const db = open(CHECK_DB);
  const [row] = await db`
    SELECT
      (SELECT count(*) FROM customers WHERE email = ${MARKER})::int AS customers,
      (SELECT count(*) FROM leads WHERE email = ${MARKER})::int AS leads,
      (SELECT count(*) FROM events e JOIN leads l ON l.id = e.lead_id WHERE l.email = ${MARKER})::int AS events,
      (SELECT count(*) FROM bookings b JOIN events e ON e.id = b.event_id JOIN leads l ON l.id = e.lead_id WHERE l.email = ${MARKER} AND b.hold_until IS NOT NULL)::int AS holds,
      (SELECT count(*) FROM bookings b JOIN events e ON e.id = b.event_id JOIN leads l ON l.id = e.lead_id WHERE l.email = ${MARKER})::int AS bookings,
      (SELECT count(*) FROM proposals q JOIN events e ON e.id = q.event_id JOIN leads l ON l.id = e.lead_id WHERE l.email = ${MARKER})::int AS quotes,
      (SELECT count(*) FROM assignments a JOIN events e ON e.id = a.event_id JOIN leads l ON l.id = e.lead_id WHERE l.email = ${MARKER})::int AS assignments,
      (SELECT count(*) FROM invitations i JOIN events e ON e.id = i.event_id JOIN leads l ON l.id = e.lead_id WHERE l.email = ${MARKER})::int AS invitations,
      (SELECT count(*) FROM rsvps r JOIN guests g ON g.id = r.guest_id JOIN events e ON e.id = g.event_id JOIN leads l ON l.id = e.lead_id WHERE l.email = ${MARKER})::int AS rsvps,
      (SELECT count(*) FROM payments p JOIN events e ON e.id = p.event_id JOIN leads l ON l.id = e.lead_id WHERE l.email = ${MARKER})::int AS payments`;
  await db.end();
  const expected = ["customers", "leads", "events", "holds", "bookings", "quotes", "assignments", "invitations", "rsvps", "payments"];
  const missing = expected.filter((key) => Number(row?.[key]) < 1);
  if (missing.length) fail(`Missing after reconnect: ${missing.join(", ")}`);
  console.log("[persist] rows survived");
}

async function drop() {
  if (CHECK_DB !== "mbevents_persist_check") fail("Refusing to drop an unexpected database.");
  const admin = open("postgres");
  await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${CHECK_DB} AND pid <> pg_backend_pid()`;
  await admin.unsafe(`DROP DATABASE IF EXISTS ${CHECK_DB}`);
  const left = await admin`SELECT 1 FROM pg_database WHERE datname = ${CHECK_DB}`;
  const office = await admin`SELECT 1 FROM pg_database WHERE datname = 'mbevents'`;
  await admin.end();
  if (left.length) fail("The check database is still present.");
  if (!office.length) fail("The office database mbevents is missing.");
  console.log("[persist] dropped only mbevents_persist_check");
}

if (command === "setup") await setup();
else if (command === "verify") await verify();
else if (command === "drop") await drop();
else fail("Use setup, verify, or drop.");
