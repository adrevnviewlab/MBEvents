-- Phase 5: extend the existing tasks table (lead + event + general) and ops checklist assignment.
-- Does not invent a second task system. Priority defaults keep older rows compatible.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_check'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check
      CHECK (priority IN ('low', 'normal', 'high'));
  END IF;
END $$;

-- Allow general business tasks (neither lead nor event) while keeping linked rows valid.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_has_subject;

CREATE INDEX IF NOT EXISTS tasks_due_open_idx ON tasks (due_on) WHERE done = false;
CREATE INDEX IF NOT EXISTS tasks_priority_open_idx ON tasks (priority) WHERE done = false;

ALTER TABLE event_checklist ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES staff (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS event_checklist_assignee_idx ON event_checklist (assignee_id);
