import { audit } from "@/lib/audit";
import { assertCan, can, type Role } from "@/lib/authz";
import { phoneKey } from "@/lib/crm";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { ledgerForEvents } from "@/lib/finance";
import { cleanEmail } from "@/lib/records";

/**
 * Customer directory and profile helpers.
 * Reads the existing customers table — does not create a second CRM store.
 * Internal lead notes stay admin-only (never returned to portal clients).
 */

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

export type CustomerActor = { email: string; userId?: string | null; role: Role };

export type CustomerDuplicate = {
  id: string;
  name: string;
  email: string;
  phone: string;
  eventCount: number;
  leadCount: number;
  reason: "email" | "phone";
};

export type CustomerNextAction = {
  label: string;
  detail: string;
  href: string;
  tone?: "default" | "urgent" | "warn";
};

function money(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function shortDate(value: string | null) {
  if (!value) return "";
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value;
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function plannerHref(plannerId: string | null, eventId: string, room = "overview") {
  if (plannerId) return `/admin/planner/${plannerId}?room=${room}`;
  return `/admin/calendar?event=${encodeURIComponent(eventId)}`;
}

export async function customerById(id: string) {
  return database().prepare(
    "SELECT id, name, email, phone, marketing_opt_in, created_at::text AS created_at, updated_at::text AS updated_at FROM customers WHERE id = ?",
  ).bind(id).first<{
    id: string;
    name: string;
    email: string;
    phone: string;
    marketing_opt_in: boolean | null;
    created_at: string;
    updated_at: string;
  }>();
}

export async function findCustomerDuplicates(customerId: string, email: string, phone: string): Promise<CustomerDuplicate[]> {
  const normalized = cleanEmail(email);
  const key = phoneKey(phone);
  if (!normalized && !key) return [];
  const rows = await database().prepare(
    `SELECT c.id, c.name, c.email, c.phone,
            (SELECT count(*)::int FROM events e WHERE e.customer_id = c.id) AS event_count,
            (SELECT count(*)::int FROM leads l WHERE l.customer_id = c.id AND l.merged_into_id IS NULL) AS lead_count,
            CASE
              WHEN ? <> '' AND lower(btrim(c.email)) = ? THEN 'email'
              ELSE 'phone'
            END AS reason
     FROM customers c
     WHERE c.id <> ?
       AND (
         (? <> '' AND lower(btrim(c.email)) = ?)
         OR (? = '' AND ? <> '' AND btrim(c.email) = '' AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = ?)
       )
     ORDER BY c.updated_at DESC
     LIMIT 20`,
  ).bind(normalized, normalized, customerId, normalized, normalized, normalized, key, key).all<{
    id: string;
    name: string;
    email: string;
    phone: string;
    event_count: number;
    lead_count: number;
    reason: "email" | "phone";
  }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    eventCount: Number(row.event_count),
    leadCount: Number(row.lead_count),
    reason: row.reason,
  }));
}

export async function updateCustomer(
  id: string,
  patch: { name?: string; email?: string; phone?: string },
  actor: CustomerActor,
) {
  assertCan(actor.role, "customers.write");
  const current = await customerById(id);
  if (!current) throw new AppError("Customer not found.", 404);

  const name = patch.name !== undefined ? patch.name.trim().slice(0, 200) || current.name : current.name;
  const email = patch.email !== undefined ? cleanEmail(patch.email) : cleanEmail(current.email);
  const phone = patch.phone !== undefined ? patch.phone.trim().slice(0, 40) : (current.phone || "");

  if (email && email !== cleanEmail(current.email)) {
    const clash = await database().prepare(
      "SELECT id FROM customers WHERE email = ? AND id <> ?",
    ).bind(email, id).first<{ id: string }>();
    if (clash) throw new AppError("Another customer already uses that email. Merge them instead.", 409);
  }

  await database().prepare(
    "UPDATE customers SET name = ?, email = ?, phone = ?, updated_at = now() WHERE id = ?",
  ).bind(name, email, phone, id).run();

  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    action: "customer_updated",
    entity: "customers",
    subjectId: id,
    before: { name: current.name, email: current.email, phone: current.phone },
    after: { name, email, phone },
  });

  return customerById(id);
}

