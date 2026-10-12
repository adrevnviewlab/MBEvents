export const leadStages = ["new_lead", "attempted_contact", "contacted", "consultation_scheduled", "consultation_completed", "proposal_sent", "follow_up", "deposit_pending", "booked", "event_planning", "event_completed", "review_requested", "referral", "lost"] as const;
export type LeadStage = typeof leadStages[number];
export function stageLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, x => x.toUpperCase()); }
