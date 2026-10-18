import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { can } from "@/lib/authz";
import { getActor, requireAdminPage } from "@/lib/admin";
import { leadProfile } from "@/lib/crm";
import { leadNextAction, sourceLabel } from "@/lib/crm-ui";
import { money } from "@/lib/planner";
import { LeadEditor } from "@/components/lead-editor";
import "../../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead | MB Admin", robots: { index: false, follow: false } };

export default async function LeadProfile({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  await requireAdminPage("/admin/leads", "leads.read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !env.DB || !actor) notFound();
  const profile = await leadProfile(id);
  if (!profile) notFound();
  const lead = profile.lead;
  const stageLabel = profile.stages.find((stage) => stage.key === lead.stage)?.label ?? lead.stage;
  const overdueTask = profile.tasks.find((task) => !task.done && task.due_on && task.due_on <= new Date().toISOString().slice(0, 10));
  const next = leadNextAction({
    id: lead.id,
    created_at: lead.created_at,
    stage: lead.stage,
    stage_label: stageLabel,
    source: lead.source,
    name: lead.name,
    event_type: lead.event_type,
    event_date: lead.event_date,
    guest_count: lead.guest_count,
    budget_cents: lead.budget_cents,
    converted_event_id: lead.converted_event_id,
    customer_id: lead.customer_id,
    assignee_name: profile.staff.find((person) => person.id === lead.assignee_id)?.name ?? null,
    consultation_at: lead.consultation_at,
    follow_up_due: !!overdueTask,
    due_task: overdueTask?.title ?? null,
  });
  const rows: [string, string][] = [
    ["Received", new Date(lead.created_at).toLocaleString("en-US")],
    ["Source", sourceLabel(lead.source)],
    ["Event", lead.event_type],
    ["Date", lead.event_date || "Not decided"],
    ["Guests", lead.guest_count || "Not supplied"],
    ["Location", lead.location || "Not supplied"],
    ["Venue", lead.venue_name || "Not supplied"],
    ["Venue status", lead.venue_status || "Not supplied"],
    ["Services", lead.services.length ? lead.services.join(", ") : "Not supplied"],
    ["Estimated budget", lead.budget_cents == null ? "Not entered" : money(lead.budget_cents / 100)],
    ["Customer", profile.customer ? [profile.customer.name, profile.customer.email || profile.customer.phone].filter(Boolean).join(" · ") : "Not linked"],
    ["Vibe", lead.vibe || "Not supplied"],
    ["Priorities", lead.priorities.length ? lead.priorities.join(", ") : "None selected"],
  ];

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="of-crm-header">
          <div>
            <p className="of-ecr-kicker">Lead · {sourceLabel(lead.source)} · <span className="of-pill">{stageLabel}</span></p>
            <h1>{lead.name}</h1>
            <p className="of-ecr-meta">
              {lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : <span>No email</span>}
              {lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : null}
              <span>Prefers {lead.contact_method}</span>
              {lead.event_date ? <span>{lead.event_date}</span> : <span>Date undecided</span>}
            </p>
          </div>
          <div className="of-crm-header-actions">
            <a className="pl-btn sm ghost" href="/admin/leads">All leads</a>
            <a className="pl-btn sm ghost" href="/admin/leads?view=pipeline">Pipeline</a>
            {lead.converted_event_id ? (
              <>
                <a className="pl-btn sm" href={`/admin/planner/${lead.converted_event_id}`}>Control Room</a>
                <a className="pl-btn sm ghost" href={`/admin/calendar?event=${encodeURIComponent(lead.converted_event_id)}`}>Calendar</a>
                <a className="pl-btn sm ghost" href={`/admin/planner/${lead.converted_event_id}?room=payments`}>Quote / payments</a>
              </>
            ) : null}
            <a className="pl-btn sm ghost" href="/admin/clients">Clients</a>
          </div>
        </header>

        {profile.mergedInto && (
          <p className="of-state of-state-error" role="alert">
            This inquiry was merged into <a href={`/admin/leads/${profile.mergedInto.id}`}>{profile.mergedInto.name}</a>.
          </p>
        )}

        <section className="of-panel of-ecr-actions">
          <div className="of-panel-head"><h2>Next action</h2></div>
          <p className="of-ecr-fine">{next}</p>
          {overdueTask ? <p className="of-pill of-pill-not_ready">Overdue follow-up: {overdueTask.title} · {overdueTask.due_on}</p> : null}
        </section>

        <div className="of-ecr-grid">
          <section className="of-panel">
            <div className="of-panel-head"><h2>Customer & event</h2></div>
            <dl className="of-ecr-dl">
              {rows.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </section>
          <section className="of-panel">
            <div className="of-panel-head"><h2>Consultation</h2></div>
            <dl className="of-ecr-dl">
              <div>
                <dt>Scheduled</dt>
                <dd>
                  {lead.consultation_at
                    ? new Date(lead.consultation_at).toLocaleString("en-US", { timeZone: "America/New_York" })
                    : "Not scheduled"}
                </dd>
              </div>
              <div><dt>Assignee</dt><dd>{profile.staff.find((person) => person.id === lead.assignee_id)?.name || "Unassigned"}</dd></div>
              <div><dt>Stage</dt><dd>{stageLabel}</dd></div>
            </dl>
          </section>
        </div>

        <LeadEditor
          id={lead.id}
          stage={lead.stage}
          notes={lead.notes ?? ""}
          assigneeId={lead.assignee_id}
          consultationAt={lead.consultation_at}
          budgetCents={lead.budget_cents}
          lostReason={lead.lost_reason}
          stages={profile.stages}
          staff={profile.staff.map((person) => ({ id: person.id, name: person.name }))}
          activities={profile.activities}
          tasks={profile.tasks}
          duplicates={profile.duplicates}
          convertedEventId={lead.converted_event_id}
          merged={!!lead.merged_into_id}
          canTasks={can(actor.role, "tasks.write")}
          canConvert={can(actor.role, "events.write")}
        />
      </div>
    </div>
  );
}
