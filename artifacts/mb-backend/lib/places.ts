import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { fileStore } from "@/lib/storage";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Actor = { email: string; userId?: string | null; ip?: string };

export type PublicVenue = {
  id: string;
  name: string;
  description: string;
  capacity: string;
  amenities: string;
  location: string;
  area: string;
  serviceArea: string;
  mbProduction: boolean;
  photos: { id: string; url: string }[];
};

export type PublicPartner = {
  id: string;
  name: string;
  category: string;
  description: string;
  area: string;
  verified: boolean;
  photos: { id: string; url: string }[];
};

type VenueRow = {
  id: string;
  name: string;
  area: string;
  address: string;
  capacity: string;
  notes: string;
  description: string;
  amenities: string;
  service_area: string;
  active: boolean;
  published: boolean;
  mb_production: boolean;
};

type VendorRow = {
  id: string;
  name: string;
  category: string;
  contact_name: string;
  email: string;
  phone: string;
  notes: string;
  relationship_notes: string;
  description: string;
  area: string;
  preferred: boolean;
  active: boolean;
  published: boolean;
  verified: boolean;
};

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function flagged(value: unknown) {
  return value === true || value === "t" || value === "true" || value === 1;
}

function clean(value: string | null | undefined, max: number) {
  return (value ?? "").trim().slice(0, max);
}

function assertUuid(value: string, label: string) {
  if (!uuidPattern.test(value)) throw new AppError(`${label} was not found.`, 404);
}

export function publicVenue(row: VenueRow, photos: { id: string }[]): PublicVenue {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    capacity: row.capacity,
    amenities: row.amenities,
    location: row.address,
    area: row.area,
    serviceArea: row.service_area,
    mbProduction: flagged(row.mb_production),
    photos: photos.map((photo) => ({ id: photo.id, url: `/api/venues/photos/${photo.id}` })),
  };
}

export function publicPartner(row: VendorRow, photos: { id: string }[]): PublicPartner {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    area: row.area,
    verified: flagged(row.verified),
    photos: photos.map((photo) => ({ id: photo.id, url: `/api/partners/photos/${photo.id}` })),
  };
}

function staffVenue(row: VenueRow, photos: { id: string; filename: string }[]) {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    location: row.address,
    capacity: row.capacity,
    description: row.description,
    amenities: row.amenities,
    serviceArea: row.service_area,
    notes: row.notes,
    active: flagged(row.active),
    published: flagged(row.published),
    mbProduction: flagged(row.mb_production),
    photos: photos.map((photo) => ({ id: photo.id, filename: photo.filename })),
  };
}

function staffVendor(row: VendorRow, photos: { id: string; filename: string }[]) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    description: row.description,
    area: row.area,
    notes: row.notes,
    relationshipNotes: row.relationship_notes,
    preferred: flagged(row.preferred),
    active: flagged(row.active),
    published: flagged(row.published),
    verified: flagged(row.verified),
    photos: photos.map((photo) => ({ id: photo.id, filename: photo.filename })),
  };
}

const venueColumns = `id, name, area, address, capacity, notes, description, amenities, service_area, active, published, mb_production`;
const vendorColumns = `id, name, category, contact_name, email, phone, notes, relationship_notes, description, area, preferred, active, published, verified`;

export async function publicVenues() {
  const db = database();
  const rows = await db.prepare(
    `SELECT ${venueColumns} FROM venues WHERE published = true AND active = true ORDER BY name`,
  ).all<VenueRow>();
  const photos = await db.prepare(
    `SELECT f.id, f.venue_id FROM stored_files f
     JOIN venues v ON v.id = f.venue_id
     WHERE f.kind = 'venue_photo' AND v.published = true AND v.active = true
     ORDER BY f.created_at`,
  ).all<{ id: string; venue_id: string }>();
  const byVenue = new Map<string, { id: string }[]>();
  for (const photo of photos.results) {
    const list = byVenue.get(photo.venue_id) ?? [];
    list.push({ id: photo.id });
    byVenue.set(photo.venue_id, list);
  }
  return rows.results.map((row) => publicVenue(row, byVenue.get(row.id) ?? []));
}

