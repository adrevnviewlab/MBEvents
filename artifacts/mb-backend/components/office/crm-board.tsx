"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/planner/ui";
import { formatBudgetCents, leadNextAction, sourceLabel, type LeadListRow } from "@/lib/crm-ui";

type Stage = { key: string; label: string; active: boolean };

/**
 * Kanban pipeline. Stage moves call PATCH /api/admin/leads/[id] only.
 * Does not convert leads, create customers, or change booking status.
 */
export function CrmPipeline({
  leads,
  stages,
  filtered,
  canWrite,
}: {
  leads: LeadListRow[];
  stages: Stage[];
  filtered: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const keys = [...new Set([
    ...stages.map((stage) => stage.key),
    ...leads.map((lead) => lead.stage).filter((key) => !stages.some((stage) => stage.key === key)),
  ])].filter((key) => {
    const stage = stages.find((item) => item.key === key);
    return leads.some((lead) => lead.stage === key) || stage?.active !== false;
  });

  const move = async (leadId: string, stage: string, current: string) => {
    if (!canWrite || stage === current) return;
    let lostReason: string | null | undefined;
    if (stage === "lost") {
      const reason = window.prompt("Reason this lead was lost (required):");
      if (!reason?.trim()) return;
      lostReason = reason.trim();
    }
    setBusyId(leadId);
    setError("");
    try {
      await api(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        body: lostReason ? { stage, lostReason } : { stage },
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (!keys.length) {
    return <p className="of-state">{filtered ? "No leads match." : "No leads yet. New website inquiries will appear here."}</p>;
  }

  return (
    <div className="of-crm-pipe-wrap">
      {error ? <p className="of-state of-state-error" role="alert">{error}</p> : null}
      {!leads.length && <p className="of-state">{filtered ? "No leads match." : "No leads yet. New website inquiries will appear here."}</p>}
      <div className="of-pipe of-crm-pipe">
        {keys.map((key) => {
          const stage = stages.find((item) => item.key === key);
          const rows = leads.filter((lead) => lead.stage === key);
          const label = stage?.label || rows[0]?.stage_label || key;
          return (
            <section className="of-col" key={key}>
              <header>
                <h2>{label}</h2>
                <span className="of-count">{rows.length}</span>
              </header>
              <div className="of-card-group">
                {rows.length ? rows.map((lead) => (
                  <article className={`of-lead of-surface${lead.follow_up_due ? " is-overdue" : ""}`} key={lead.id}>
                    <a className="of-lead-title" href={`/admin/leads/${lead.id}`}>
                      <strong>{lead.name}</strong>
                      <span>{lead.event_type}</span>
                      <span className="of-mono">{lead.event_date || "Date not set"}</span>
                      {lead.budget_cents != null ? <span>{formatBudgetCents(lead.budget_cents)}</span> : null}
                      <span>{sourceLabel(lead.source)}</span>
                      {lead.assignee_name ? <span>{lead.assignee_name}</span> : <span className="of-warn-text">Unassigned</span>}
                      {lead.consultation_at ? (
                        <span>
                          Consult{" "}
                          {new Date(lead.consultation_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            timeZone: "America/New_York",
                          })}
                        </span>
                      ) : null}
                      {lead.follow_up_due ? <span className="of-pill of-pill-not_ready">{lead.due_task || "Follow-up due"}</span> : null}
                      <span className="of-lead-next">{leadNextAction(lead)}</span>
                    </a>
                    <div className="of-lead-actions">
                      {lead.converted_event_id ? (
                        <a className="pl-btn sm ghost" href={`/admin/planner/${lead.converted_event_id}`}>Control Room</a>
                      ) : null}
                      {canWrite ? (
                        <label className="of-lead-move">
                          <select
                            aria-label={`Move ${lead.name} to stage`}
                            value={lead.stage}
                            disabled={busyId === lead.id}
                            onChange={(e) => move(lead.id, e.target.value, lead.stage)}
                          >
                            {stages.filter((s) => s.active || s.key === lead.stage).map((s) => (
                              <option key={s.key} value={s.key}>{s.label}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  </article>
                )) : <p className="pl-empty">None</p>}
              </div>
            </section>
          );
        })}
      </div>
      {canWrite ? <p className="of-ecr-fine">Moving a card updates the CRM stage only. It does not confirm a booking or create a customer.</p> : null}
    </div>
  );
}
