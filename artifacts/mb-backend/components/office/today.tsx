"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/planner/ui";

type DeskItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  tone?: "default" | "urgent" | "warn";
};

type TodayBoard = {
  date: string;
  counts: {
    todaysEvents: number;
    overdueFollowUps: number;
    tasksDueToday: number;
    consultations: number;
    activeHolds: number;
    quotesPayments: number;
    readinessWarnings: number;
  };
  todaysEvents: DeskItem[];
  overdueFollowUps: DeskItem[];
  tasksDueToday: DeskItem[];
  consultations: DeskItem[];
  activeHolds: DeskItem[];
  quotesPayments: DeskItem[];
  readinessWarnings: DeskItem[];
};

function Queue({
  title,
  href,
  items,
  empty,
  count,
}: {
  title: string;
  href: string;
  items: DeskItem[];
  empty: string;
  count: number;
}) {
  return (
    <section className="of-panel">
      <div className="of-panel-head">
        <h2>{title} <span className="of-count">{count}</span></h2>
        <a href={href}>Open</a>
      </div>
      {items.length ? items.map((item) => (
        <a
          className={`of-queue-row${item.tone === "urgent" ? " is-urgent" : item.tone === "warn" ? " is-warn" : ""}`}
          href={item.href}
          key={item.id}
        >
          <strong>{item.label}</strong>
          <small>{item.detail}</small>
        </a>
      )) : <p className="pl-empty">{empty}</p>}
    </section>
  );
}

function Stat({
  href,
  label,
  value,
  hint,
  loading,
}: {
  href: string;
  label: string;
  value: number | undefined;
  hint: string;
  loading: boolean;
}) {
  return (
    <a className="of-stat of-surface" href={href}>
      <span>{label}</span>
      <strong aria-busy={loading || undefined}>{loading ? "…" : value}</strong>
      <p>{hint}</p>
    </a>
  );
}

function dateLabel(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function OfficeToday() {
  const [board, setBoard] = useState<TodayBoard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<TodayBoard>("/api/admin/today")
      .then((body) => {
        if (!alive) return;
        setBoard(body);
        setError("");
      })
      .catch((reason: Error) => {
        if (!alive) return;
        setBoard(null);
        setError(reason.message || "Could not load today.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const c = board?.counts;

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="of-hello">
          <h1>Today</h1>
          <p>
            {board ? dateLabel(board.date) : "Daily work for events, follow-ups, holds, and money that needs a decision."}
            {" "}Live from the office database — not scheduled reminder stubs.
          </p>
          <div className="of-quick">
            <a className="pl-btn sm" href="/admin/tasks">Tasks</a>
            <a className="pl-btn sm ghost" href="/admin/calendar">Calendar</a>
            <a className="pl-btn sm ghost" href="/admin/leads">Leads</a>
            <a className="pl-btn sm ghost" href="/admin/payments">Payments</a>
          </div>
        </header>

        {error ? <p className="of-state of-state-error" role="alert">{error}</p> : null}

        <div className="of-stats of-stats-grid of-today-stats" aria-label="Today counts">
          <Stat href="/admin/calendar" label="Today's events" value={c?.todaysEvents} hint="On the calendar" loading={loading} />
          <Stat href="/admin/tasks?deadline=overdue" label="Overdue follow-ups" value={c?.overdueFollowUps} hint="Past due tasks" loading={loading} />
          <Stat href="/admin/tasks?deadline=today" label="Due today" value={c?.tasksDueToday} hint="Open tasks" loading={loading} />
          <Stat href="/admin/leads?stage=consultation_scheduled" label="Consultations" value={c?.consultations} hint="Next 14 days" loading={loading} />
          <Stat href="/admin/calendar" label="Active holds" value={c?.activeHolds} hint="Need attention" loading={loading} />
          <Stat href="/admin/proposals" label="Quotes & payments" value={c?.quotesPayments} hint="Action needed" loading={loading} />
          <Stat href="/admin/planner" label="Readiness" value={c?.readinessWarnings} hint="Not ready yet" loading={loading} />
        </div>

        {loading ? <p className="of-state" role="status">Loading today…</p> : null}

        {board ? (
          <div className="of-desk">
            <Queue title="Today's events" href="/admin/calendar" items={board.todaysEvents} empty="No events on the calendar today." count={board.counts.todaysEvents} />
            <Queue title="Overdue follow-ups" href="/admin/tasks?deadline=overdue" items={board.overdueFollowUps} empty="Nothing overdue." count={board.counts.overdueFollowUps} />
            <Queue title="Tasks due today" href="/admin/tasks?deadline=today" items={board.tasksDueToday} empty="No tasks due today." count={board.counts.tasksDueToday} />
            <Queue title="Upcoming consultations" href="/admin/leads" items={board.consultations} empty="No consultations on the books." count={board.counts.consultations} />
            <Queue title="Booking holds" href="/admin/calendar" items={board.activeHolds} empty="No active holds." count={board.counts.activeHolds} />
            <Queue title="Quotes & payments" href="/admin/proposals" items={board.quotesPayments} empty="Nothing waiting on quotes or payments." count={board.counts.quotesPayments} />
            <Queue title="Event readiness" href="/admin/planner" items={board.readinessWarnings} empty="No readiness warnings." count={board.counts.readinessWarnings} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
