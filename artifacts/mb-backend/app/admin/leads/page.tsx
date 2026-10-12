import { env } from "@/lib/env";
import { requireAdminPage, stageLabel } from "@/lib/admin";
import { AdminSignOut } from "@/components/admin-auth";
import "../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads | MB Admin", robots: { index: false, follow: false } };

type Row = { id: string; created_at: string; stage: string; source: string; name: string; event_type: string; event_date: string | null; guest_count: string | null };

export default async function AdminLeads() {
  await requireAdminPage("/admin/leads");
  let rows: Row[] = [];
  let unavailable = !env.DB;
  if (env.DB) {
    try {
      rows = (await env.DB.prepare("SELECT id, created_at, stage, source, name, event_type, event_date, guest_count FROM leads ORDER BY created_at DESC LIMIT 200").all<Row>()).results;
    } catch (error) {
      console.error("Lead list failed", error);
      unavailable = true;
    }
  }
  return (
    <div className="pl">
      <div className="pl-wrap">
        <div className="pl-top"><a href="/admin/planner">Client planners</a><span>MB Admin · Leads</span><span><a href="/">Website ↗</a> · <AdminSignOut /></span></div>
        <header className="pl-hero"><h1>Leads</h1><p className="pl-intro">Book My Event, Check My Date, venue, and contact inquiries from the website.</p></header>
        {unavailable ? (
          <p className="pl-warn">Leads are temporarily unavailable. Please try again.</p>
        ) : (
          <div className="pl-card" style={{ overflowX: "auto" }}>
            {rows.length ? (
              <table className="pl-admin-table">
                <thead><tr><th>Received</th><th>Name</th><th>Event</th><th>Date</th><th>Guests</th><th>Source</th><th>Stage</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.created_at).toLocaleDateString("en-US")}</td>
                      <td><a href={`/admin/leads/${row.id}`}>{row.name}</a></td>
                      <td>{row.event_type}</td>
                      <td>{row.event_date || "Undecided"}</td>
                      <td>{row.guest_count || "—"}</td>
                      <td>{row.source}</td>
                      <td><span className="pl-tag">{stageLabel(row.stage)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="pl-empty">No leads yet. New website inquiries will appear here.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