export async function publicPartners() {
  const db = database();
  const rows = await db.prepare(
    `SELECT ${vendorColumns} FROM vendors WHERE published = true AND active = true ORDER BY category, name`,
  ).all<VendorRow>();
  const photos = await db.prepare(
    `SELECT f.id, f.vendor_id FROM stored_files f
     JOIN vendors v ON v.id = f.vendor_id
     WHERE f.kind = 'vendor_photo' AND v.published = true AND v.active = true
     ORDER BY f.created_at`,
  ).all<{ id: string; vendor_id: string }>();
  const byVendor = new Map<string, { id: string }[]>();
  for (const photo of photos.results) {
    const list = byVendor.get(photo.vendor_id) ?? [];
    list.push({ id: photo.id });
    byVendor.set(photo.vendor_id, list);
  }
  return rows.results.map((row) => publicPartner(row, byVendor.get(row.id) ?? []));
}

function eventHref(plannerId: string | null, eventId: string) {
  if (plannerId) return `/admin/planner/${plannerId}`;
  return `/admin/calendar?event=${encodeURIComponent(eventId)}`;
}

export async function eventsAtVenue(venueId: string) {
  assertUuid(venueId, "Venue");
  const rows = await database().prepare(
    `SELECT e.id, e.name, e.event_date::text AS event_date, e.status,
            b.status AS booking_status, p.id AS planner_id
     FROM events e
     LEFT JOIN bookings b ON b.event_id = e.id
     LEFT JOIN planner_events p ON p.event_id = e.id
     WHERE e.venue_id = ?
     ORDER BY e.event_date NULLS LAST, e.created_at`,
  ).bind(venueId).all<{
    id: string;
    name: string;
    event_date: string | null;
    status: string;
    booking_status: string | null;
    planner_id: string | null;
  }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    eventDate: row.event_date,
    status: row.status,
    bookingStatus: row.booking_status || "",
    plannerId: row.planner_id,
    href: eventHref(row.planner_id, row.id),
  }));
}

export async function eventsForVendor(vendorId: string) {
  assertUuid(vendorId, "Partner");
  const rows = await database().prepare(
    `SELECT e.id, e.name, e.event_date::text AS event_date, e.status,
            b.status AS booking_status, p.id AS planner_id,
            ev.role, ev.contact_name, ev.company
     FROM event_vendors ev
     JOIN events e ON e.id = ev.event_id
     LEFT JOIN bookings b ON b.event_id = e.id
     LEFT JOIN planner_events p ON p.event_id = e.id
     WHERE ev.vendor_id = ?
     ORDER BY e.event_date NULLS LAST, e.created_at DESC`,
  ).bind(vendorId).all<{
    id: string;
    name: string;
    event_date: string | null;
    status: string;
    booking_status: string | null;
    planner_id: string | null;
    role: string;
    contact_name: string;
    company: string;
  }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    eventDate: row.event_date,
    status: row.status,
    bookingStatus: row.booking_status || "",
    role: row.role || "",
    contactName: row.contact_name || "",
    company: row.company || "",
    plannerId: row.planner_id,
    href: eventHref(row.planner_id, row.id),
  }));
}

export async function createVenue(input: {
  name: string;
  area?: string | null;
  address?: string | null;
  capacity?: string | null;
  description?: string | null;
  amenities?: string | null;
  serviceArea?: string | null;
  notes?: string | null;
  mbProduction?: boolean | null;
}, actor?: Actor) {
  const name = clean(input.name, 200);
  if (name.length < 1) throw new AppError("Add a venue name.", 400);
  const id = crypto.randomUUID();
  await database().prepare(
    `INSERT INTO venues (id, name, area, address, capacity, description, amenities, service_area, notes, mb_production, published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false)`,
  ).bind(
    id,
    name,
    clean(input.area, 120),
    clean(input.address, 300),
    clean(input.capacity, 80),
    clean(input.description, 4000),
    clean(input.amenities, 2000),
    clean(input.serviceArea, 200),
    clean(input.notes, 4000),
    input.mbProduction === true,
  ).run();
  const venue = await staffVenueById(id);
  if (actor) {
    await audit({ actorEmail: actor.email, userId: actor.userId, ip: actor.ip, action: "venue_created", entity: "venues", subjectId: id, after: { name, published: false } });
  }
  return venue;
}

