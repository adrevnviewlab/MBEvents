-- Phase 8 seating: named tables with capacity on the existing guests / invitations model.
-- Does not invent a second guest database. guests.table_label stays for display/backfill.
-- Rollback: see docs/deploy-rollback.md § "0020_event_tables".

CREATE TABLE IF NOT EXISTS event_tables (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  label text NOT NULL,
  capacity integer NOT NULL DEFAULT 8 CHECK (capacity >= 1 AND capacity <= 200),
  sort_order integer NOT NULL DEFAULT 0,
  pos_x numeric NOT NULL DEFAULT 0,
  pos_y numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(label) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS event_tables_event_label_uidx ON event_tables (event_id, lower(btrim(label)));
CREATE INDEX IF NOT EXISTS event_tables_event_idx ON event_tables (event_id, sort_order, label);
CREATE TRIGGER event_tables_updated BEFORE UPDATE ON event_tables FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE guests ADD COLUMN IF NOT EXISTS table_id uuid REFERENCES event_tables (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS guests_table_idx ON guests (table_id) WHERE table_id IS NOT NULL;

-- Backfill tables from free-text labels already stored on guests.
INSERT INTO event_tables (id, event_id, label, capacity, sort_order, pos_x, pos_y)
SELECT gen_random_uuid(),
       g.event_id,
       btrim(g.table_label),
       GREATEST(8, COALESCE(SUM(g.party_size), 0)::int + 2),
       (ROW_NUMBER() OVER (PARTITION BY g.event_id ORDER BY MIN(g.created_at)) - 1)::int,
       ((ROW_NUMBER() OVER (PARTITION BY g.event_id ORDER BY MIN(g.created_at)) - 1) % 4) * 180,
       (FLOOR((ROW_NUMBER() OVER (PARTITION BY g.event_id ORDER BY MIN(g.created_at)) - 1) / 4.0)) * 140
FROM guests g
WHERE btrim(g.table_label) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM event_tables t
    WHERE t.event_id = g.event_id AND lower(btrim(t.label)) = lower(btrim(g.table_label))
  )
GROUP BY g.event_id, btrim(g.table_label);

UPDATE guests AS g
SET table_id = t.id
FROM event_tables AS t
WHERE g.table_id IS NULL
  AND btrim(g.table_label) <> ''
  AND t.event_id = g.event_id
  AND lower(btrim(t.label)) = lower(btrim(g.table_label));

ALTER TABLE event_tables ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE event_tables FROM %I', r);
    END IF;
  END LOOP;
END $$;
