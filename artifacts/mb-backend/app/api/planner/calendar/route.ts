import { env } from "@/lib/env";
import { fail, sessionEvent } from "@/lib/planner-server";

function toIcsTime(date: string, time: string) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]?.toUpperCase() === "PM" && h < 12) h += 12;
  if (m[3]?.toUpperCase() === "AM" && h === 12) h = 0;
  return `${date.replace(/-/g, "")}T${String(h).padStart(2, "0")}${m[2]}00`;
}

const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

// Downloadable .ics for Apple, Google, and Outlook calendars.
export async function GET(request: Request) {
  try {
    const { row, data } = await sessionEvent(request, "client");
    const d = data.details;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.eventDate)) return Response.json({ error: "Add your event date first." }, { status: 400 });
    const start = toIcsTime(d.eventDate, d.startTime);
    const end = toIcsTime(d.eventDate, d.endTime);
    let tz = "America/New_York";
    if (start && row.event_id && env.DB) {
      const meta = await env.DB.prepare("SELECT timezone FROM events WHERE id = ?").bind(row.event_id).first<{ timezone: string }>();
      if (meta?.timezone && /^[A-Za-z0-9_+\-/]{1,64}$/.test(meta.timezone)) tz = meta.timezone;
    }
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MB Events//Planner//EN", "BEGIN:VEVENT",
      `UID:${row.id}@mbevents`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      start ? `DTSTART;TZID=${tz}:${start}` : `DTSTART;VALUE=DATE:${d.eventDate.replace(/-/g, "")}`,
      ...(start && end ? [`DTEND;TZID=${tz}:${end}`] : []),
      `SUMMARY:${esc(`${d.eventType || "Event"} - MB Events`)}`,
      `LOCATION:${esc([d.venueName, d.venueAddress].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${esc(data.timeline.map((t) => `${t.time} ${t.what}`).join("\n"))}`,
      "END:VEVENT", "END:VCALENDAR",
    ];
    return new Response(lines.join("\r\n"), {
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="mb-event.ics"' },
    });
  } catch (error) {
    return fail(error);
  }
}