async function venueRow(id: string) {
  assertUuid(id, "Venue");
  return database().prepare(`SELECT ${venueColumns} FROM venues WHERE id = ?`).bind(id).first<VenueRow>();
}

export async function staffVenueById(id: string) {
  const row = await venueRow(id);
  if (!row) throw new AppError("Venue not found.", 404);
  const db = database();
  const [photos, events, leads, upcomingBookings] = await Promise.all([
    db.prepare(
      "SELECT id, filename FROM stored_files WHERE venue_id = ? AND kind = 'venue_photo' ORDER BY created_at",
    ).bind(id).all<{ id: string; filename: string }>(),
    eventsAtVenue(id),
    db.prepare(
      `SELECT id, name, stage, event_date::text AS event_date, created_at::text AS created_at
       FROM leads WHERE venue_id = ? AND merged_into_id IS NULL
       ORDER BY created_at DESC LIMIT 40`,
    ).bind(id).all<{ id: string; name: string; stage: string; event_date: string | null; created_at: string }>(),
    db.prepare(
      `SELECT e.id, e.name, e.event_date::text AS event_date, b.status AS booking_status, p.id AS planner_id
       FROM events e
       JOIN bookings b ON b.event_id = e.id
       LEFT JOIN planner_events p ON p.event_id = e.id
       WHERE e.venue_id = ?
         AND b.status IN ('tentative', 'confirmed', 'pending')
         AND (e.event_date IS NULL OR e.event_date >= CURRENT_DATE)
       ORDER BY e.event_date NULLS LAST
       LIMIT 40`,
    ).bind(id).all<{ id: string; name: string; event_date: string | null; booking_status: string; planner_id: string | null }>(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((event) => !event.eventDate || event.eventDate >= today);
  const past = events.filter((event) => event.eventDate && event.eventDate < today);
  return {
    ...staffVenue(row, photos.results),
    events,
    upcomingEvents: upcoming,
    pastEvents: past,
    leads: leads.results.map((lead) => ({
      id: lead.id,
      name: lead.name,
      stage: lead.stage,
      eventDate: lead.event_date,
      href: `/admin/leads/${lead.id}`,
    })),
    /** MB booking holds/confirmations linked to this venue — not a third-party venue calendar. */
    mbBookings: upcomingBookings.results.map((row) => ({
      id: row.id,
      name: row.name,
      eventDate: row.event_date,
      bookingStatus: row.booking_status,
      href: eventHref(row.planner_id, row.id),
    })),
    availability: {
      managedByMb: true,
      thirdPartyCalendar: false,
      detail: "MB Events only shows bookings linked to this venue record. It does not control the venue’s own calendar or inventory.",
    },
    /** Rental rates are not a first-class store — only free-text notes if staff entered them. */
    pricing: {
      tracked: false,
      detail: "Venue rental amounts are not stored as a pricing catalog. Use internal notes or the event finance room for real figures.",
    },
  };
}

export async function listStaffVenues() {
  const rows = await database().prepare(
    `SELECT ${venueColumns},
            (SELECT count(*)::int FROM events e WHERE e.venue_id = venues.id) AS event_count,
            (SELECT count(*)::int FROM leads l WHERE l.venue_id = venues.id AND l.merged_into_id IS NULL) AS lead_count
     FROM venues
     ORDER BY name`,
  ).all<VenueRow & { event_count: number; lead_count: number }>();
  return rows.results.map((row) => ({
    ...staffVenue(row, []),
    eventCount: Number(row.event_count),
    leadCount: Number(row.lead_count),
  }));
}

export async function updateVenue(id: string, patch: {
  name?: string;
  area?: string;
  address?: string;
  capacity?: string;
  description?: string;
  amenities?: string;
  serviceArea?: string;
  notes?: string;
  active?: boolean;
  published?: boolean;
  mbProduction?: boolean;
}, actor: Actor) {
  const current = await venueRow(id);
  if (!current) throw new AppError("Venue not found.", 404);
  const next = {
    name: patch.name !== undefined ? clean(patch.name, 200) : current.name,
    area: patch.area !== undefined ? clean(patch.area, 120) : current.area,
    address: patch.address !== undefined ? clean(patch.address, 300) : current.address,
    capacity: patch.capacity !== undefined ? clean(patch.capacity, 80) : current.capacity,
    description: patch.description !== undefined ? clean(patch.description, 4000) : current.description,
    amenities: patch.amenities !== undefined ? clean(patch.amenities, 2000) : current.amenities,
    serviceArea: patch.serviceArea !== undefined ? clean(patch.serviceArea, 200) : current.service_area,
    notes: patch.notes !== undefined ? clean(patch.notes, 4000) : current.notes,
    active: patch.active !== undefined ? patch.active : flagged(current.active),
    published: patch.published !== undefined ? patch.published : flagged(current.published),
    mbProduction: patch.mbProduction !== undefined ? patch.mbProduction : flagged(current.mb_production),
  };
  if (!next.name) throw new AppError("Add a venue name.", 400);
  await database().prepare(
    `UPDATE venues
     SET name = ?, area = ?, address = ?, capacity = ?, description = ?, amenities = ?, service_area = ?, notes = ?,
         active = ?, published = ?, mb_production = ?, updated_at = now()
     WHERE id = ?`,
  ).bind(
    next.name, next.area, next.address, next.capacity, next.description, next.amenities, next.serviceArea, next.notes,
    next.active, next.published, next.mbProduction, id,
  ).run();
  if (flagged(current.published) !== next.published) {
    await audit({
      actorEmail: actor.email,
      userId: actor.userId,
      ip: actor.ip,
      action: "venue_published",
      entity: "venues",
      subjectId: id,
      before: { published: flagged(current.published) },
      after: { published: next.published },
    });
  }
  return staffVenueById(id);
}

export async function createVendor(input: {
  name: string;
  category?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  description?: string | null;
  area?: string | null;
  notes?: string | null;
  relationshipNotes?: string | null;
  preferred?: boolean | null;
  verified?: boolean | null;
}, actor?: Actor) {
  const name = clean(input.name, 200);
  if (name.length < 1) throw new AppError("Add a partner name.", 400);
  const id = crypto.randomUUID();
  await database().prepare(
    `INSERT INTO vendors (
       id, name, category, contact_name, email, phone, description, area, notes, relationship_notes, preferred, verified, published
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false)`,
  ).bind(
    id,
    name,
    clean(input.category, 80),
    clean(input.contactName, 200),
    clean(input.email, 200).toLowerCase(),
    clean(input.phone, 40),
    clean(input.description, 4000),
    clean(input.area, 120),
    clean(input.notes, 4000),
    clean(input.relationshipNotes, 4000),
    input.preferred === true,
    input.verified === true,
  ).run();
  const vendor = await staffVendorById(id);
  if (actor) {
    await audit({ actorEmail: actor.email, userId: actor.userId, ip: actor.ip, action: "vendor_created", entity: "vendors", subjectId: id, after: { name, published: false } });
  }
  return vendor;
}

async function vendorRow(id: string) {
  assertUuid(id, "Partner");
  return database().prepare(`SELECT ${vendorColumns} FROM vendors WHERE id = ?`).bind(id).first<VendorRow>();
}

export async function staffVendorById(id: string) {
  const row = await vendorRow(id);
  if (!row) throw new AppError("Partner not found.", 404);
  const db = database();
  const [photos, assignments, leads, tasks] = await Promise.all([
    db.prepare(
      "SELECT id, filename FROM stored_files WHERE vendor_id = ? AND kind = 'vendor_photo' ORDER BY created_at",
    ).bind(id).all<{ id: string; filename: string }>(),
    eventsForVendor(id),
    db.prepare(
      `SELECT id, name, stage, event_date::text AS event_date, created_at::text AS created_at
       FROM leads WHERE vendor_id = ? AND merged_into_id IS NULL
       ORDER BY created_at DESC LIMIT 40`,
    ).bind(id).all<{ id: string; name: string; stage: string; event_date: string | null; created_at: string }>(),
    db.prepare(
      `SELECT t.id, t.title, t.due_on::text AS due_on, t.done, t.event_id, e.name AS event_name, p.id AS planner_id
       FROM tasks t
       JOIN events e ON e.id = t.event_id
       JOIN event_vendors ev ON ev.event_id = e.id AND ev.vendor_id = ?
       LEFT JOIN planner_events p ON p.event_id = e.id
       ORDER BY t.done, t.due_on NULLS LAST, t.created_at DESC
       LIMIT 40`,
    ).bind(id).all<{
      id: string;
      title: string;
      due_on: string | null;
      done: boolean;
      event_id: string;
      event_name: string;
      planner_id: string | null;
    }>(),
  ]);
  return {
    ...staffVendor(row, photos.results),
    assignments,
    events: assignments,
    leads: leads.results.map((lead) => ({
      id: lead.id,
      name: lead.name,
      stage: lead.stage,
      eventDate: lead.event_date,
      href: `/admin/leads/${lead.id}`,
    })),
    tasks: tasks.results.map((task) => ({
      id: task.id,
      title: task.title,
      dueOn: task.due_on,
      done: task.done,
      eventName: task.event_name,
      href: task.planner_id
        ? `/admin/planner/${task.planner_id}`
        : `/admin/tasks`,
    })),
    /** Quotes/contracts/payments are event-scoped in finance — not vendor AR. */
    finance: {
      quotesTracked: false,
      contractsTracked: false,
      balancesTracked: false,
      detail: "Vendor quotes, contracts, and amounts owed are not stored on the partner record. Use each event’s finance room for real payment rows.",
    },
  };
}

export async function listStaffVendors() {
  const rows = await database().prepare(
    `SELECT ${vendorColumns},
            (SELECT count(*)::int FROM event_vendors ev WHERE ev.vendor_id = vendors.id) AS assignment_count,
            (SELECT count(*)::int FROM leads l WHERE l.vendor_id = vendors.id AND l.merged_into_id IS NULL) AS lead_count
     FROM vendors
     ORDER BY category, name`,
  ).all<VendorRow & { assignment_count: number; lead_count: number }>();
  return rows.results.map((row) => ({
    ...staffVendor(row, []),
    assignmentCount: Number(row.assignment_count),
    leadCount: Number(row.lead_count),
  }));
}

export async function selectableVendors() {
  const rows = await database().prepare(
    `SELECT id, name, category, description, area, contact_name, email, phone
     FROM vendors WHERE preferred = true AND active = true ORDER BY category, name`,
  ).all<{ id: string; name: string; category: string; description: string; area: string; contact_name: string; email: string; phone: string }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    area: row.area,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
  }));
}

