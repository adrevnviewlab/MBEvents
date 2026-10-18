"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtDate } from "@/components/planner/ui";

type BookingStatus = "tentative" | "confirmed" | "canceled" | "completed";

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
  bookingStatus: BookingStatus;
  holdUntil: string | null;
  holdExpired: boolean;
  conflict: boolean;
};

type WorkflowStep = { key: string; label: string; done: boolean; current: boolean; detail: string };
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
  assignments: { id: string; staffId: string; name: string; roleLabel: string; status: string }[];
  reservations: { id: string; equipmentId: string; name: string; quantity: number }[];
  workflow: SalesWorkflow;
};

type DateAvailability = {
  date: string;
  status: "open" | "reserved" | "unavailable";
  reserved: boolean;
  message: string;
  timezone: string;
};

type View = "month" | "week" | "day" | "agenda";
type Filters = { q: string; status: string; eventType: string; staff: string; venue: string };

type PendingMove = {
  event: CalendarEvent;
  toDate: string;
};

const EMPTY_FILTERS: Filters = { q: "", status: "", eventType: "", staff: "", venue: "" };

function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function rangeFor(view: View, cursor: string) {
  if (view === "day" || view === "agenda") {
    return { from: cursor, to: addDays(cursor, view === "agenda" ? 60 : 1), label: view === "agenda" ? "Agenda" : fmtDate(cursor) };
  }
  if (view === "week") {
    const start = addDays(cursor, -new Date(`${cursor}T12:00:00Z`).getUTCDay());
    return { from: start, to: addDays(start, 7), label: `${fmtDate(start)} – ${fmtDate(addDays(start, 6))}` };
  }
  const [year, month] = cursor.slice(0, 7).split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const start = addDays(first, -new Date(`${first}T12:00:00Z`).getUTCDay());
  return {
    from: start,
    to: addDays(start, 42),
    label: new Date(`${first}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

function place(event: CalendarEvent) {
  return [event.venueName, event.location].filter(Boolean).join(" · ");
}

function isActiveHold(event: CalendarEvent) {
  return event.bookingStatus === "tentative" && !!event.holdUntil && !event.holdExpired;
}

function reservesDate(event: CalendarEvent) {
  return event.bookingStatus === "confirmed" || isActiveHold(event);
}

function statusKey(event: CalendarEvent) {
  if (event.bookingStatus === "tentative" && event.holdExpired) return "expired_hold";
  if (isActiveHold(event)) return "active_hold";
  return event.bookingStatus;
}

function statusLabel(event: CalendarEvent) {
  const key = statusKey(event);
  if (key === "active_hold") return "Active hold";
  if (key === "expired_hold") return "Expired hold";
  return event.bookingStatus.replace(/^\w/, (c) => c.toUpperCase());
}

function timeLabel(event: CalendarEvent) {
  if (!event.startTime && !event.endTime) return "Time TBD";
  if (event.startTime && event.endTime) return `${event.startTime}–${event.endTime}`;
  return event.startTime || event.endTime;
}

function matchesFilters(event: CalendarEvent, filters: Filters) {
  if (filters.status === "active_hold" && !isActiveHold(event)) return false;
  if (filters.status === "expired_hold" && !(event.bookingStatus === "tentative" && event.holdExpired)) return false;
  if (filters.status && filters.status !== "active_hold" && filters.status !== "expired_hold" && event.bookingStatus !== filters.status) return false;
  if (filters.eventType && event.eventType !== filters.eventType) return false;
  if (filters.staff && event.coordinatorName !== filters.staff) return false;
  if (filters.venue && event.venueName !== filters.venue) return false;
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [event.name, event.customerName, event.eventType, event.venueName, event.location, event.coordinatorName].join(" ").toLowerCase();
  return hay.includes(q);
}

function StatusPill({ event }: { event: CalendarEvent }) {
  return (
    <span className={`of-cal-pill of-cal-pill-${statusKey(event)}`}>
      {statusLabel(event)}
      {event.conflict ? " · Conflict" : ""}
    </span>
  );
}

function EventChip({
  event,
  onOpen,
  draggable,
}: {
  event: CalendarEvent;
  onOpen: (event: CalendarEvent) => void;
  draggable: boolean;
}) {
  return (
    <button
      type="button"
      className={`of-cal-chip of-cal-chip-${statusKey(event)}${event.conflict ? " is-conflict" : ""}`}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData("text/event-id", event.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(event);
      }}
      title={`${event.name || event.customerName} · ${statusLabel(event)}`}
    >
      <span className="of-cal-chip-time">{event.startTime || "—"}</span>
      <span className="of-cal-chip-name">{event.name || event.customerName || "Event"}</span>
    </button>
  );
}

export function AdminCalendar() {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(todayIso);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [upcoming, setUpcoming] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [availability, setAvailability] = useState<DateAvailability | null>(null);
  const [canWriteBookings, setCanWriteBookings] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveError, setMoveError] = useState("");
  const [holdDraft, setHoldDraft] = useState("");
  const [rescheduleDraft, setRescheduleDraft] = useState({ date: "", start: "", end: "", timezone: "America/New_York" });

  const span = rangeFor(view, cursor);
  const monthCursor = cursor.slice(0, 7) + "-01";

  const load = useCallback(() => {
    const next = rangeFor(view, cursor);
    setLoading(true);
    setError("");
    Promise.all([
      api<{ events: CalendarEvent[] }>(`/api/admin/calendar?from=${next.from}&to=${next.to}`),
      api<{ events: CalendarEvent[] }>("/api/admin/calendar?upcoming=1"),
    ])
      .then(([range, soon]) => {
        setEvents(range.events);
        setUpcoming(soon.events);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [view, cursor]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api<{ permissions: Record<string, boolean> }>("/api/admin/session")
      .then((body) => setCanWriteBookings(body.permissions["bookings.write"] === true))
      .catch(() => setCanWriteBookings(false));
  }, []);

  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("event");
    if (!focus) return;
    setSelectedId(focus);
  }, []);

  useEffect(() => {
    if (!selectedId || !events?.length) return;
    const match = events.find((event) => event.id === selectedId) || upcoming?.find((event) => event.id === selectedId);
    if (match?.eventDate) {
      setCursor(match.eventDate);
      setSelectedDay(match.eventDate);
    }
  }, [selectedId, events, upcoming]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError("");
      return;
    }
    let alive = true;
    setDetailBusy(true);
    api<BookingDetail>(`/api/admin/calendar/${selectedId}`)
      .then((row) => {
        if (!alive) return;
        setDetail(row);
        setDetailError("");
        setHoldDraft(row.holdUntil ? row.holdUntil.slice(0, 16) : "");
        setRescheduleDraft({
          date: row.eventDate || "",
          start: row.startTime || "",
          end: row.endTime || "",
          timezone: row.timezone || "America/New_York",
        });
      })
      .catch((reason: Error) => {
        if (!alive) return;
        setDetail(null);
        setDetailError(reason.message);
      })
      .finally(() => { if (alive) setDetailBusy(false); });
    return () => { alive = false; };
  }, [selectedId]);

  const dayForAvailability = selectedDay || (view === "day" ? cursor : null);
  useEffect(() => {
    if (!dayForAvailability) {
      setAvailability(null);
      return;
    }
    let alive = true;
    api<DateAvailability>(`/api/availability?date=${encodeURIComponent(dayForAvailability)}`)
      .then((body) => { if (alive) setAvailability(body); })
      .catch(() => { if (alive) setAvailability(null); });
    return () => { alive = false; };
  }, [dayForAvailability]);

  const filtered = useMemo(
    () => (events ?? []).filter((event) => matchesFilters(event, filters)),
    [events, filters],
  );

  const agendaItems = useMemo(() => {
    const source = view === "agenda" ? (upcoming ?? filtered) : filtered;
    return [...source]
      .filter((event) => matchesFilters(event, filters))
      .filter((event) => event.bookingStatus === "tentative" || event.bookingStatus === "confirmed" || view !== "agenda")
      .sort((a, b) => `${a.eventDate || ""} ${a.startTime}`.localeCompare(`${b.eventDate || ""} ${b.startTime}`));
  }, [view, upcoming, filtered, filters]);

  const filterOptions = useMemo(() => {
    const source = events ?? [];
    return {
      types: [...new Set(source.map((e) => e.eventType).filter(Boolean))].sort(),
      staff: [...new Set(source.map((e) => e.coordinatorName).filter(Boolean))].sort(),
      venues: [...new Set(source.map((e) => e.venueName).filter(Boolean))].sort(),
    };
  }, [events]);

  const onDay = (day: string) => filtered.filter((event) => event.eventDate === day);

  const stepCursor = (dir: -1 | 1) => {
    if (view === "month") setCursor(addMonths(monthCursor, dir));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else setCursor(addDays(cursor, dir));
  };

  const openEvent = (event: CalendarEvent) => {
    setSelectedId(event.id);
    if (event.eventDate) setSelectedDay(event.eventDate);
  };

  const patchBooking = async (body: object) => {
    if (!selectedId) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const row = await api<{ booking: BookingDetail }>(`/api/admin/calendar/${selectedId}`, { method: "PATCH", body });
      setDetail(row.booking);
      setHoldDraft(row.booking.holdUntil ? row.booking.holdUntil.slice(0, 16) : "");
      load();
    } catch (reason) {
      setDetailError((reason as Error).message);
    } finally {
      setDetailBusy(false);
    }
  };

  const confirmMove = async () => {
    if (!pendingMove) return;
    setMoveError("");
    const { event, toDate } = pendingMove;
    try {
      await api(`/api/admin/calendar/${event.id}`, {
        method: "PATCH",
        body: {
          action: "reschedule",
          eventDate: toDate,
          startTime: event.startTime || "00:00",
          endTime: event.endTime || "23:59",
          timezone: event.timezone || "America/New_York",
        },
      });
      setPendingMove(null);
      setCursor(toDate);
      setSelectedDay(toDate);
      setSelectedId(event.id);
      load();
    } catch (reason) {
      setMoveError((reason as Error).message);
    }
  };

  const days = view === "month"
    ? Array.from({ length: 42 }, (_, i) => addDays(span.from, i))
    : view === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(span.from, i))
      : [cursor];

  const mobileAgenda = view === "month" || view === "week";

  return (
    <div className="of-cal-app">
      <header className="of-cal-header">
        <div className="of-cal-header-top">
          <div>
            <h1>Calendar</h1>
            <p>Bookings and active holds reserve a business date. Inquiries never block availability.</p>
          </div>
          <div className="of-cal-actions">
            <a className="pl-btn sm ghost" href="/admin/leads">New inquiry</a>
            <a className="pl-btn sm" href="/admin/planner">Events</a>
          </div>
        </div>

        <div className="of-cal-toolbar">
          <div className="of-cal-nav">
            <button type="button" className="pl-btn sm ghost" onClick={() => stepCursor(-1)} aria-label="Previous">Prev</button>
            <button type="button" className="pl-btn sm ghost" onClick={() => setCursor(todayIso())}>Today</button>
            <button type="button" className="pl-btn sm ghost" onClick={() => stepCursor(1)} aria-label="Next">Next</button>
            <strong className="of-cal-range">{span.label}</strong>
          </div>
          <div className="of-cal-views" role="tablist" aria-label="Calendar view">
            {(["month", "week", "day", "agenda"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={view === item}
                className={view === item ? "pl-btn sm" : "pl-btn sm ghost"}
                onClick={() => setView(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="of-cal-filters">
          <input
            className="of-search"
            type="search"
            placeholder="Search events, clients, venues…"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          />
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="Booking status">
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="tentative">Tentative</option>
            <option value="active_hold">Active hold</option>
            <option value="expired_hold">Expired hold</option>
            <option value="canceled">Canceled</option>
            <option value="completed">Completed</option>
          </select>
          <select value={filters.eventType} onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))} aria-label="Event type">
            <option value="">All types</option>
            {filterOptions.types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select value={filters.staff} onChange={(e) => setFilters((f) => ({ ...f, staff: e.target.value }))} aria-label="Coordinator">
            <option value="">All coordinators</option>
            {filterOptions.staff.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={filters.venue} onChange={(e) => setFilters((f) => ({ ...f, venue: e.target.value }))} aria-label="Venue">
            <option value="">All venues</option>
            {filterOptions.venues.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button type="button" className="pl-btn sm ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Reset</button>
        </div>

        <div className="of-cal-legend" aria-label="Status legend">
          <span><i className="of-cal-swatch of-cal-pill-confirmed" /> Confirmed</span>
          <span><i className="of-cal-swatch of-cal-pill-active_hold" /> Active hold</span>
          <span><i className="of-cal-swatch of-cal-pill-tentative" /> Tentative</span>
          <span><i className="of-cal-swatch of-cal-pill-expired_hold" /> Expired hold</span>
          <span><i className="of-cal-swatch of-cal-pill-canceled" /> Canceled</span>
          <span><i className="of-cal-swatch of-cal-pill-completed" /> Completed</span>
        </div>
      </header>

      {error ? <p className="of-state of-state-error" role="alert">{error}</p> : null}
      {loading && !events ? <p className="of-state" role="status">Loading calendar…</p> : null}

      <div className={`of-cal-layout${selectedId || selectedDay ? " has-panel" : ""}`}>
        <div className="of-cal-main">
          {view === "agenda" ? (
            <section className="of-panel of-cal-agenda">
              <div className="of-panel-head">
                <h2>Upcoming agenda</h2>
              </div>
              {agendaItems.length ? agendaItems.map((event) => (
                <button type="button" className="of-cal-agenda-row" key={event.id} onClick={() => openEvent(event)}>
                  <div>
                    <strong>{event.name || event.customerName || "Event"}</strong>
                    <small>
                      {[fmtDate(event.eventDate || ""), timeLabel(event), event.customerName, event.eventType, place(event), event.coordinatorName]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  <StatusPill event={event} />
                </button>
              )) : <p className="pl-empty">No matching upcoming events.</p>}
            </section>
          ) : view === "day" ? (
            <section className="of-panel of-cal-day">
              <div className="of-panel-head">
                <h2>{fmtDate(cursor)}</h2>
                {availability ? (
                  <span className={`of-status ${availability.reserved ? "of-status-warn" : availability.status === "open" ? "of-status-ok" : "of-status-info"}`}>
                    {availability.reserved ? "Date reserved" : availability.status === "open" ? "Date open" : "Unavailable"}
                  </span>
                ) : null}
              </div>
              {availability ? <p className="of-cal-avail-msg">{availability.message}</p> : null}
              {onDay(cursor).length ? onDay(cursor).map((event) => (
                <button type="button" className="of-cal-agenda-row" key={event.id} onClick={() => openEvent(event)}>
                  <div>
                    <strong>{timeLabel(event)} · {event.name || event.customerName || "Event"}</strong>
                    <small>{[event.customerName, event.eventType, place(event), event.coordinatorName].filter(Boolean).join(" · ")}</small>
                  </div>
                  <StatusPill event={event} />
                </button>
              )) : <p className="pl-empty">No bookings on this date.</p>}
            </section>
          ) : (
            <>
              <div className="of-cal-grid-wrap of-cal-desktop">
                <table className="of-cal-grid">
                  <thead>
                    <tr>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <th key={label}>{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.ceil(days.length / 7) }, (_, week) => (
                      <tr key={week}>
                        {days.slice(week * 7, week * 7 + 7).map((day) => {
                          const items = onDay(day);
                          const reservedOnGrid = items.some(reservesDate);
                          const inMonth = view !== "month" || day.slice(0, 7) === cursor.slice(0, 7);
                          return (
                            <td
                              key={day}
                              className={[
                                "of-cal-cell",
                                day === todayIso() ? "is-today" : "",
                                day === selectedDay ? "is-selected" : "",
                                !inMonth ? "is-outside" : "",
                                reservedOnGrid ? "has-reservation" : "",
                              ].filter(Boolean).join(" ")}
                              onDragOver={(e) => { if (canWriteBookings) e.preventDefault(); }}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (!canWriteBookings) return;
                                const id = e.dataTransfer.getData("text/event-id");
                                const event = (events ?? []).find((row) => row.id === id);
                                if (!event || event.eventDate === day) return;
                                setPendingMove({ event, toDate: day });
                                setMoveError("");
                              }}
                            >
                              <button
                                type="button"
                                className="of-cal-daynum"
                                onClick={() => {
                                  setSelectedDay(day);
                                  setCursor(day);
                                  if (view === "week") setView("day");
                                }}
                              >
                                {Number(day.slice(8))}
                                {reservedOnGrid ? <span className="of-cal-reserved-dot" title="Active hold or confirmed booking on this date" /> : null}
                              </button>
                              <div className="of-cal-chips">
                                {items.slice(0, view === "week" ? 8 : 3).map((event) => (
                                  <EventChip key={event.id} event={event} onOpen={openEvent} draggable={canWriteBookings} />
                                ))}
                                {items.length > (view === "week" ? 8 : 3) ? (
                                  <button type="button" className="of-cal-more" onClick={() => { setSelectedDay(day); setCursor(day); setView("day"); }}>
                                    +{items.length - (view === "week" ? 8 : 3)} more
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mobileAgenda ? (
                <section className="of-panel of-cal-mobile-agenda">
                  <div className="of-panel-head">
                    <h2>{selectedDay ? fmtDate(selectedDay) : "This period"}</h2>
                  </div>
                  {(selectedDay ? onDay(selectedDay) : filtered).length ? (selectedDay ? onDay(selectedDay) : filtered).map((event) => (
                    <button type="button" className="of-cal-agenda-row" key={event.id} onClick={() => openEvent(event)}>
                      <div>
                        <strong>{fmtDate(event.eventDate || "")} · {timeLabel(event)}</strong>
                        <small>{[event.name || event.customerName, event.eventType, place(event)].filter(Boolean).join(" · ")}</small>
                      </div>
                      <StatusPill event={event} />
                    </button>
                  )) : <p className="pl-empty">No events in this view.</p>}
                </section>
              ) : null}
            </>
          )}
        </div>

        {(selectedDay || selectedId) ? (
          <aside className="of-cal-panel" aria-label="Day and event details">
            {selectedDay ? (
              <section className="of-panel">
                <div className="of-panel-head">
                  <h2>{fmtDate(selectedDay)}</h2>
                  <button type="button" className="pl-link" onClick={() => { setSelectedDay(null); if (!selectedId) setAvailability(null); }}>Close</button>
                </div>
                {availability ? (
                  <>
                    <p className={`of-status ${availability.reserved ? "of-status-warn" : availability.status === "open" ? "of-status-ok" : "of-status-info"}`}>
                      Server: {availability.reserved ? "Reserved" : availability.status}
                    </p>
                    <p className="of-cal-avail-msg">{availability.message}</p>
                  </>
                ) : <p className="pl-empty">Checking availability…</p>}
                <div className="of-cal-day-list">
                  {onDay(selectedDay).length ? onDay(selectedDay).map((event) => (
                    <button type="button" key={event.id} className={`of-cal-day-item${selectedId === event.id ? " is-on" : ""}`} onClick={() => openEvent(event)}>
                      <strong>{event.name || event.customerName || "Event"}</strong>
                      <small>{timeLabel(event)} · {statusLabel(event)}</small>
                    </button>
                  )) : <p className="pl-empty">No bookings listed for this date.</p>}
                </div>
              </section>
            ) : null}

            {selectedId ? (
              <section className="of-panel">
                <div className="of-panel-head">
                  <h2>Event</h2>
                  <button type="button" className="pl-link" onClick={() => setSelectedId(null)}>Close</button>
                </div>
                {detailBusy && !detail ? <p className="pl-empty">Loading event…</p> : null}
                {detailError ? <p className="of-state of-state-error" role="alert">{detailError}</p> : null}
                {detail ? (
                  <>
                    <h3 className="of-cal-detail-title">{detail.name || detail.customerName || "Event"}</h3>
                    <StatusPill event={detail} />
                    <dl className="of-cal-dl">
                      <div><dt>Client</dt><dd>{detail.customerName || "—"}</dd></div>
                      <div><dt>When</dt><dd>{[fmtDate(detail.eventDate || ""), timeLabel(detail), detail.timezone].filter(Boolean).join(" · ")}</dd></div>
                      <div><dt>Venue</dt><dd>{place(detail) || "—"}</dd></div>
                      <div><dt>Type</dt><dd>{detail.eventType || "—"}</dd></div>
                      <div><dt>Hold</dt><dd>{detail.holdUntil ? `${detail.holdExpired ? "Expired" : "Until"} ${detail.holdUntil.slice(0, 16).replace("T", " ")}` : "None"}</dd></div>
                      <div><dt>Quote</dt><dd>{detail.workflow?.proposalStatus || "—"}</dd></div>
                      <div><dt>Deposit</dt><dd>{detail.workflow?.depositStatus || "—"}</dd></div>
                      <div><dt>Staff</dt><dd>{detail.assignments.length ? detail.assignments.map((a) => a.name).join(", ") : (detail.coordinatorName || "Unassigned")}</dd></div>
                      <div><dt>Equipment</dt><dd>{detail.reservations.length ? detail.reservations.map((r) => `${r.name} ×${r.quantity}`).join(", ") : "None"}</dd></div>
                    </dl>
                    {detail.workflow ? <p className="of-cal-next"><strong>Next:</strong> {detail.workflow.nextAction}</p> : null}

                    <div className="of-cal-detail-actions">
                      {detail.plannerId ? <a className="pl-btn sm" href={`/admin/planner/${detail.plannerId}`}>Open Control Room</a> : null}
                      {detail.plannerId ? <a className="pl-btn sm ghost" href={`/admin/planner/${detail.plannerId}?room=payments`}>View quote</a> : null}
                      {detail.plannerId ? <a className="pl-btn sm ghost" href={`/admin/planner/${detail.plannerId}?room=payments`}>View payments</a> : null}
                      <a className="pl-btn sm ghost" href="/admin/clients">Clients</a>
                    </div>

                    {canWriteBookings ? (
                      <div className="of-cal-edit">
                        <h4>Hold</h4>
                        <div className="of-cal-edit-row">
                          <input type="datetime-local" value={holdDraft} onChange={(e) => setHoldDraft(e.target.value)} />
                          <button type="button" className="pl-btn sm" disabled={detailBusy} onClick={() => patchBooking({ action: "hold", holdUntil: holdDraft || null })}>Save hold</button>
                          <button type="button" className="pl-btn sm ghost" disabled={detailBusy} onClick={() => { setHoldDraft(""); void patchBooking({ action: "hold", holdUntil: null }); }}>Clear</button>
                        </div>
                        <h4>Reschedule</h4>
                        <div className="of-cal-edit-grid">
                          <label>Date<input type="date" value={rescheduleDraft.date} onChange={(e) => setRescheduleDraft((d) => ({ ...d, date: e.target.value }))} /></label>
                          <label>Start<input value={rescheduleDraft.start} onChange={(e) => setRescheduleDraft((d) => ({ ...d, start: e.target.value }))} /></label>
                          <label>End<input value={rescheduleDraft.end} onChange={(e) => setRescheduleDraft((d) => ({ ...d, end: e.target.value }))} /></label>
                          <label>Timezone<input value={rescheduleDraft.timezone} onChange={(e) => setRescheduleDraft((d) => ({ ...d, timezone: e.target.value }))} /></label>
                        </div>
                        <button
                          type="button"
                          className="pl-btn sm"
                          disabled={detailBusy || !rescheduleDraft.date}
                          onClick={() => patchBooking({
                            action: "reschedule",
                            eventDate: rescheduleDraft.date,
                            startTime: rescheduleDraft.start,
                            endTime: rescheduleDraft.end,
                            timezone: rescheduleDraft.timezone,
                          })}
                        >
                          Save schedule
                        </button>
                        <div className="of-cal-edit-row" style={{ marginTop: 10 }}>
                          <button type="button" className="pl-btn sm" disabled={detailBusy} onClick={() => patchBooking({ action: "confirm" })}>Owner confirm</button>
                          <button type="button" className="pl-btn sm ghost" disabled={detailBusy} onClick={() => patchBooking({ action: "complete" })}>Complete</button>
                          <button
                            type="button"
                            className="pl-btn sm danger"
                            disabled={detailBusy}
                            onClick={() => { if (window.confirm("Cancel this booking? The event stays on file.")) void patchBooking({ action: "cancel" }); }}
                          >
                            Cancel booking
                          </button>
                        </div>
                        <p className="of-cal-fine">Confirm is owner-only on the server. Deposit payment never confirms.</p>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>

      {pendingMove ? (
        <div className="of-cal-modal" role="dialog" aria-modal="true" aria-labelledby="of-cal-move-title">
          <div className="of-cal-modal-card">
            <h2 id="of-cal-move-title">Confirm reschedule</h2>
            <p>
              Move <strong>{pendingMove.event.name || pendingMove.event.customerName}</strong> from{" "}
              <strong>{fmtDate(pendingMove.event.eventDate || "")}</strong> to <strong>{fmtDate(pendingMove.toDate)}</strong>?
            </p>
            <p className="of-cal-fine">
              Times stay {timeLabel(pendingMove.event)}. The server rechecks date availability and conflicts before saving.
            </p>
            {moveError ? <p className="of-state of-state-error" role="alert">{moveError}</p> : null}
            <div className="of-cal-edit-row">
              <button type="button" className="pl-btn sm" onClick={() => void confirmMove()}>Confirm move</button>
              <button type="button" className="pl-btn sm ghost" onClick={() => { setPendingMove(null); setMoveError(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