/**
 * Safe merge: survivor keeps identity; absorbed rows re-point then the empty
 * customer is removed. Email uniqueness is preserved on the survivor.
 */
export async function mergeCustomers(survivorId: string, absorbedId: string, actor: CustomerActor) {
  assertCan(actor.role, "customers.write");
  if (survivorId === absorbedId) throw new AppError("Choose two different customers.", 400);

  const survivor = await customerById(survivorId);
  const absorbed = await customerById(absorbedId);
  if (!survivor || !absorbed) throw new AppError("Customer not found.", 404);

  const survivorEmail = cleanEmail(survivor.email);
  const absorbedEmail = cleanEmail(absorbed.email);
  if (survivorEmail && absorbedEmail && survivorEmail !== absorbedEmail) {
    throw new AppError("Merge only customers that share an email, or clear one email first.", 409);
  }

  const name = survivor.name.trim() || absorbed.name;
  const email = survivorEmail || absorbedEmail;
  const phone = (survivor.phone || "").trim() || (absorbed.phone || "").trim();
  const marketing = survivor.marketing_opt_in ?? absorbed.marketing_opt_in;

  const db = database();
  await db.batch([
    db.prepare("UPDATE events SET customer_id = ? WHERE customer_id = ?").bind(survivorId, absorbedId),
    db.prepare("UPDATE leads SET customer_id = ? WHERE customer_id = ?").bind(survivorId, absorbedId),
    db.prepare("UPDATE notifications SET customer_id = ? WHERE customer_id = ?").bind(survivorId, absorbedId),
    db.prepare("UPDATE message_jobs SET customer_id = ? WHERE customer_id = ?").bind(survivorId, absorbedId),
    db.prepare(
      "UPDATE customers SET name = ?, email = ?, phone = ?, marketing_opt_in = ?, updated_at = now() WHERE id = ?",
    ).bind(name, email, phone, marketing, survivorId),
    db.prepare("DELETE FROM customers WHERE id = ?").bind(absorbedId),
  ]);

  await audit({
    actorEmail: actor.email,
    userId: actor.userId,
    action: "customer_merged",
    entity: "customers",
    subjectId: survivorId,
    before: { absorbedId, absorbedEmail, absorbedName: absorbed.name },
    after: { name, email, phone },
  });
}