export async function updateVendor(id: string, patch: {
  name?: string;
  category?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  description?: string;
  area?: string;
  notes?: string;
  relationshipNotes?: string;
  preferred?: boolean;
  active?: boolean;
  published?: boolean;
  verified?: boolean;
}, actor: Actor) {
  const current = await vendorRow(id);
  if (!current) throw new AppError("Partner not found.", 404);
  const next = {
    name: patch.name !== undefined ? clean(patch.name, 200) : current.name,
    category: patch.category !== undefined ? clean(patch.category, 80) : current.category,
    contactName: patch.contactName !== undefined ? clean(patch.contactName, 200) : current.contact_name,
    email: patch.email !== undefined ? clean(patch.email, 200).toLowerCase() : current.email,
    phone: patch.phone !== undefined ? clean(patch.phone, 40) : current.phone,
    description: patch.description !== undefined ? clean(patch.description, 4000) : current.description,
    area: patch.area !== undefined ? clean(patch.area, 120) : current.area,
    notes: patch.notes !== undefined ? clean(patch.notes, 4000) : current.notes,
    relationshipNotes: patch.relationshipNotes !== undefined ? clean(patch.relationshipNotes, 4000) : current.relationship_notes,
    preferred: patch.preferred !== undefined ? patch.preferred : flagged(current.preferred),
    active: patch.active !== undefined ? patch.active : flagged(current.active),
    published: patch.published !== undefined ? patch.published : flagged(current.published),
    verified: patch.verified !== undefined ? patch.verified : flagged(current.verified),
  };
  if (!next.name) throw new AppError("Add a partner name.", 400);
  await database().prepare(
    `UPDATE vendors
     SET name = ?, category = ?, contact_name = ?, email = ?, phone = ?, description = ?, area = ?, notes = ?,
         relationship_notes = ?, preferred = ?, active = ?, published = ?, verified = ?, updated_at = now()
     WHERE id = ?`,
  ).bind(
    next.name, next.category, next.contactName, next.email, next.phone, next.description, next.area, next.notes,
    next.relationshipNotes, next.preferred, next.active, next.published, next.verified, id,
  ).run();
  if (flagged(current.published) !== next.published) {
    await audit({
      actorEmail: actor.email,
      userId: actor.userId,
      ip: actor.ip,
      action: "vendor_published",
      entity: "vendors",
      subjectId: id,
      before: { published: flagged(current.published) },
      after: { published: next.published },
    });
  }
  return staffVendorById(id);
}

