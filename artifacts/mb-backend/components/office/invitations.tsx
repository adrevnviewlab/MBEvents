"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/planner/ui";

type EventRow = { id: string; clientNames: string; eventType: string; eventDate: string; venueName: string; code: string };

export function OfficeInvitations() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    api<{ events: EventRow[] }>("/api/admin/planner")
      .then((body) => setEvents(body.events))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const filtered = (events ?? []).filter((event) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [event.clientNames, event.eventType, event.venueName, event.code, event.eventDate].join(" ").toLowerCase().includes(needle);
  });

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="of-crm-header">
          <div>
            <p className="of-ecr-kicker">MB Invites</p>
            <h1>Guests & seating</h1>
            <p>Open an event guest room for RSVPs, plus-ones, check-in, and the seating planner. Guest records stay on the event invitation.</p>
          </div>
        </header>
        {error && <p className="of-state of-state-error" role="alert">{error}</p>}
        <div className="of-toolbar">
          <input className="of-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events" aria-label="Search events" />
        </div>
        <div className="of-table-wrap">
          {events === null && !error ? <p className="pl-empty">Loading events…</p> : filtered.length ? (
            <table className="of-table">
              <thead><tr><th>Event</th><th>Date</th><th>Venue</th><th>Code</th><th /></tr></thead>
              <tbody>
                {filtered.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <strong>{event.clientNames || "Unnamed"}</strong>
                      <div><small>{event.eventType}</small></div>
                    </td>
                    <td><small>{event.eventDate || "TBD"}</small></td>
                    <td><small>{event.venueName || "Not recorded"}</small></td>
                    <td className="of-mono"><small>{event.code}</small></td>
                    <td className="of-row-actions">
                      <a className="pl-btn ghost" href={`/admin/planner/${event.id}?room=guests`}>Open guest room</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="pl-empty">No events yet. Guest lists open from an event after one exists.</p>}
        </div>
      </div>
    </div>
  );
}