export async function customerProfile(id: string, role: Role) {
  assertCan(role, "customers.read");
  const customer = await customerById(id);
  if (!customer) return null;

  const db = database();
  const showPayments = can(role, "payments.read");
  const showProposals = can(role, "proposals.read");
  const showContracts = can(role, "contracts.read");
  const showComms = can(role, "notifications.read");
  const showTasks = can(role, "tasks.read");
  const canWrite = can(role, "customers.write");
  const canPlanner = can(role, "events.write");

  const events = await db.prepare(
    `SELECT e.id, e.name, e.event_type, e.event_date::text AS event_date, e.status AS event_status,
            e.location, e.guest_count, e.lead_id,
            b.status AS booking_status, b.hold_until::text AS hold_until,
            p.id AS planner_id, p.code AS planner_code,
            (p.password_hash IS NOT NULL AND p.password_hash <> '') AS planner_has_password,
            (p.guest_code IS NOT NULL AND p.guest_code <> '') AS planner_has_guest
     FROM events e
     LEFT JOIN bookings b ON b.event_id = e.id
     LEFT JOIN planner_events p ON p.event_id = e.id
     WHERE e.customer_id = ?
     ORDER BY e.event_date DESC NULLS LAST, e.created_at DESC`,
  ).bind(id).all<{
    id: string;
    name: string;
    event_type: string;
    event_date: string | null;
    event_status: string;
    location: string | null;
    guest_count: string | null;
    lead_id: string | null;
    booking_status: string | null;
    hold_until: string | null;
    planner_id: string | null;
    planner_code: string | null;
    planner_has_password: boolean;
    planner_has_guest: boolean;
  }>();

  const eventIds = events.results.map((row) => row.id);
  const today = new Date().toISOString().slice(0, 10);

  const [leads, tasks, duplicates, proposals, contracts, payments, notifications, messageJobs, ledgers] = await Promise.all([
    db.prepare(
      `SELECT id, name, stage, source, email, phone, event_type, event_date::text AS event_date,
              notes, converted_event_id, created_at::text AS created_at
       FROM leads
       WHERE customer_id = ? AND merged_into_id IS NULL
       ORDER BY created_at DESC
       LIMIT 50`,
    ).bind(id).all<{
      id: string;
      name: string;
      stage: string;
      source: string;
      email: string;
      phone: string;
      event_type: string;
      event_date: string | null;
      notes: string | null;
      converted_event_id: string | null;
      created_at: string;
    }>(),
    showTasks
      ? db.prepare(
          `SELECT t.id, t.title, t.due_on::text AS due_on, t.done, t.lead_id, t.event_id,
                  l.name AS lead_name, e.name AS event_name, s.name AS assignee_name
           FROM tasks t
           LEFT JOIN leads l ON l.id = t.lead_id
           LEFT JOIN events e ON e.id = t.event_id
           LEFT JOIN staff s ON s.id = t.assignee_id
           WHERE (t.lead_id IN (SELECT id FROM leads WHERE customer_id = ?)
              OR t.event_id IN (SELECT id FROM events WHERE customer_id = ?))
           ORDER BY t.done, t.due_on NULLS LAST, t.created_at DESC
           LIMIT 40`,
        ).bind(id, id).all<{
          id: string;
          title: string;
          due_on: string | null;
          done: boolean;
          lead_id: string | null;
          event_id: string | null;
          lead_name: string | null;
          event_name: string | null;
          assignee_name: string | null;
        }>()
      : Promise.resolve({ results: [] as { id: string; title: string; due_on: string | null; done: boolean; lead_id: string | null; event_id: string | null; lead_name: string | null; event_name: string | null; assignee_name: string | null }[] }),
    findCustomerDuplicates(id, customer.email, customer.phone),
    showProposals
      ? db.prepare(
          `SELECT pr.id, pr.event_id, pr.title, pr.status, e.name AS event_name, p.id AS planner_id,
                  (SELECT v.kind FROM proposal_versions v WHERE v.proposal_id = pr.id ORDER BY v.number DESC LIMIT 1) AS latest_kind,
                  (SELECT v.sent_at::text FROM proposal_versions v WHERE v.proposal_id = pr.id ORDER BY v.number DESC LIMIT 1) AS latest_sent_at,
                  (SELECT v.accepted_at::text FROM proposal_versions v WHERE v.proposal_id = pr.id ORDER BY v.number DESC LIMIT 1) AS latest_accepted_at
           FROM proposals pr
           JOIN events e ON e.id = pr.event_id
           LEFT JOIN planner_events p ON p.event_id = e.id
           WHERE e.customer_id = ?
           ORDER BY pr.updated_at DESC`,
        ).bind(id).all<{
          id: string;
          event_id: string;
          title: string;
          status: string;
          event_name: string;
          planner_id: string | null;
          latest_kind: string | null;
          latest_sent_at: string | null;
          latest_accepted_at: string | null;
        }>()
      : Promise.resolve({ results: [] as { id: string; event_id: string; title: string; status: string; event_name: string; planner_id: string | null; latest_kind: string | null; latest_sent_at: string | null; latest_accepted_at: string | null }[] }),
    showContracts
      ? db.prepare(
          `SELECT c.id, c.event_id, c.title, c.status, c.signed_at::text AS signed_at,
                  e.name AS event_name, p.id AS planner_id
           FROM contracts c
           JOIN events e ON e.id = c.event_id
           LEFT JOIN planner_events p ON p.event_id = e.id
           WHERE e.customer_id = ?
           ORDER BY c.updated_at DESC`,
        ).bind(id).all<{
          id: string;
          event_id: string;
          title: string;
          status: string;
          signed_at: string | null;
          event_name: string;
          planner_id: string | null;
        }>()
      : Promise.resolve({ results: [] as { id: string; event_id: string; title: string; status: string; signed_at: string | null; event_name: string; planner_id: string | null }[] }),
    showPayments
      ? db.prepare(
          `SELECT pay.id, pay.event_id, pay.label, pay.amount_cents, pay.due_on::text AS due_on,
                  pay.status, pay.kind, pay.paid_at::text AS paid_at, e.name AS event_name, p.id AS planner_id
           FROM payments pay
           JOIN events e ON e.id = pay.event_id
           LEFT JOIN planner_events p ON p.event_id = e.id
           WHERE e.customer_id = ? AND pay.status <> 'void'
           ORDER BY pay.due_on NULLS LAST, pay.created_at DESC`,
        ).bind(id).all<{
          id: string;
          event_id: string;
          label: string;
          amount_cents: number;
          due_on: string | null;
          status: string;
          kind: string | null;
          paid_at: string | null;
          event_name: string;
          planner_id: string | null;
        }>()
      : Promise.resolve({ results: [] as { id: string; event_id: string; label: string; amount_cents: number; due_on: string | null; status: string; kind: string | null; paid_at: string | null; event_name: string; planner_id: string | null }[] }),
    showComms
      ? db.prepare(
          `SELECT id, channel, topic, status, created_at::text AS created_at, sent_at::text AS sent_at, event_id
           FROM notifications
           WHERE customer_id = ?
              OR event_id IN (SELECT id FROM events WHERE customer_id = ?)
           ORDER BY created_at DESC
           LIMIT 40`,
        ).bind(id, id).all<{
          id: string;
          channel: string;
          topic: string;
          status: string;
          created_at: string;
          sent_at: string | null;
          event_id: string | null;
        }>()
      : Promise.resolve({ results: [] as { id: string; channel: string; topic: string; status: string; created_at: string; sent_at: string | null; event_id: string | null }[] }),
    showComms
      ? db.prepare(
          `SELECT id, channel, kind, status, subject, to_address, created_at::text AS created_at,
                  sent_at::text AS sent_at, event_id, last_error
           FROM message_jobs
           WHERE customer_id = ?
              OR event_id IN (SELECT id FROM events WHERE customer_id = ?)
           ORDER BY created_at DESC
           LIMIT 40`,
        ).bind(id, id).all<{
          id: string;
          channel: string;
          kind: string;
          status: string;
          subject: string;
          to_address: string;
          created_at: string;
          sent_at: string | null;
          event_id: string | null;
          last_error: string;
        }>()
      : Promise.resolve({ results: [] as { id: string; channel: string; kind: string; status: string; subject: string; to_address: string; created_at: string; sent_at: string | null; event_id: string | null; last_error: string }[] }),
    showPayments && eventIds.length ? ledgerForEvents(eventIds) : Promise.resolve(new Map()),
  ]);

  const eventRows = events.results.map((row) => {
    const ledger = ledgers.get(row.id);
    return {
      id: row.id,
      name: row.name,
      eventType: row.event_type,
      eventDate: row.event_date,
      eventStatus: row.event_status,
      location: row.location || "",
      guestCount: row.guest_count || "",
      leadId: row.lead_id,
      bookingStatus: row.booking_status || "",
      holdUntil: row.hold_until,
      plannerId: row.planner_id,
      href: plannerHref(row.planner_id, row.id),
      balanceCents: showPayments ? (ledger?.balanceCents ?? null) : null,
      paidCents: showPayments ? (ledger?.paidCents ?? null) : null,
      dueCents: showPayments ? (ledger?.dueCents ?? null) : null,
    };
  });

  const activeBookings = eventRows.filter((row) => {
    if (!row.bookingStatus || row.bookingStatus === "canceled") return false;
    if (!row.eventDate) return row.bookingStatus === "tentative" || row.bookingStatus === "confirmed";
    return row.eventDate >= today;
  });

  const pastEvents = eventRows.filter((row) => row.eventDate && row.eventDate < today);

  let balanceCents = 0;
  let paidCents = 0;
  let dueCents = 0;
  let hasLedger = false;
  if (showPayments) {
    for (const row of eventRows) {
      if (row.balanceCents != null || row.paidCents != null || row.dueCents != null) {
        hasLedger = true;
        balanceCents += row.balanceCents ?? 0;
        paidCents += row.paidCents ?? 0;
        dueCents += row.dueCents ?? 0;
      }
    }
  }

  const internalNotes = leads.results
    .filter((lead) => lead.notes?.trim())
    .map((lead) => ({
      leadId: lead.id,
      leadName: lead.name,
      body: lead.notes!.trim(),
      createdAt: lead.created_at,
    }));

  const followUps = tasks.results.map((task) => ({
    id: task.id,
    title: task.title,
    dueOn: task.due_on,
    done: task.done,
    assigneeName: task.assignee_name,
    context: task.lead_name || task.event_name || "General",
    href: task.lead_id
      ? `/admin/leads/${task.lead_id}`
      : task.event_id
        ? plannerHref(
            events.results.find((event) => event.id === task.event_id)?.planner_id ?? null,
            task.event_id,
          )
        : "/admin/tasks",
    overdue: !task.done && !!task.due_on && task.due_on <= today,
  }));

  const plannerAccess = events.results
    .filter((row) => row.planner_id)
    .map((row) => ({
      eventId: row.id,
      eventName: row.name,
      plannerId: row.planner_id!,
      code: row.planner_code || "",
      hasPassword: !!row.planner_has_password,
      hasGuestAccess: !!row.planner_has_guest,
      href: `/admin/planner/${row.planner_id}`,
      resetAllowed: canPlanner,
    }));

  const communications = [
    ...notifications.results.map((row) => ({
      id: row.id,
      source: "notification" as const,
      channel: row.channel,
      label: row.topic.replace(/_/g, " "),
      status: row.status,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      detail: "",
    })),
    ...messageJobs.results.map((row) => ({
      id: row.id,
      source: "message" as const,
      channel: row.channel,
      label: row.subject || row.kind,
      status: row.status,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      detail: row.to_address || row.last_error || "",
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 40);

  const nextActions: CustomerNextAction[] = [];
  for (const task of followUps.filter((row) => !row.done).slice(0, 4)) {
    nextActions.push({
      label: task.title,
      detail: `${task.context}${task.dueOn ? ` · due ${shortDate(task.dueOn)}` : ""}`,
      href: task.href,
      tone: task.overdue ? "urgent" : "default",
    });
  }
  for (const hold of activeBookings.filter((row) => row.bookingStatus === "tentative").slice(0, 2)) {
    nextActions.push({
      label: `Confirm hold · ${hold.name}`,
      detail: hold.holdUntil ? `Hold until ${shortDate(hold.holdUntil.slice(0, 10))}` : "Tentative booking",
      href: hold.href,
      tone: "warn",
    });
  }
  if (showPayments) {
    for (const pay of payments.results.filter((row) => row.status === "due").slice(0, 3)) {
      const overdue = pay.due_on && pay.due_on < today;
      nextActions.push({
        label: `${pay.label || "Payment"} · ${money(Number(pay.amount_cents))}`,
        detail: `${pay.event_name}${pay.due_on ? ` · due ${shortDate(pay.due_on)}` : ""}`,
        href: plannerHref(pay.planner_id, pay.event_id, "payments"),
        tone: overdue ? "urgent" : "warn",
      });
    }
  }
  for (const contract of contracts.results.filter((row) => row.status === "sent").slice(0, 2)) {
    nextActions.push({
      label: `Unsigned contract · ${contract.title || contract.event_name}`,
      detail: contract.event_name,
      href: plannerHref(contract.planner_id, contract.event_id, "payments"),
      tone: "warn",
    });
  }
  for (const proposal of proposals.results.filter((row) => row.status === "sent" || (row.latest_sent_at && !row.latest_accepted_at)).slice(0, 2)) {
    nextActions.push({
      label: `Open quote · ${proposal.title || proposal.event_name}`,
      detail: proposal.event_name,
      href: plannerHref(proposal.planner_id, proposal.event_id, "payments"),
      tone: "default",
    });
  }
  if (duplicates.length) {
    nextActions.push({
      label: `${duplicates.length} possible duplicate${duplicates.length === 1 ? "" : "s"}`,
      detail: "Review and merge if they are the same person",
      href: `#duplicates`,
      tone: "warn",
    });
  }

  const quickLinks = [
    { label: "All clients", href: "/admin/clients" },
    { label: "CRM leads", href: `/admin/leads?q=${encodeURIComponent(customer.email || customer.name)}` },
    ...(activeBookings[0] ? [{ label: "Latest booking", href: activeBookings[0].href }] : []),
    ...(showPayments && eventRows[0] ? [{ label: "Payments", href: plannerHref(eventRows[0].plannerId, eventRows[0].id, "payments") }] : []),
    { label: "Calendar", href: "/admin/calendar" },
  ];

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email || "",
      phone: customer.phone || "",
      marketingOptIn: customer.marketing_opt_in,
      createdAt: customer.created_at,
      updatedAt: customer.updated_at,
    },
    permissions: {
      canWrite,
      showPayments,
      showProposals,
      showContracts,
      showComms,
      showTasks,
      canPlanner,
    },
    finance: showPayments
      ? { hasLedger, balanceCents, paidCents, dueCents }
      : null,
    events: eventRows,
    activeBookings,
    pastEvents,
    leads: leads.results.map((lead) => ({
      id: lead.id,
      name: lead.name,
      stage: lead.stage,
      source: lead.source,
      eventType: lead.event_type,
      eventDate: lead.event_date,
      convertedEventId: lead.converted_event_id,
      createdAt: lead.created_at,
      href: `/admin/leads/${lead.id}`,
    })),
    /** Admin-only internal notes from linked leads. Never send to portal. */
    internalNotes,
    followUps,
    quotes: proposals.results.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventName: row.event_name,
      title: row.title || "Proposal",
      status: row.status,
      kind: row.latest_kind,
      sentAt: row.latest_sent_at,
      acceptedAt: row.latest_accepted_at,
      href: plannerHref(row.planner_id, row.event_id, "payments"),
    })),
    contracts: contracts.results.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventName: row.event_name,
      title: row.title,
      status: row.status,
      signedAt: row.signed_at,
      href: plannerHref(row.planner_id, row.event_id, "payments"),
    })),
    payments: payments.results.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventName: row.event_name,
      label: row.label || (row.kind === "deposit" ? "Deposit" : "Payment"),
      amountCents: Number(row.amount_cents),
      dueOn: row.due_on,
      status: row.status,
      kind: row.kind,
      paidAt: row.paid_at,
      href: plannerHref(row.planner_id, row.event_id, "payments"),
    })),
    plannerAccess,
    communications,
    duplicates,
    nextActions: nextActions.slice(0, 10),
    quickLinks,
  };
}
