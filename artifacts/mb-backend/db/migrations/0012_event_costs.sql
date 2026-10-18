-- Staff-entered costs for an event. No amounts are seeded.
-- Profit is revenue minus these rows only when at least one row exists.

-- Same table as 0008_event_costs.sql. Create it only when that migration has not.
CREATE TABLE IF NOT EXISTS event_costs (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_costs_event_idx ON event_costs (event_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'event_costs_updated') THEN
    CREATE TRIGGER event_costs_updated BEFORE UPDATE ON event_costs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE event_costs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE event_costs FROM %I', r);
    END IF;
  END LOOP;
END $$;
