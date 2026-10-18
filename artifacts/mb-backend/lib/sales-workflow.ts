import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { eventLedger } from "@/lib/finance";

export type WorkflowStepKey =
  | "inquiry"
  | "lead"
  | "event"
  | "availability"
  | "hold"
  | "quote"
  | "acceptance"
  | "deposit"
  | "owner_approval"
  | "confirmed";

export type WorkflowStep = {
  key: WorkflowStepKey;
  label: string;
  done: boolean;
  current: boolean;
  detail: string;
};

export type SalesWorkflow = {
  eventId: string;
  customerId: string | null;
  leadId: string | null;
  leadStage: string | null;
  bookingStatus: string;
  holdUntil: string | null;
  holdExpired: boolean;
  proposalStatus: string | null;
  depositStatus: "none" | "due" | "paid" | "blocked";
  depositLabel: string | null;
  depositAmountCents: number | null;
  depositDueOn: string | null;
  depositConfigError: string | null;
  nextAction: string;
  steps: WorkflowStep[];
};

const DEPOSIT_CONFIG_ERROR =
  "Add an active deposit pricing rule in Catalog (fixed amount or percent), then resend the quote. Amounts are never invented.";

function database() {
  if (!env.DB) throw new AppError("The database is not configured.", 503);
  return env.DB;
}

function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

