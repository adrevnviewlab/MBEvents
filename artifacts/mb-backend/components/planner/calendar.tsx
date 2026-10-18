"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Empty, Field, fmtDate, Section, Text } from "./ui";

type CalendarEvent = {
  id: string;
  plannerId: string | null;
  name: string;
  eventType: string;
  eventDate: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  location: string;
  venueName: string;
  services: string[];
  customerName: string;
  coordinatorName: string;
  bookingStatus: "tentative" | "confirmed" | "canceled" | "completed";
  holdUntil: string | null;
  holdExpired: boolean;
  conflict: boolean;
};

type WorkflowStep = {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
  detail: string;
};

type SalesWorkflow = {
  bookingStatus: string;
  leadStage: string | null;
  proposalStatus: string | null;
  depositStatus: string;
  depositConfigError: string | null;
  nextAction: string;
  steps: WorkflowStep[];
};

type BookingDetail = CalendarEvent & {
  setupMinutes: number | null;
  breakdownMinutes: number | null;
  travelBufferMinutes: number;
  internalNotes: string;
  coordinatorId: string | null;
  assignments: { id: string; staffId: string; name: string; roleLabel: string; status: string }[];
  reservations: { id: string; equipmentId: string; name: string; quantity: number }[];
  staff: { id: string; name: string; jobTitle: string }[];
  equipment: { id: string; name: string; quantity: number }[];
  history: { id: string; action: string; fromStatus: string; toStatus: string; actorEmail: string; note: string; createdAt: string }[];
  workflow: SalesWorkflow;
};

function holdLabel(event: CalendarEvent) {
  if (!event.holdUntil) return null;
  if (event.holdExpired) return "Hold expired";
  const when = event.holdUntil.slice(0, 16).replace("T", " ");
  return `Hold until ${when}`;
}

function Status({ event }: { event: CalendarEvent }) {
  const hold = holdLabel(event);
  return (
    <span className="of-statuses">
      <span className={`of-dot of-dot-${event.conflict ? "conflict" : event.bookingStatus}`} />
      <span className={event.bookingStatus === "confirmed" ? "pl-tag ok" : "pl-tag"}>{event.bookingStatus}</span>
      {hold && <span className={event.holdExpired ? "pl-tag" : "pl-tag ok"}>{hold}</span>}
      {event.bookingStatus === "confirmed" && <span className="pl-tag ok">Date reserved</span>}
      {event.bookingStatus === "tentative" && event.holdUntil && !event.holdExpired && <span className="pl-tag ok">Date reserved</span>}
      {event.conflict && <span className="pl-tag bad">Conflict</span>}
    </span>
  );
}

/** Phase 2 calendar UI lives in `@/components/office/admin-calendar`. Re-export for older imports. */
export { AdminCalendar } from "@/components/office/admin-calendar";

function minutesField(value: number | null) {
  return value === null || value === undefined ? "" : String(value);
}

