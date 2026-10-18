-- Phase 2 CRM. Stages are the existing pipeline, copied so labels and order can change
-- without breaking leads that already use these keys. No venues, prices, or accounts are seeded.

CREATE TABLE lead_stages (
  key text PRIMARY KEY,
  label text NOT NULL,
  position integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_stages_position_idx ON lead_stages (position);

INSERT INTO lead_stages (key, label, position) VALUES
  ('new_lead', 'New Lead', 0),
  ('attempted_contact', 'Attempted Contact', 1),
  ('contacted', 'Contacted', 2),
  ('consultation_scheduled', 'Consultation Scheduled', 3),
  ('consultation_completed', 'Consultation Completed', 4),
  ('proposal_sent', 'Proposal Sent', 5),
  ('follow_up', 'Follow Up', 6),
  ('deposit_pending', 'Deposit Pending', 7),
  ('booked', 'Booked', 8),
  ('event_planning', 'Event Planning', 9),
  ('event_completed', 'Event Completed', 10),
  ('review_requested', 'Review Requested', 11),
  ('referral', 'Referral', 12),
  ('lost', 'Lost', 13);

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'leads' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%new_lead%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE leads DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE leads
  ADD CONSTRAINT leads_stage_fkey
  FOREIGN KEY (stage) REFERENCES lead_stages (key)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

ALTER TABLE leads ADD COLUMN assignee_id uuid REFERENCES staff (id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN venue_name text;
ALTER TABLE leads ADD COLUMN budget_cents integer CHECK (budget_cents IS NULL OR budget_cents >= 0);
ALTER TABLE leads ADD COLUMN services jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE leads ADD COLUMN lost_reason text;
ALTER TABLE leads ADD COLUMN consultation_at timestamptz;
ALTER TABLE leads ADD COLUMN merged_into_id uuid REFERENCES leads (id) ON DELETE RESTRICT;
ALTER TABLE leads ADD COLUMN converted_event_id uuid REFERENCES events (id) ON DELETE SET NULL;

-- Existing lost rows are left alone. New writes must include a free-text reason.
ALTER TABLE leads ADD CONSTRAINT leads_lost_reason_check
  CHECK (stage <> 'lost' OR coalesce(btrim(lost_reason), '') <> '') NOT VALID;

CREATE INDEX leads_assignee_idx ON leads (assignee_id);
CREATE INDEX leads_open_created_idx ON leads (created_at DESC) WHERE merged_into_id IS NULL;
CREATE UNIQUE INDEX leads_converted_event_uidx ON leads (converted_event_id) WHERE converted_event_id IS NOT NULL;

ALTER TABLE tasks ADD COLUMN lead_id uuid REFERENCES leads (id) ON DELETE CASCADE;
ALTER TABLE tasks ADD CONSTRAINT tasks_has_subject CHECK (event_id IS NOT NULL OR lead_id IS NOT NULL);
CREATE INDEX tasks_lead_idx ON tasks (lead_id);
CREATE INDEX tasks_lead_due_idx ON tasks (due_on) WHERE lead_id IS NOT NULL AND done = false;

CREATE TABLE lead_activities (
  id uuid PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  actor text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('note', 'stage', 'assignment', 'consultation', 'conversion', 'merge', 'lead_created')),
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_activities_lead_idx ON lead_activities (lead_id, created_at DESC);