async function matchingVenueId(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const rows = await database().prepare(
    "SELECT id FROM venues WHERE lower(name) = lower(?) AND published = true AND active = true",
  ).bind(trimmed).all<{ id: string }>();
  return rows.results.length === 1 ? rows.results[0].id : null;
}

export async function attachInquiryLinks(leadId: string, input: {
  source: string;
  location?: string | null;
  venueName?: string | null;
  venueId?: string | null;
  vendorId?: string | null;
  referredBy?: string | null;
}) {
  let venueId: string | null = null;
  if (input.venueId && uuidPattern.test(input.venueId)) {
    const row = await database().prepare(
      "SELECT id FROM venues WHERE id = ? AND published = true AND active = true",
    ).bind(input.venueId).first<{ id: string }>();
    if (row) venueId = row.id;
  } else if (input.source === "venue") {
    venueId = await matchingVenueId(input.venueName || "") || await matchingVenueId(input.location || "");
  }
  let vendorId: string | null = null;
  if (input.vendorId && uuidPattern.test(input.vendorId)) {
    const row = await database().prepare(
      "SELECT id FROM vendors WHERE id = ? AND published = true AND active = true",
    ).bind(input.vendorId).first<{ id: string }>();
    if (row) vendorId = row.id;
  }
  const referredBy = clean(input.referredBy, 200) || null;
  if (!venueId && !vendorId && !referredBy) return { venueId, vendorId, referredBy };
  await database().prepare(
    `UPDATE leads
     SET venue_id = COALESCE(?, venue_id), vendor_id = COALESCE(?, vendor_id), referred_by = COALESCE(?, referred_by), updated_at = now()
     WHERE id = ?`,
  ).bind(venueId, vendorId, referredBy, leadId).run();
  return { venueId, vendorId, referredBy };
}

