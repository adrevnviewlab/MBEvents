import { env } from "@/lib/env";
import { can } from "@/lib/authz";
import { getActor, requireAdminPage } from "@/lib/admin";
import { listLeads, listOfficeStaff, listStages } from "@/lib/crm";
import { formatBudgetCents, leadNextAction, sourceLabel } from "@/lib/crm-ui";
import { CrmPipeline } from "@/components/office/crm-board";
import { LeadStagesEditor } from "@/components/lead-stages-editor";
import "../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads | MB Admin", robots: { index: false, follow: false } };

const sources = ["builder", "availability", "venue", "contact", "blueprint"] as const;

function one(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim();
}

/** Stable date label — avoids locale hydration mismatches. */
function receivedLabel(iso: string) {
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return iso;
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y}`;
}

export default async function AdminLeads({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  await requireAdminPage("/admin/leads", "leads.read");
  const params = await searchParams;
  const query = {
    q: one(params.q),
    stage: one(params.stage),
    source: one(params.source),
    assignee: one(params.assignee),
    sort: one(params.sort) === "event" ? "event" : "received",
    focus: one(params.focus),
  };
  const view = one(params.view) === "pipeline" ? "pipeline" : "table";
  let unavailable = !env.DB;
  let leads: Awaited<ReturnType<typeof listLeads>>["leads"] = [];
  let stats: Awaited<ReturnType<typeof listLeads>>["stats"] | null = null;
  let stages: Awaited<ReturnType<typeof listStages>> = [];
  let staff: Awaited<ReturnType<typeof listOfficeStaff>> = [];
  if (env.DB) {
    try {
      const listed = await listLeads(query);
      leads = listed.leads;
      stats = listed.stats;
      stages = await listStages();
      staff = await listOfficeStaff();
    } catch (error) {
      console.error("Lead list failed", error);
      unavailable = true;
    }
  }
  const canWrite = !!actor && can(actor.role, "leads.write");
  const leadHref = (next: "table" | "pipeline") => {
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (query.stage) sp.set("stage", query.stage);
    if (query.source) sp.set("source", query.source);
    if (query.assignee) sp.set("assignee", query.assignee);
    if (query.sort === "event") sp.set("sort", "event");
    if (query.focus) sp.set("focus", query.focus);
    if (next === "pipeline") sp.set("view", "pipeline");
    const text = sp.toString();
    return text ? `?${text}` : "?";
  };
  const cards = stats ? [
    ["New this week", stats.newWeek, "new"],
    ["Unassigned", stats.unassigned, "unassigned"],
    ["Follow-ups due", stats.due, "due"],
    ["Consultations", stats.consultations, "consultations"],
    ["Booked", stats.booked, "booked"],
    ["Lost", stats.lost, "lost"],
  ] as const : [];

  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="of-crm-header">
          <div>
            <h1>Leads & CRM</h1>
            <p>Inquiry pipeline from the website. Moving stages never confirms a booking or invents revenue.</p>
          </div>
          <div className="of-crm-header-actions">
            <a className="pl-btn sm ghost" href="/admin/clients">Clients</a>
            <a className="pl-btn sm ghost" href="/admin/calendar">Calendar</a>
            <a className="pl-btn sm" href="/admin/planner">Events</a>
          </div>
        </header>

        {unavailable ? (
          <p className="of-state of-state-error" role="alert">Leads are temporarily unavailable. Please try again.</p>
        ) : (
          <>
            {stats && (
              <div className="of-crm-kpis">
                {cards.map(([label, count, focus]) => (
                  <a
                    className={`of-panel of-crm-kpi${query.focus === focus ? " is-on" : ""}`}
                    href={`?focus=${focus}${view === "pipeline" ? "&view=pipeline" : ""}`}
                    key={focus}
                  >
                    <small>{label}</small>
                    <strong>{count}</strong>
                  </a>
                ))}
              </div>
            )}

            <section className="of-panel">
              <div className="of-panel-head">
                <h2>Find leads</h2>
                <div className="of-seg" role="group" aria-label="Lead view">
                  <a className={`of-surface${view === "table" ? " is-on" : ""}`} href={leadHref("table")}>Table</a>
                  <a className={`of-surface${view === "pipeline" ? " is-on" : ""}`} href={leadHref("pipeline")}>Pipeline</a>
                </div>
              </div>
              <form className="of-crm-filters" method="get">
                <label>
                  <span>Search</span>
                  <input name="q" defaultValue={query.q} placeholder="Name, email, phone" />
                </label>
                <label>
                  <span>Stage</span>
                  <select name="stage" defaultValue={query.stage}>
                    <option value="">All stages</option>
                    {stages.map((stage) => <option value={stage.key} key={stage.key}>{stage.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>Source</span>
                  <select name="source" defaultValue={query.source}>
                    <option value="">All sources</option>
                    {sources.map((source) => <option value={source} key={source}>{sourceLabel(source)}</option>)}
                  </select>
                </label>
                <label>
                  <span>Assignee</span>
                  <select name="assignee" defaultValue={query.assignee}>
                    <option value="">Anyone</option>
                    <option value="unassigned">Unassigned</option>
                    {staff.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Sort</span>
                  <select name="sort" defaultValue={query.sort}>
                    <option value="received">Received</option>
                    <option value="event">Event date</option>
                  </select>
                </label>
                {query.focus && <input type="hidden" name="focus" value={query.focus} />}
                {view === "pipeline" && <input type="hidden" name="view" value="pipeline" />}
                <div className="of-crm-filter-actions">
                  <button className="pl-btn sm" type="submit">Apply</button>
                  <a className="pl-btn sm ghost" href={view === "pipeline" ? "?view=pipeline" : "?"}>Clear</a>
                </div>
              </form>
              {stats?.byStage?.length ? (
                <div className="of-crm-stage-chips">
                  {stats.byStage.map((stage) => (
                    <a className={`of-pill${query.stage === stage.key ? " of-pill-confirmed" : ""}`} href={`?stage=${encodeURIComponent(stage.key)}${view === "pipeline" ? "&view=pipeline" : ""}`} key={stage.key}>
                      {stage.label} · {stage.count}
                    </a>
                  ))}
                </div>
              ) : null}
            </section>

            {view === "pipeline" ? (
              <CrmPipeline leads={leads} stages={stages} filtered={!!(query.q || query.stage || query.source || query.assignee || query.focus)} canWrite={canWrite} />
            ) : (
              <section className="of-panel of-crm-table-panel">
                <div className="of-panel-head">
                  <h2>{leads.length === 1 ? "1 lead" : `${leads.length} leads`}</h2>
                </div>
                {leads.length ? (
                  <div className="of-table-wrap">
                    <table className="of-table of-crm-table">
                      <thead>
                        <tr>
                          <th>Received</th>
                          <th>Lead</th>
                          <th>Event</th>
                          <th>Date</th>
                          <th>Budget</th>
                          <th>Source</th>
                          <th>Assignee</th>
                          <th>Stage</th>
                          <th>Next</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {leads.map((row) => (
                          <tr key={row.id} className={row.follow_up_due ? "is-overdue" : undefined}>
                            <td>{receivedLabel(row.created_at)}</td>
                            <td>
                              <a href={`/admin/leads/${row.id}`}>{row.name}</a>
                              {row.follow_up_due ? <span className="of-pill of-pill-not_ready">Due</span> : null}
                            </td>
                            <td>{row.event_type}</td>
                            <td>{row.event_date || "Undecided"}</td>
                            <td className="of-mono">{formatBudgetCents(row.budget_cents) || "—"}</td>
                            <td>{sourceLabel(row.source)}</td>
                            <td>{row.assignee_name || "Unassigned"}</td>
                            <td><span className="of-pill">{row.stage_label}</span></td>
                            <td className="of-crm-next">{leadNextAction(row)}</td>
                            <td className="of-row-actions">
                              <a className="pl-btn sm ghost" href={`/admin/leads/${row.id}`}>Open</a>
                              {row.converted_event_id ? (
                                <a className="pl-btn sm ghost" href={`/admin/planner/${row.converted_event_id}`}>Control Room</a>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="of-state">{query.q || query.stage || query.source || query.assignee || query.focus ? "No leads match." : "No leads yet. New website inquiries will appear here."}</p>
                )}
              </section>
            )}

            {actor && can(actor.role, "users.manage") && stages.length > 0 && (
              <section className="of-panel">
                <div className="of-panel-head"><h2>Pipeline stages</h2></div>
                <LeadStagesEditor key={stages.map((stage) => `${stage.key}:${stage.label}:${stage.position}:${stage.active}`).join("|")} stages={stages} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