export function AdminBooking({ eventId, part = "all" }: { eventId: string; part?: "all" | "booking" | "history" }) {
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [staffId, setStaffId] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [services, setServices] = useState("");
  const [hold, setHold] = useState("");

  const load = useCallback(() => {
    api<BookingDetail>(`/api/admin/calendar/${eventId}`).then((row) => {
      setBooking(row);
      setServices(row.services.join(", "));
      setHold(row.holdUntil ? row.holdUntil.slice(0, 16) : "");
      setError("");
    }).catch((reason: Error) => setError(reason.message));
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: object) {
    setMessage("");
    setError("");
    try {
      const row = await api<{ booking: BookingDetail }>(`/api/admin/calendar/${eventId}`, { method: "PATCH", body });
      setBooking(row.booking);
      setServices(row.booking.services.join(", "));
      setMessage("Saved");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  if (error && !booking) return <p className="pl-warn">{error}</p>;
  if (!booking) return <Empty>Loading booking...</Empty>;

  if (part === "history") {
    return (
      <Section eyebrow="History" title="Booking history" intro="Changes recorded on this booking.">
        <div className="pl-card">
          {booking.history.length ? booking.history.map((item) => (
            <div className="pl-row" key={item.id}>
              <div className="t">{item.action}{item.fromStatus || item.toStatus ? ` · ${item.fromStatus} → ${item.toStatus}` : ""}<small>{[fmtDate(item.createdAt), item.actorEmail, item.note].filter(Boolean).join(" · ")}</small></div>
            </div>
          )) : <Empty>No booking changes yet.</Empty>}
        </div>
      </Section>
    );
  }

  const windowBody = {
    action: "reschedule" as const,
    eventDate: booking.eventDate || "",
    startTime: booking.startTime,
    endTime: booking.endTime,
    timezone: booking.timezone || "America/New_York",
    setupMinutes: booking.setupMinutes,
    breakdownMinutes: booking.breakdownMinutes,
    travelBufferMinutes: booking.travelBufferMinutes,
  };

  const workflow = booking.workflow;

  return (
    <Section eyebrow="Booking" title={booking.bookingStatus} intro="Booking status is separate from the CRM lead stage. Only the owner confirms. Paying a deposit never confirms.">
      {error && <p className="pl-warn">{error}</p>}
      {message && <p className="pl-sub">{message}</p>}

      {workflow && (
        <div className="pl-card" data-testid="sales-workflow">
          <div className="pl-row">
            <div className="t">
              <strong>Sales workflow</strong>
              <small>
                Booking: {workflow.bookingStatus}
                {workflow.leadStage ? ` · CRM stage: ${workflow.leadStage}` : " · No CRM lead"}
                {workflow.proposalStatus ? ` · Quote: ${workflow.proposalStatus}` : ""}
                {workflow.depositStatus !== "none" ? ` · Deposit: ${workflow.depositStatus}` : ""}
              </small>
            </div>
          </div>
          <p className="pl-intro"><strong>Next:</strong> {workflow.nextAction}</p>
          {workflow.depositConfigError && <p className="pl-warn">{workflow.depositConfigError}</p>}
          <ol className="pl-list">
            {workflow.steps.map((step) => (
              <li key={step.key} className={step.current ? "is-current" : step.done ? "is-done" : ""}>
                <strong>{step.done ? "✓ " : step.current ? "→ " : ""}{step.label}</strong>
                <small> {step.detail}</small>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="pl-card">
        <div className="pl-row">
          <div className="t">
            <strong>{booking.customerName || booking.name || "Client"}</strong>
            <small>{[fmtDate(booking.eventDate || ""), booking.startTime, booking.endTime, booking.timezone].filter(Boolean).join(" · ")}</small>
          </div>
          <Status event={booking} />
        </div>
        <div className="pl-actions">
          <button type="button" className="pl-btn sm" onClick={() => act({ action: "confirm" })}>Owner confirm</button>
          <button type="button" className="pl-btn sm ghost" onClick={() => act({ action: "complete" })}>Complete</button>
          <button type="button" className="pl-btn sm danger" onClick={() => { if (window.confirm("Cancel this booking? The event stays on file.")) void act({ action: "cancel" }); }}>Cancel booking</button>
        </div>
      </div>

      <h3 className="pl-h3">Time window</h3>
      <form className="pl-form" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const setup = String(data.get("setup") || "");
        const breakdown = String(data.get("breakdown") || "");
        const travel = String(data.get("travel") || "0");
        void act({
          action: "reschedule",
          eventDate: String(data.get("date") || ""),
          startTime: String(data.get("start") || ""),
          endTime: String(data.get("end") || ""),
          timezone: String(data.get("timezone") || "America/New_York"),
          setupMinutes: setup === "" ? null : Number(setup),
          breakdownMinutes: breakdown === "" ? null : Number(breakdown),
          travelBufferMinutes: travel === "" ? 0 : Number(travel),
        });
      }}>
        <Field label="Date"><input name="date" type="date" defaultValue={windowBody.eventDate} key={booking.eventDate || "date"} /></Field>
        <Field label="Start"><input name="start" defaultValue={booking.startTime} key={`s-${booking.startTime}`} /></Field>
        <Field label="End"><input name="end" defaultValue={booking.endTime} key={`e-${booking.endTime}`} /></Field>
        <Field label="Timezone"><input name="timezone" defaultValue={booking.timezone || "America/New_York"} key={booking.timezone} /></Field>
        <Field label="Setup minutes"><input name="setup" inputMode="numeric" defaultValue={minutesField(booking.setupMinutes)} key={`su-${booking.setupMinutes}`} /></Field>
        <Field label="Breakdown minutes"><input name="breakdown" inputMode="numeric" defaultValue={minutesField(booking.breakdownMinutes)} key={`br-${booking.breakdownMinutes}`} /></Field>
        <Field label="Travel buffer minutes"><input name="travel" inputMode="numeric" defaultValue={String(booking.travelBufferMinutes ?? 0)} key={`tr-${booking.travelBufferMinutes}`} /></Field>
        <div className="wide"><button className="pl-btn sm" type="submit">Save window</button></div>
      </form>

      <h3 className="pl-h3">Hold</h3>
      <p className="pl-intro">Pick an exact expiration. There is no default hold length. An active hold or confirmed booking reserves the whole calendar date for MB Events. Clearing or letting a hold expire releases the date.</p>
      {booking.holdUntil && (
        <p className="pl-intro">{booking.holdExpired ? "Hold expired — this date is open again unless another booking reserves it." : `Active hold until ${booking.holdUntil.slice(0, 16).replace("T", " ")} (${booking.timezone}).`}</p>
      )}
      <form className="pl-form" onSubmit={(event) => { event.preventDefault(); void act({ action: "hold", holdUntil: hold || null }); }}>
        <Field label="Hold until (event timezone)" wide>
          <input type="datetime-local" value={hold} onChange={(event) => setHold(event.target.value)} required={false} />
        </Field>
        <div className="wide">
          <button className="pl-btn sm" type="submit">Save hold</button>{" "}
          <button className="pl-btn sm ghost" type="button" onClick={() => { setHold(""); void act({ action: "hold", holdUntil: null }); }}>Clear hold</button>
        </div>
      </form>

      <h3 className="pl-h3">People and equipment</h3>
      <div className="pl-card">
        {booking.assignments.length ? booking.assignments.map((item) => (
          <div className="pl-row" key={item.id}>
            <div className="t">{item.name}{item.roleLabel ? ` · ${item.roleLabel}` : ""}<small>{item.status}</small></div>
            <button type="button" className="pl-btn sm ghost" onClick={() => act({ action: "unassign", assignmentId: item.id })}>Remove</button>
          </div>
        )) : <Empty>No staff assigned.</Empty>}
        <div className="pl-form">
          <Field label="Staff">
            <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
              <option value="">Select</option>
              {booking.staff.map((person) => <option key={person.id} value={person.id}>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}</option>)}
            </select>
          </Field>
          <Field label="Role"><Text value={roleLabel} onChange={setRoleLabel} /></Field>
          <div className="wide"><button type="button" className="pl-btn sm" disabled={!staffId} onClick={() => act({ action: "assign", staffId, roleLabel })}>Assign</button></div>
        </div>
        {booking.reservations.length ? booking.reservations.map((item) => (
          <div className="pl-row" key={item.id}>
            <div className="t">{item.name}<small>Qty {item.quantity}</small></div>
            <button type="button" className="pl-btn sm ghost" onClick={() => act({ action: "release", reservationId: item.id })}>Remove</button>
          </div>
        )) : <Empty>No equipment reserved.</Empty>}
        <div className="pl-form">
          <Field label="Equipment">
            <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)}>
              <option value="">Select</option>
              {booking.equipment.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.quantity} on hand</option>)}
            </select>
          </Field>
          <Field label="Quantity"><Text value={quantity} onChange={setQuantity} /></Field>
          <div className="wide"><button type="button" className="pl-btn sm" disabled={!equipmentId} onClick={() => act({ action: "reserve", equipmentId, quantity: Number(quantity) || 1 })}>Reserve</button></div>
        </div>
      </div>

      <h3 className="pl-h3">Coordinator, services, notes</h3>
      <div className="pl-form">
        <Field label="Coordinator">
          <select value={booking.coordinatorId || ""} onChange={(event) => act({ action: "coordinator", coordinatorId: event.target.value || null })}>
            <option value="">None</option>
            {booking.staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </Field>
        <Field label="Location"><Text value={booking.location} onChange={(location) => setBooking({ ...booking, location })} /></Field>
        <Field label="Requested services" wide><Text value={services} onChange={setServices} placeholder="Comma-separated" /></Field>
        <Field label="Internal notes (staff only)" wide><Text area value={booking.internalNotes} onChange={(internalNotes) => setBooking({ ...booking, internalNotes })} /></Field>
        <div className="wide">
          <button type="button" className="pl-btn sm" onClick={() => act({ action: "location", location: booking.location })}>Save location</button>{" "}
          <button type="button" className="pl-btn sm ghost" onClick={() => act({ action: "services", services: services.split(",").map((item) => item.trim()).filter(Boolean) })}>Save services</button>{" "}
          <button type="button" className="pl-btn sm ghost" onClick={() => act({ action: "notes", internalNotes: booking.internalNotes })}>Save notes</button>
        </div>
      </div>

      {part === "all" && (
        <>
          <h3 className="pl-h3">History</h3>
          <div className="pl-card">
            {booking.history.length ? booking.history.map((item) => (
              <div className="pl-row" key={item.id}>
                <div className="t">{item.action}{item.fromStatus || item.toStatus ? ` · ${item.fromStatus} → ${item.toStatus}` : ""}<small>{[fmtDate(item.createdAt), item.actorEmail, item.note].filter(Boolean).join(" · ")}</small></div>
              </div>
            )) : <Empty>No booking changes yet.</Empty>}
          </div>
        </>
      )}
    </Section>
  );
}