export async function copyLeadPlaceToEvent(leadId: string, eventId: string) {
  await database().prepare(
    `UPDATE events
     SET venue_id = COALESCE(events.venue_id, leads.venue_id),
         referred_by = COALESCE(events.referred_by, leads.referred_by)
     FROM leads
     WHERE events.id = ? AND leads.id = ?`,
  ).bind(eventId, leadId).run();
}

export async function setAttribution(input: {
  entity: "lead" | "event";
  id: string;
  referredBy?: string | null;
  venueId?: string | null;
}) {
  assertUuid(input.id, input.entity === "lead" ? "Lead" : "Event");
  const referredBy = input.referredBy === undefined ? undefined : (clean(input.referredBy, 200) || null);
  let venueId: string | null | undefined = input.venueId;
  if (venueId) {
    assertUuid(venueId, "Venue");
    const venue = await database().prepare("SELECT id FROM venues WHERE id = ?").bind(venueId).first<{ id: string }>();
    if (!venue) throw new AppError("Venue not found.", 404);
  }
  if (input.entity === "lead") {
    const lead = await database().prepare("SELECT id FROM leads WHERE id = ?").bind(input.id).first<{ id: string }>();
    if (!lead) throw new AppError("Lead not found.", 404);
    if (referredBy !== undefined) await database().prepare("UPDATE leads SET referred_by = ?, updated_at = now() WHERE id = ?").bind(referredBy, input.id).run();
    if (venueId !== undefined) await database().prepare("UPDATE leads SET venue_id = ?, updated_at = now() WHERE id = ?").bind(venueId, input.id).run();
    return;
  }
  const event = await database().prepare("SELECT id FROM events WHERE id = ?").bind(input.id).first<{ id: string }>();
  if (!event) throw new AppError("Event not found.", 404);
  if (referredBy !== undefined) await database().prepare("UPDATE events SET referred_by = ?, updated_at = now() WHERE id = ?").bind(referredBy, input.id).run();
  if (venueId !== undefined) await database().prepare("UPDATE events SET venue_id = ?, updated_at = now() WHERE id = ?").bind(venueId, input.id).run();
}