export async function getSalesWorkflow(eventId: string): Promise<SalesWorkflow> {
  const row = await database().prepare(
    `SELECT e.id, e.customer_id, e.lead_id, e.event_date::text AS event_date,
            b.status AS booking_status, b.hold_until::text AS hold_until,
            (b.status = 'tentative' AND b.hold_until IS NOT NULL AND b.hold_until <= now()) AS hold_expired,
            l.stage AS lead_stage
     FROM events e
     JOIN bookings b ON b.event_id = e.id
     LEFT JOIN leads l ON l.id = e.lead_id
     WHERE e.id = ?`,
  ).bind(eventId).first<{
    id: string;
    customer_id: string | null;
    lead_id: string | null;
    event_date: string | null;
    booking_status: string;
    hold_until: string | null;
    hold_expired: boolean;
    lead_stage: string | null;
  }>();
  if (!row) throw new AppError("Event not found.", 404);

  const ledger = await eventLedger(eventId);
  const quoteVersion = await database().prepare(
    `SELECT v.id, v.snapshot, v.accepted_at
     FROM proposal_versions v
     JOIN proposals p ON p.id = v.proposal_id
     WHERE p.event_id = ? AND v.kind = 'quote' AND v.sent_at IS NOT NULL
     ORDER BY v.number DESC LIMIT 1`,
  ).bind(eventId).first<{ id: string; snapshot: unknown; accepted_at: string | null }>();

  const snapshot = quoteVersion ? asJson<{ deposit?: { label: string; amountCents: number } | null }>(quoteVersion.snapshot) : null;
  const snapshotDeposit = snapshot?.deposit && snapshot.deposit.amountCents > 0 ? snapshot.deposit : null;

  const scheduleDeposit = ledger.deposit
    ?? ledger.payments.find((payment) => payment.kind === "deposit" && payment.status !== "void")
    ?? null;

  let depositStatus: SalesWorkflow["depositStatus"] = "none";
  let depositConfigError: string | null = null;
  if (scheduleDeposit?.status === "paid") depositStatus = "paid";
  else if (scheduleDeposit?.status === "due") depositStatus = "due";
  else if (ledger.proposal?.status === "sent" && !snapshotDeposit) {
    depositStatus = "blocked";
    depositConfigError = DEPOSIT_CONFIG_ERROR;
  } else if (ledger.proposal?.status === "accepted" && !scheduleDeposit) {
    depositStatus = "blocked";
    depositConfigError = DEPOSIT_CONFIG_ERROR;
  }

  const bookingStatus = row.booking_status;
  const hasDate = !!row.event_date;
  const holdActive = !!row.hold_until && !row.hold_expired;
  const dateReserved = bookingStatus === "confirmed" || bookingStatus === "completed" || holdActive;
  const quoteSent = !!ledger.proposal && (ledger.proposal.status === "sent" || ledger.proposal.status === "accepted");
  const quoteAccepted = ledger.proposal?.status === "accepted";
  const depositReady = depositStatus === "due" || depositStatus === "paid";
  const confirmed = bookingStatus === "confirmed" || bookingStatus === "completed";
  const canceled = bookingStatus === "canceled";

  const steps: WorkflowStep[] = [
    {
      key: "inquiry",
      label: "Inquiry",
      done: !!row.lead_id,
      current: false,
      detail: row.lead_id ? "Lead captured from inquiry." : "No linked inquiry lead.",
    },
    {
      key: "lead",
      label: "Lead",
      done: !!row.lead_id,
      current: false,
      detail: row.lead_stage ? `CRM stage: ${row.lead_stage} (independent of booking status).` : "No CRM lead linked.",
    },
    {
      key: "event",
      label: "Event",
      done: true,
      current: false,
      detail: `Event ${row.id} · customer ${row.customer_id ?? "none"}.`,
    },
    {
      key: "availability",
      label: "Availability review",
      done: hasDate,
      current: false,
      detail: hasDate ? `Event date ${row.event_date}.` : "Set the event date to review availability.",
    },
    {
      key: "hold",
      label: "Hold",
      done: dateReserved,
      current: false,
      detail: confirmed
        ? "Date reserved by confirmed booking."
        : holdActive
          ? `Active hold until ${row.hold_until}.`
          : row.hold_expired
            ? "Hold expired — date is open unless another booking reserves it."
            : "Set a hold with an explicit expiration to reserve the date.",
    },
    {
      key: "quote",
      label: "Quote",
      done: quoteSent,
      current: false,
      detail: quoteSent ? `Proposal ${ledger.proposal?.status}.` : "Send a published package quote.",
    },
    {
      key: "acceptance",
      label: "Quote acceptance",
      done: quoteAccepted,
      current: false,
      detail: quoteAccepted
        ? "Client accepted the quote."
        : depositConfigError
          ? depositConfigError
          : "Waiting for the client to accept the quote.",
    },
    {
      key: "deposit",
      label: "Deposit due",
      done: depositReady,
      current: false,
      detail: depositStatus === "paid"
        ? "Deposit marked paid on the ledger. Payment does not confirm the booking."
        : depositStatus === "due"
          ? `Deposit obligation due${scheduleDeposit?.dueOn ? ` on ${scheduleDeposit.dueOn}` : ""}.`
          : depositConfigError || "Acceptance creates one deposit obligation when a deposit rule exists.",
    },
    {
      key: "owner_approval",
      label: "Owner approval",
      done: confirmed,
      current: false,
      detail: confirmed
        ? "Owner confirmed the booking."
        : "Only the owner may confirm. Deposit payment never confirms.",
    },
    {
      key: "confirmed",
      label: "Confirmed booking",
      done: confirmed,
      current: false,
      detail: confirmed
        ? `Booking status: ${bookingStatus}.`
        : canceled
          ? "Booking canceled — date released."
          : `Booking status: ${bookingStatus} (not confirmed).`,
    },
  ];

  const firstOpen = steps.find((step) => !step.done);
  if (firstOpen) firstOpen.current = true;
  else if (steps.length) steps[steps.length - 1]!.current = true;

  let nextAction = "No further sales action — booking is confirmed.";
  if (canceled) nextAction = "Booking canceled. History is preserved; create a new hold to reserve another date.";
  else if (!hasDate) nextAction = "Set the event date and review availability.";
  else if (!dateReserved) nextAction = "Place a hold with an explicit expiration to reserve the calendar date.";
  else if (!quoteSent) nextAction = "Send a quote from a published package.";
  else if (depositConfigError) nextAction = depositConfigError;
  else if (!quoteAccepted) nextAction = "Wait for the client to accept the quote (creates the deposit obligation).";
  else if (depositStatus === "due") nextAction = "Collect the deposit. Payment does not confirm the booking.";
  else if (!confirmed) nextAction = "Owner must confirm with an active hold. Ordinary staff cannot confirm.";
  else if (bookingStatus === "confirmed") nextAction = "Staff may be assigned after confirmation. Mark complete only after the event.";

  return {
    eventId: row.id,
    customerId: row.customer_id,
    leadId: row.lead_id,
    leadStage: row.lead_stage,
    bookingStatus,
    holdUntil: row.hold_until,
    holdExpired: !!row.hold_expired,
    proposalStatus: ledger.proposal?.status ?? null,
    depositStatus,
    depositLabel: scheduleDeposit?.label ?? snapshotDeposit?.label ?? null,
    depositAmountCents: scheduleDeposit?.amountCents ?? snapshotDeposit?.amountCents ?? null,
    depositDueOn: scheduleDeposit?.dueOn ?? null,
    depositConfigError,
    nextAction,
    steps,
  };
}
