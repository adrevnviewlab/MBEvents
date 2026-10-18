/** Shared CRM presentation helpers — derived only from stored lead fields. */

export type LeadListRow = {
  id: string;
  created_at: string;
  stage: string;
  stage_label: string;
  source: string;
  name: string;
  event_type: string;
  event_date: string | null;
  guest_count: string | null;
  budget_cents?: number | null;
  converted_event_id?: string | null;
  customer_id?: string | null;
  assignee_name: string | null;
  consultation_at: string | null;
  follow_up_due: boolean;
  due_task: string | null;
};

export function leadNextAction(lead: LeadListRow): string {
  if (lead.follow_up_due) return lead.due_task ? `Overdue: ${lead.due_task}` : "Complete overdue follow-up";
  if (lead.converted_event_id) return "Open Event Control Room";
  if (!lead.assignee_name) return "Assign an owner";
  if (lead.consultation_at) {
    const when = new Date(lead.consultation_at);
    if (!Number.isNaN(when.getTime()) && when.getTime() >= Date.now()) return "Prepare for consultation";
  }
  if (lead.stage === "lost") return "Closed lost";
  if (lead.stage === "proposal_sent" || lead.stage === "deposit_pending") return "Follow up on quote / deposit";
  if (lead.stage === "consultation_scheduled") return lead.consultation_at ? "Hold consultation" : "Schedule consultation";
  if (lead.stage === "new_lead" || lead.stage === "attempted_contact") return "Make contact";
  if (lead.stage === "contacted") return "Schedule consultation or send quote";
  if (lead.stage === "booked" || lead.stage === "event_planning") return "Continue in Control Room once booked";
  return "Advance pipeline or add follow-up";
}

export function formatBudgetCents(cents: number | null | undefined) {
  if (cents == null) return null;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function sourceLabel(source: string) {
  const map: Record<string, string> = {
    builder: "Book My Event",
    availability: "Check My Date",
    venue: "Venue",
    contact: "Contact",
    blueprint: "Blueprint",
  };
  return map[source] || source;
}