type TeamMember = { id: string; name: string; role: string; company: string; phone: string; email: string; vendorId?: string };

export async function syncEventVendors(eventId: string, team: TeamMember[]) {
  const db = database();
  const current = await db.prepare("SELECT id, source_key, vendor_id FROM event_vendors WHERE event_id = ?").bind(eventId).all<{ id: string; source_key: string; vendor_id: string | null }>();
  const bySource = new Map(current.results.filter((row) => row.source_key).map((row) => [row.source_key, row]));
  const byVendor = new Map(current.results.filter((row) => row.vendor_id).map((row) => [row.vendor_id as string, row]));
  const keep = new Set<string>();
  for (const member of team) {
    let vendorId: string | null = null;
    if (member.vendorId && uuidPattern.test(member.vendorId)) {
      const vendor = await db.prepare("SELECT id FROM vendors WHERE id = ?").bind(member.vendorId).first<{ id: string }>();
      if (vendor) vendorId = vendor.id;
    }
    const sourceRow = bySource.get(member.id);
    const vendorRow = vendorId ? byVendor.get(vendorId) : undefined;
    if (vendorRow && sourceRow && vendorRow.id !== sourceRow.id) {
      await db.prepare("DELETE FROM event_vendors WHERE id = ?").bind(sourceRow.id).run();
      bySource.delete(member.id);
    }
    const row = vendorRow ?? sourceRow;
    const values = [vendorId, member.id.slice(0, 80), clean(member.role, 200), clean(member.name, 200), clean(member.company, 200), clean(member.phone, 40), clean(member.email, 200)];
    if (row) {
      await db.prepare(
        "UPDATE event_vendors SET vendor_id = ?, source_key = ?, role = ?, contact_name = ?, company = ?, phone = ?, email = ? WHERE id = ?",
      ).bind(...values, row.id).run();
      keep.add(row.id);
      bySource.set(member.id, { id: row.id, source_key: member.id, vendor_id: vendorId });
      if (vendorId) byVendor.set(vendorId, { id: row.id, source_key: member.id, vendor_id: vendorId });
    } else {
      const id = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO event_vendors (id, event_id, vendor_id, source_key, role, contact_name, company, phone, email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, eventId, ...values).run();
      keep.add(id);
      bySource.set(member.id, { id, source_key: member.id, vendor_id: vendorId });
      if (vendorId) byVendor.set(vendorId, { id, source_key: member.id, vendor_id: vendorId });
    }
  }
  for (const row of current.results) {
    if (row.source_key && !keep.has(row.id)) await db.prepare("DELETE FROM event_vendors WHERE id = ?").bind(row.id).run();
  }
}

export async function readPublishedPhoto(kind: "venue_photo" | "vendor_photo", id: string) {
  if (!uuidPattern.test(id)) throw new AppError("File not found.", 404);
  const row = await database().prepare(
    `SELECT f.filename, f.content_type, f.storage_key
     FROM stored_files f
     LEFT JOIN venues venue ON venue.id = f.venue_id
     LEFT JOIN vendors partner ON partner.id = f.vendor_id
     WHERE f.id = ? AND f.kind = ?
       AND (
         (f.kind = 'venue_photo' AND venue.published = true AND venue.active = true)
         OR (f.kind = 'vendor_photo' AND partner.published = true AND partner.active = true)
       )`,
  ).bind(id, kind).first<{ filename: string; content_type: string; storage_key: string }>();
  if (!row) throw new AppError("File not found.", 404);
  const body = await fileStore().get(row.storage_key);
  if (!body) throw new AppError("File not found.", 404);
  return { filename: row.filename, contentType: row.content_type, bytes: body.bytes };
}
