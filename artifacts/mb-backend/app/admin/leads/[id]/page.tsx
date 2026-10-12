import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireAdminPage, stageLabel } from "@/lib/admin";
import { LeadEditor } from "@/components/lead-editor";
import "../../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead | MB Admin", robots: { index: false, follow: false } };

type Lead = {
  id: string; created_at: string; stage: string; source: string; name: string; email: string; phone: string; event_type: string;
  event_date: string | null; guest_count: string | null; location: string | null; venue_status: string | null; vibe: string | null;
  priorities: string; contact_method: string; notes: string | null;
};

export default async function LeadProfile({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/admin/leads");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !env.DB) notFound();
  const lead = await env.DB.prepare("SELECT id, created_at, stage, source, name, email, phone, event_type, event_date, guest_count, location, venue_status, vibe, priorities, contact_method, notes FROM leads WHERE id = ?")
    .bind(id)
    .first<Lead>();
  if (!lead) notFound();
  const priorities = (() => {
    try {
      return (JSON.parse(lead.priorities) as string[]).join(", ");
    } catch {
      return "";
    }
  })();
  const rows: [string, string][] = [
    ["Received", new Date(lead.created_at).toLocaleString("en-US")],
    ["Event", lead.event_type],
    ["Date", lead.event_date || "Not decided"],
    ["Guests", lead.guest_count || "Not supplied"],
    ["Location", lead.location || "Not supplied"],
    ["Venue", lead.venue_status || "Not supplied"],
    ["Vibe", lead.vibe || "Not supplied"],
    ["Priorities", priorities || "None selected"],
  ];
  return (
    <div className="pl">
      <div className="pl-wrap narrow">
        <div className="pl-top"><a href="/admin/leads">← All leads</a><span>Lead · {lead.source}</span><span className="pl-tag">{stageLabel(lead.stage)}</span></div>
        <header className="pl-hero">
          <h1>{lead.name}</h1>
          <div className="pl-sub">
            {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
            {lead.email && lead.phone && " · "}
            {lead.phone && <a href={`tel:${lead.phone}`}>{lead.phone}</a>}
            {` · prefers ${lead.contact_method}`}
          </div>
        </header>
        <div className="pl-card">
          {rows.map(([k, v]) => <div className="pl-row" key={k}><span className="pl-k" style={{ width: 120 }}>{k}</span><span className="t">{v}</span></div>)}
        </div>
        <LeadEditor id={lead.id} initialStage={lead.stage} initialNotes={lead.notes ?? ""} />
        <a className="pl-btn ghost" href={`/admin/planner?lead=${lead.id}`}>Create client planner from this lead</a>
      </div>
    </div>
  );
}
