-- Planning templates staff can reuse. The app copies the checklist, timeline,
-- and dance moments already in the planner into this table. No prices or policies.

CREATE TABLE planning_templates (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  name text NOT NULL,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  dances jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  published boolean NOT NULL DEFAULT false,
  seeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX planning_templates_type_idx ON planning_templates (event_type, published);
CREATE UNIQUE INDEX planning_templates_seed_uidx ON planning_templates (event_type) WHERE seeded;

CREATE TRIGGER planning_templates_updated
  BEFORE UPDATE ON planning_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE planning_templates ENABLE ROW LEVEL SECURITY;

-- Deadlines the client can see are checklist labels, plus tasks marked visible.
-- Existing tasks stay off the client planner until someone marks them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'client_visible'
  ) THEN
    ALTER TABLE tasks ADD COLUMN client_visible boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tasks_client_visible_idx ON tasks (event_id) WHERE client_visible;
