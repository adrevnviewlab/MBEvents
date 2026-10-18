-- Automations send through the invite message queue. This does not add a second queue.
-- Invite rows stay event-scoped. Automation rows add the template and the record they belong to.
-- No template or job rows are inserted.

ALTER TABLE message_jobs ALTER COLUMN event_id DROP NOT NULL;

ALTER TABLE message_jobs
  ADD COLUMN template_id uuid REFERENCES automation_templates (id) ON DELETE CASCADE,
  ADD COLUMN entity_type text,
  ADD COLUMN entity_id uuid,
  ADD COLUMN occurrence text NOT NULL DEFAULT '',
  ADD COLUMN customer_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5);

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN ('lead', 'event', 'guest'));

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'message_jobs' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%invite%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE message_jobs DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_kind_check CHECK (kind IN (
    'invite', 'reminder',
    'inquiry_confirmation', 'sales_follow_up', 'consultation_reminder', 'proposal_follow_up',
    'deposit_reminder', 'planning_deadline', 'rsvp_reminder', 'event_preparation',
    'thank_you', 'review_request', 'referral'
  ));

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'message_jobs' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%pending%'
    AND pg_get_constraintdef(con.oid) NOT ILIKE '%attempt_count%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE message_jobs DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE message_jobs
  ADD CONSTRAINT message_jobs_status_check CHECK (status IN ('pending', 'sent', 'failed', 'canceled'));

-- One automation send per template, record, and occurrence. Invite rows have no template, so they are not in this index.
CREATE UNIQUE INDEX message_jobs_automation_once
  ON message_jobs (template_id, entity_type, entity_id, occurrence)
  WHERE template_id IS NOT NULL;

CREATE INDEX message_jobs_customer_idx ON message_jobs (customer_id) WHERE customer_id IS NOT NULL;
