-- Phase 5 operations. The planner timeline, songs, and team stay the run of show.
-- event_checklist and event_requirements are internal. They are not the client checklist.
-- Rates and payouts are nullable and have no default. No staff, gear, or requirements are seeded.
-- event_vendors already links a vendor to an event; this file does not create that table again.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS profile_type text NOT NULL DEFAULT 'other';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS rate_cents integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_profile_type_check') THEN
    ALTER TABLE staff ADD CONSTRAINT staff_profile_type_check
      CHECK (profile_type IN ('dj', 'mc', 'dancer', 'coordinator', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_rate_cents_check') THEN
    ALTER TABLE staff ADD CONSTRAINT staff_rate_cents_check
      CHECK (rate_cents IS NULL OR rate_cents >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS staff_skills (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (length(btrim(tag)) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_skills_tag_uidx ON staff_skills (staff_id, lower(tag));
CREATE INDEX IF NOT EXISTS staff_skills_staff_idx ON staff_skills (staff_id);

CREATE TABLE IF NOT EXISTS staff_blocks (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS staff_blocks_staff_idx ON staff_blocks (staff_id, starts_at, ends_at);

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS ends_at timestamptz;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS payout_cents integer;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS internal_notes text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_window_chk') THEN
    ALTER TABLE assignments ADD CONSTRAINT assignments_window_chk CHECK (
      (starts_at IS NULL AND ends_at IS NULL)
      OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_payout_cents_check') THEN
    ALTER TABLE assignments ADD CONSTRAINT assignments_payout_cents_check
      CHECK (payout_cents IS NULL OR payout_cents >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS assignments_staff_window_idx ON assignments (staff_id, starts_at, ends_at);

-- Equipment quantity overlap stays in the calendar function equipment_not_overbooked.
-- Canceled and completed bookings do not hold gear because booking_blocks is false for them.

CREATE TABLE IF NOT EXISTS equipment_categories (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_categories_name_uidx ON equipment_categories (lower(name));
DROP TRIGGER IF EXISTS equipment_categories_updated ON equipment_categories;
CREATE TRIGGER equipment_categories_updated BEFORE UPDATE ON equipment_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE equipment ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES equipment_categories (id) ON DELETE SET NULL;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS backup_equipment_id uuid REFERENCES equipment (id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_backup_not_self') THEN
    ALTER TABLE equipment ADD CONSTRAINT equipment_backup_not_self
      CHECK (backup_equipment_id IS NULL OR backup_equipment_id <> id);
  END IF;
END $$;

ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS ends_at timestamptz;
ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS maintenance_notes text NOT NULL DEFAULT '';
ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS damage_notes text NOT NULL DEFAULT '';
ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS returned_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_reservations_window_chk') THEN
    ALTER TABLE equipment_reservations ADD CONSTRAINT equipment_reservations_window_chk CHECK (
      (starts_at IS NULL AND ends_at IS NULL)
      OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS packing_items (
  id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES equipment_reservations (id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  packed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS packing_items_reservation_idx ON packing_items (reservation_id);
DROP TRIGGER IF EXISTS packing_items_updated ON packing_items;
CREATE TRIGGER packing_items_updated BEFORE UPDATE ON packing_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE events ADD COLUMN IF NOT EXISTS load_in_instructions text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS setup_schedule text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS breakdown_schedule text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS internal_notes text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS event_checklist (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  done boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_checklist_event_idx ON event_checklist (event_id, sort_order);
DROP TRIGGER IF EXISTS event_checklist_updated ON event_checklist;
CREATE TRIGGER event_checklist_updated BEFORE UPDATE ON event_checklist
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS event_requirements (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  met boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_requirements_event_idx ON event_requirements (event_id);
DROP TRIGGER IF EXISTS event_requirements_updated ON event_requirements;
CREATE TRIGGER event_requirements_updated BEFORE UPDATE ON event_requirements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- No requirement rows is unset. Ready only when every stored requirement is met.
CREATE OR REPLACE FUNCTION event_readiness(p_event_id uuid) RETURNS text AS $$
DECLARE
  total integer;
  open_count integer;
BEGIN
  SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE NOT met)::int
    INTO total, open_count
  FROM event_requirements
  WHERE event_id = p_event_id;
  IF total = 0 THEN
    RETURN 'unset';
  END IF;
  IF open_count = 0 THEN
    RETURN 'ready';
  END IF;
  RETURN 'not_ready';
END $$ LANGUAGE plpgsql STABLE;

CREATE TABLE IF NOT EXISTS incident_reports (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff (id) ON DELETE SET NULL,
  author_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_reports_event_idx ON incident_reports (event_id, created_at);

CREATE OR REPLACE FUNCTION reject_incident_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'incident_reports_append_only';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS incident_reports_no_update ON incident_reports;
CREATE TRIGGER incident_reports_no_update BEFORE UPDATE ON incident_reports
  FOR EACH ROW EXECUTE FUNCTION reject_incident_mutation();
DROP TRIGGER IF EXISTS incident_reports_no_delete ON incident_reports;
CREATE TRIGGER incident_reports_no_delete BEFORE DELETE ON incident_reports
  FOR EACH ROW EXECUTE FUNCTION reject_incident_mutation();

-- Unavailable windows use the calendar event block, including setup, breakdown, and travel buffer.
-- Assignment overlap itself is calendar's staff_conflict rule, via assignments_guard and assert_event_resources.
CREATE OR REPLACE FUNCTION assert_staff_not_blocked(p_staff_id uuid, p_event_id uuid) RETURNS void AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  PERFORM 1 FROM staff WHERE id = p_staff_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_not_found';
  END IF;
  SELECT block_start, block_end INTO v_start, v_end FROM event_block_bounds(p_event_id);
  IF v_start IS NULL OR v_end IS NULL OR v_start >= v_end THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM staff_blocks
    WHERE staff_id = p_staff_id
      AND starts_at < v_end
      AND ends_at > v_start
  ) THEN
    RAISE EXCEPTION 'staff_unavailable';
  END IF;
END $$ LANGUAGE plpgsql;

-- The insert runs in this statement, so the staff lock is still held when assignments_guard checks overlap.
CREATE OR REPLACE FUNCTION create_staff_assignment(
  p_id uuid,
  p_event_id uuid,
  p_staff_id uuid,
  p_role_label text,
  p_call_time text,
  p_starts timestamptz,
  p_ends timestamptz,
  p_payout_cents integer,
  p_internal_notes text
) RETURNS uuid AS $$
BEGIN
  PERFORM assert_staff_not_blocked(p_staff_id, p_event_id);
  INSERT INTO assignments (
    id, event_id, staff_id, role_label, call_time, status, starts_at, ends_at, payout_cents, internal_notes
  ) VALUES (
    p_id, p_event_id, p_staff_id, COALESCE(p_role_label, ''), COALESCE(p_call_time, ''), 'assigned',
    p_starts, p_ends, p_payout_cents, COALESCE(p_internal_notes, '')
  );
  PERFORM assert_event_resources(p_event_id, false);
  RETURN p_id;
END $$ LANGUAGE plpgsql;

ALTER TABLE staff_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;
