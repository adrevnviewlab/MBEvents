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

type OwnerDesk = {
  counts: {
    newLeads: number;
    upcoming: number;
    activeHolds: number;
    unsignedContracts: number;
    depositsDue: number;
    overdueBalances: number;
    urgentTasks: number;
  };
  newLeads: DeskItem[];
  upcoming: DeskItem[];
  activeHolds: DeskItem[];
  unsignedContracts: DeskItem[];
  depositsDue: DeskItem[];
  overdueBalances: DeskItem[];
  urgentTasks: DeskItem[];
};

/**
 * Desk metrics supported by GET /api/admin/desk today.
 * Not available (do not invent): pending quotes (distinct from unsigned contracts),
 * today's tasks calendar, upcoming meetings, event readiness warnings.
 */

function greetingFor(date: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(date));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

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

export function OfficeOverview() {
  const [desk, setDesk] = useState<OwnerDesk | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hello, setHello] = useState("Welcome");

  useEffect(() => {
    setHello(greetingFor(new Date()));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<OwnerDesk>("/api/admin/desk")
      .then((body) => {
        if (!alive) return;
        setDesk(body);
        setError("");
      })
      .catch((reason: Error) => {
        if (!alive) return;
        setDesk(null);
        setError(reason.message || "Could not load the desk.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const c = desk?.counts;

  return (
    <div className="pl of-desk-page">
      <div className="pl-wrap">
        <header className="of-hello">
          <h1>{hello}</h1>
          <p>
            Command center for leads, holds, contracts, deposits, and what needs action next.
            Open any row to jump into the matching workflow.
          </p>
          <div className="of-quick">
            <a className="pl-btn sm" href="/admin/today">Today</a>
            <a className="pl-btn sm ghost" href="/admin/tasks">Tasks</a>
            <a className="pl-btn sm ghost" href="/admin/leads">New leads</a>
            <a className="pl-btn sm ghost" href="/admin/calendar">Calendar</a>
            <a className="pl-btn sm ghost" href="/admin/planner">Events</a>
            <a className="pl-btn sm ghost" href="/admin/payments">Payments</a>
          </div>
        </header>

        {error ? (
          <p className="of-state of-state-error" role="alert">{error}</p>
        ) : null}

        <div className="of-stats of-stats-grid" aria-label="Desk counts">
          <Stat href="/admin/leads" label="New leads" value={c?.newLeads} hint="Last 7 days" loading={loading} />
          <Stat href="/admin/calendar" label="Upcoming events" value={c?.upcoming} hint="Tentative & confirmed" loading={loading} />
          <Stat href="/admin/calendar" label="Active holds" value={c?.activeHolds} hint="Date reserved" loading={loading} />
          <Stat href="/admin/planner" label="Unsigned contracts" value={c?.unsignedContracts} hint="Open on bookings" loading={loading} />
          <Stat href="/admin/payments" label="Deposits due" value={c?.depositsDue} hint="Awaiting payment" loading={loading} />
          <Stat href="/admin/payments" label="Outstanding" value={c?.overdueBalances} hint="Past due date" loading={loading} />
          <Stat href="/admin/tasks?deadline=overdue" label="Urgent tasks" value={c?.urgentTasks} hint="Follow-ups due" loading={loading} />
        </div>

        {loading ? (
          <p className="of-state" role="status">Loading the desk…</p>
        ) : null}

        {desk ? (
          <div className="of-desk">
            <Queue title="Urgent tasks" href="/admin/tasks?deadline=overdue" items={desk.urgentTasks} empty="No overdue follow-ups." count={desk.counts.urgentTasks} />
            <Queue title="Active holds" href="/admin/calendar" items={desk.activeHolds} empty="No active holds." count={desk.counts.activeHolds} />
            <Queue title="Deposits due" href="/admin/payments" items={desk.depositsDue} empty="No deposits waiting." count={desk.counts.depositsDue} />
            <Queue title="Outstanding payments" href="/admin/payments" items={desk.overdueBalances} empty="Nothing past due." count={desk.counts.overdueBalances} />
            <Queue title="Unsigned contracts" href="/admin/planner" items={desk.unsignedContracts} empty="No open contracts on active bookings." count={desk.counts.unsignedContracts} />
            <Queue title="New leads" href="/admin/leads" items={desk.newLeads} empty="No new inquiries this week." count={desk.counts.newLeads} />
            <Queue title="Upcoming events" href="/admin/calendar" items={desk.upcoming} empty="No upcoming bookings." count={desk.counts.upcoming} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
