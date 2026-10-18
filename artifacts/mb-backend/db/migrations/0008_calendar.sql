-- Phase 3 calendar. Booking statuses, time windows, holds, and overlap checks.
-- A free date is not a booking. Conflicts are overlapping windows for the same
-- person or the same piece of equipment. No exclusion constraints: PGlite cannot use them.
-- Row locks are taken in one order: staff id, equipment id, then the booking.

ALTER TABLE events
  ADD COLUMN timezone text NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN starts_at timestamptz,
  ADD COLUMN ends_at timestamptz,
  ADD COLUMN setup_minutes integer,
  ADD COLUMN breakdown_minutes integer,
  ADD COLUMN setup_at timestamptz,
  ADD COLUMN breakdown_at timestamptz,
  ADD COLUMN travel_buffer_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN location text NOT NULL DEFAULT '',
  ADD COLUMN coordinator_id uuid REFERENCES staff (id) ON DELETE SET NULL,
  ADD COLUMN services jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN internal_notes text NOT NULL DEFAULT '';

ALTER TABLE events
  ADD CONSTRAINT events_timezone_check CHECK (timezone <> ''),
  ADD CONSTRAINT events_setup_minutes_check CHECK (setup_minutes IS NULL OR setup_minutes >= 0),
  ADD CONSTRAINT events_breakdown_minutes_check CHECK (breakdown_minutes IS NULL OR breakdown_minutes >= 0),
  ADD CONSTRAINT events_travel_buffer_check CHECK (travel_buffer_minutes >= 0),
  ADD CONSTRAINT events_services_check CHECK (jsonb_typeof(services) = 'array');

CREATE INDEX events_starts_at_idx ON events (starts_at);
CREATE INDEX events_coordinator_idx ON events (coordinator_id);

ALTER TABLE assignments ADD COLUMN blocking boolean NOT NULL DEFAULT true;
ALTER TABLE equipment_reservations ADD COLUMN blocking boolean NOT NULL DEFAULT true;

-- pending and hold were never confirmed. confirmed stays only when someone already set confirmed_at.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'bookings' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%pending%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE bookings DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

UPDATE bookings
SET status = CASE
  WHEN status = 'cancelled' THEN 'canceled'
  WHEN status = 'confirmed' AND confirmed_at IS NOT NULL THEN 'confirmed'
  ELSE 'tentative'
END
WHERE status IN ('pending', 'hold', 'confirmed', 'cancelled');

ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'tentative';
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('tentative', 'confirmed', 'canceled', 'completed'));

CREATE TABLE booking_history (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('confirm', 'reschedule', 'cancel', 'complete', 'hold', 'assign', 'release')),
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL DEFAULT '',
  actor_email text NOT NULL DEFAULT '',
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_history_booking_idx ON booking_history (booking_id, created_at);
CREATE INDEX booking_history_event_idx ON booking_history (event_id, created_at);

CREATE OR REPLACE FUNCTION booking_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking_history is append-only';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER booking_history_no_update
  BEFORE UPDATE ON booking_history
  FOR EACH ROW EXECUTE FUNCTION booking_history_append_only();

CREATE OR REPLACE FUNCTION write_booking_history(
  p_booking_id uuid, p_event_id uuid, p_action text, p_from text, p_to text,
  p_actor_email text, p_actor_id uuid, p_note text
) RETURNS void AS $$
BEGIN
  INSERT INTO booking_history (id, booking_id, event_id, action, from_status, to_status, actor_email, actor_id, note)
  VALUES (
    gen_random_uuid(), p_booking_id, p_event_id, p_action,
    COALESCE(p_from, ''), COALESCE(p_to, ''), COALESCE(p_actor_email, ''), p_actor_id, COALESCE(p_note, '')
  );
END $$ LANGUAGE plpgsql;

-- "4:00 PM", "16:00", and "16:00:00". Anything else is not a clock time.
CREATE OR REPLACE FUNCTION wall_clock(clock text) RETURNS time AS $$
DECLARE
  cleaned text;
  parts text[];
  h integer;
  m integer;
  s integer := 0;
  mer text;
BEGIN
  cleaned := upper(regexp_replace(btrim(COALESCE(clock, '')), '\s+', ' ', 'g'));
  IF cleaned = '' THEN RETURN NULL; END IF;
  IF cleaned ~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$' THEN
    RETURN cleaned::time;
  END IF;
  IF cleaned ~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})? (AM|PM)$' THEN
    mer := substring(cleaned FROM '(AM|PM)$');
    cleaned := btrim(regexp_replace(cleaned, ' (AM|PM)$', ''));
    parts := string_to_array(cleaned, ':');
    h := parts[1]::integer;
    m := parts[2]::integer;
    IF array_length(parts, 1) > 2 THEN s := parts[3]::integer; END IF;
    IF h < 1 OR h > 12 OR m > 59 OR s > 59 THEN RETURN NULL; END IF;
    IF mer = 'PM' AND h < 12 THEN h := h + 12; END IF;
    IF mer = 'AM' AND h = 12 THEN h := 0; END IF;
    RETURN make_time(h, m, s);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION booking_blocks(p_status text, p_hold timestamptz) RETURNS boolean AS $$
  SELECT p_status = 'confirmed'
    OR (p_status = 'tentative' AND p_hold IS NOT NULL AND p_hold > now());
$$ LANGUAGE sql STABLE;

-- Blocking window: setup (or start) minus travel buffer through breakdown (or end) plus travel buffer.
-- travel_buffer_minutes 0 adds nothing. A missing setup or breakdown is not invented.
CREATE OR REPLACE FUNCTION event_block_bounds(p_event_id uuid, OUT block_start timestamptz, OUT block_end timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE WHEN e.starts_at IS NULL OR e.ends_at IS NULL THEN NULL
         ELSE COALESCE(e.setup_at, e.starts_at) - (e.travel_buffer_minutes * interval '1 minute')
    END,
    CASE WHEN e.starts_at IS NULL OR e.ends_at IS NULL THEN NULL
         ELSE COALESCE(e.breakdown_at, e.ends_at) + (e.travel_buffer_minutes * interval '1 minute')
    END
  FROM events e
  WHERE e.id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION event_overlaps(p_event_id uuid, p_start timestamptz, p_end timestamptz) RETURNS boolean AS $$
  SELECT COALESCE((
    SELECT block_start IS NOT NULL AND block_end IS NOT NULL
       AND block_start < p_end AND p_start < block_end
    FROM event_block_bounds(p_event_id)
  ), false);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION lock_event_resources(p_event_id uuid) RETURNS void AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT staff_id
    FROM assignments
    WHERE event_id = p_event_id AND blocking AND status <> 'declined'
    ORDER BY staff_id
  LOOP
    PERFORM 1 FROM staff WHERE id = r.staff_id FOR UPDATE;
  END LOOP;
  FOR r IN
    SELECT DISTINCT equipment_id
    FROM equipment_reservations
    WHERE event_id = p_event_id AND blocking
    ORDER BY equipment_id
  LOOP
    PERFORM 1 FROM equipment WHERE id = r.equipment_id FOR UPDATE;
  END LOOP;
  PERFORM 1 FROM bookings WHERE event_id = p_event_id FOR UPDATE;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION raise_if_resource_overlap(p_event_id uuid) RETURNS void AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
  r record;
  used integer;
BEGIN
  SELECT block_start, block_end INTO v_start, v_end FROM event_block_bounds(p_event_id);
  IF v_start IS NULL OR v_end IS NULL OR v_start >= v_end THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM assignments a
    JOIN assignments o ON o.staff_id = a.staff_id AND o.event_id <> p_event_id
    JOIN bookings ob ON ob.event_id = o.event_id
    WHERE a.event_id = p_event_id
      AND a.blocking AND a.status <> 'declined'
      AND o.blocking AND o.status <> 'declined'
      AND booking_blocks(ob.status, ob.hold_until)
      AND event_overlaps(o.event_id, v_start, v_end)
  ) THEN
    RAISE EXCEPTION 'staff_conflict';
  END IF;
  FOR r IN
    SELECT er.equipment_id, er.quantity, eq.quantity AS available
    FROM equipment_reservations er
    JOIN equipment eq ON eq.id = er.equipment_id
    WHERE er.event_id = p_event_id AND er.blocking
  LOOP
    SELECT COALESCE(SUM(o.quantity), 0) INTO used
    FROM equipment_reservations o
    JOIN bookings ob ON ob.event_id = o.event_id
    WHERE o.equipment_id = r.equipment_id
      AND o.event_id <> p_event_id
      AND o.blocking
      AND booking_blocks(ob.status, ob.hold_until)
      AND event_overlaps(o.event_id, v_start, v_end);
    IF r.quantity > r.available OR used + r.quantity > r.available THEN
      RAISE EXCEPTION 'equipment_overbooked';
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_event_resources(p_event_id uuid, p_force boolean) RETURNS void AS $$
DECLARE
  v_status text;
  v_hold timestamptz;
BEGIN
  PERFORM lock_event_resources(p_event_id);
  SELECT status, hold_until INTO v_status, v_hold FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT p_force AND NOT booking_blocks(v_status, v_hold) THEN
    RETURN;
  END IF;
  PERFORM raise_if_resource_overlap(p_event_id);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION event_has_conflict(p_event_id uuid) RETURNS boolean AS $$
DECLARE
  v_status text;
  v_hold timestamptz;
BEGIN
  SELECT status, hold_until INTO v_status, v_hold FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND OR NOT booking_blocks(v_status, v_hold) THEN
    RETURN false;
  END IF;
  BEGIN
    PERFORM raise_if_resource_overlap(p_event_id);
    RETURN false;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE '%staff_conflict%' OR SQLERRM LIKE '%equipment_overbooked%' THEN
        RETURN true;
      END IF;
      RAISE;
  END;
END $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION assignments_guard() RETURNS trigger AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  PERFORM 1 FROM staff WHERE id = NEW.staff_id FOR UPDATE;
  PERFORM 1 FROM bookings WHERE event_id = NEW.event_id FOR UPDATE;
  IF NEW.status = 'declined' OR NOT NEW.blocking THEN
    RETURN NEW;
  END IF;
  SELECT block_start, block_end INTO v_start, v_end FROM event_block_bounds(NEW.event_id);
  IF v_start IS NULL OR v_end IS NULL OR v_start >= v_end THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM assignments o
    JOIN bookings ob ON ob.event_id = o.event_id
    WHERE o.staff_id = NEW.staff_id
      AND o.event_id <> NEW.event_id
      AND o.id IS DISTINCT FROM NEW.id
      AND o.blocking AND o.status <> 'declined'
      AND booking_blocks(ob.status, ob.hold_until)
      AND event_overlaps(o.event_id, v_start, v_end)
  ) THEN
    RAISE EXCEPTION 'staff_conflict';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER assignments_overlap
  BEFORE INSERT OR UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION assignments_guard();

CREATE OR REPLACE FUNCTION equipment_not_overbooked() RETURNS trigger AS $$
DECLARE
  available integer;
  used integer;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  PERFORM 1 FROM equipment WHERE id = NEW.equipment_id FOR UPDATE;
  PERFORM 1 FROM bookings WHERE event_id = NEW.event_id FOR UPDATE;
  SELECT quantity INTO available FROM equipment WHERE id = NEW.equipment_id;
  IF available IS NULL OR NEW.quantity > available THEN
    RAISE EXCEPTION 'equipment_overbooked';
  END IF;
  IF NOT NEW.blocking THEN
    RETURN NEW;
  END IF;
  SELECT block_start, block_end INTO v_start, v_end FROM event_block_bounds(NEW.event_id);
  IF v_start IS NULL OR v_end IS NULL OR v_start >= v_end THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(o.quantity), 0) INTO used
  FROM equipment_reservations o
  JOIN bookings ob ON ob.event_id = o.event_id
  WHERE o.equipment_id = NEW.equipment_id
    AND o.event_id <> NEW.event_id
    AND o.id IS DISTINCT FROM NEW.id
    AND o.blocking
    AND booking_blocks(ob.status, ob.hold_until)
    AND event_overlaps(o.event_id, v_start, v_end);
  IF used + NEW.quantity > available THEN
    RAISE EXCEPTION 'equipment_overbooked';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Wall-clock date and times stay as entered. Timezone changes recompute the instants.
CREATE OR REPLACE FUNCTION events_sync_window() RETURNS trigger AS $$
DECLARE
  tz text;
  start_ts timestamptz;
  end_ts timestamptz;
  start_clock time;
  end_clock time;
  end_date date;
BEGIN
  tz := COALESCE(NULLIF(btrim(NEW.timezone), ''), 'America/New_York');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) THEN
    RAISE EXCEPTION 'invalid_timezone';
  END IF;
  NEW.timezone := tz;
  IF NEW.travel_buffer_minutes IS NULL OR NEW.travel_buffer_minutes < 0 THEN
    RAISE EXCEPTION 'invalid_travel_buffer';
  END IF;
  IF NEW.setup_minutes IS NOT NULL AND NEW.setup_minutes < 0 THEN
    RAISE EXCEPTION 'invalid_setup';
  END IF;
  IF NEW.breakdown_minutes IS NOT NULL AND NEW.breakdown_minutes < 0 THEN
    RAISE EXCEPTION 'invalid_breakdown';
  END IF;
  start_clock := wall_clock(NEW.start_time);
  end_clock := wall_clock(NEW.end_time);
  IF NEW.event_date IS NOT NULL AND start_clock IS NOT NULL THEN
    start_ts := (NEW.event_date + start_clock) AT TIME ZONE tz;
  END IF;
  IF NEW.event_date IS NOT NULL AND end_clock IS NOT NULL THEN
    end_date := NEW.event_date;
    IF start_clock IS NOT NULL AND end_clock <= start_clock THEN
      end_date := NEW.event_date + 1;
    END IF;
    end_ts := (end_date + end_clock) AT TIME ZONE tz;
  END IF;
  NEW.starts_at := start_ts;
  NEW.ends_at := end_ts;
  IF start_ts IS NOT NULL AND NEW.setup_minutes IS NOT NULL THEN
    NEW.setup_at := start_ts - (NEW.setup_minutes * interval '1 minute');
  ELSE
    NEW.setup_at := NULL;
  END IF;
  IF end_ts IS NOT NULL AND NEW.breakdown_minutes IS NOT NULL THEN
    NEW.breakdown_at := end_ts + (NEW.breakdown_minutes * interval '1 minute');
  ELSE
    NEW.breakdown_at := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER events_sync_window
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION events_sync_window();

CREATE OR REPLACE FUNCTION events_recheck_resources() RETURNS trigger AS $$
BEGIN
  IF NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at
     AND NEW.ends_at IS NOT DISTINCT FROM OLD.ends_at
     AND NEW.setup_at IS NOT DISTINCT FROM OLD.setup_at
     AND NEW.breakdown_at IS NOT DISTINCT FROM OLD.breakdown_at
     AND NEW.travel_buffer_minutes IS NOT DISTINCT FROM OLD.travel_buffer_minutes THEN
    RETURN NULL;
  END IF;
  PERFORM assert_event_resources(NEW.id, false);
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER events_recheck_resources
  AFTER UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION events_recheck_resources();

CREATE OR REPLACE FUNCTION confirm_booking(p_event_id uuid, p_actor_email text, p_actor_id uuid, p_note text) RETURNS void AS $$
DECLARE
  v bookings%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  PERFORM lock_event_resources(p_event_id);
  SELECT * INTO v FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v.status = 'canceled' THEN RAISE EXCEPTION 'booking_canceled'; END IF;
  IF v.status = 'completed' THEN RAISE EXCEPTION 'booking_completed'; END IF;
  SELECT starts_at, ends_at INTO v_start, v_end FROM events WHERE id = p_event_id;
  IF v_start IS NULL OR v_end IS NULL THEN RAISE EXCEPTION 'window_required'; END IF;
  IF v.status <> 'confirmed' AND (v.hold_until IS NULL OR v.hold_until <= now()) THEN
    RAISE EXCEPTION 'hold_expired';
  END IF;
  PERFORM raise_if_resource_overlap(p_event_id);
  IF v.status = 'confirmed' THEN RETURN; END IF;
  UPDATE bookings SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, now()) WHERE id = v.id;
  PERFORM write_booking_history(v.id, p_event_id, 'confirm', v.status, 'confirmed', p_actor_email, p_actor_id, p_note);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cancel_booking(p_event_id uuid, p_actor_email text, p_actor_id uuid, p_note text) RETURNS void AS $$
DECLARE v bookings%ROWTYPE;
BEGIN
  PERFORM lock_event_resources(p_event_id);
  SELECT * INTO v FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v.status = 'canceled' THEN RETURN; END IF;
  UPDATE bookings SET status = 'canceled', hold_until = NULL WHERE id = v.id;
  UPDATE assignments SET blocking = false WHERE event_id = p_event_id AND blocking;
  UPDATE equipment_reservations SET blocking = false WHERE event_id = p_event_id AND blocking;
  PERFORM write_booking_history(v.id, p_event_id, 'cancel', v.status, 'canceled', p_actor_email, p_actor_id, p_note);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION complete_booking(p_event_id uuid, p_actor_email text, p_actor_id uuid, p_note text) RETURNS void AS $$
DECLARE v bookings%ROWTYPE;
BEGIN
  PERFORM lock_event_resources(p_event_id);
  SELECT * INTO v FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v.status = 'canceled' THEN RAISE EXCEPTION 'booking_canceled'; END IF;
  IF v.status = 'completed' THEN RETURN; END IF;
  UPDATE bookings SET status = 'completed', hold_until = NULL WHERE id = v.id;
  UPDATE assignments SET blocking = false WHERE event_id = p_event_id AND blocking;
  UPDATE equipment_reservations SET blocking = false WHERE event_id = p_event_id AND blocking;
  PERFORM write_booking_history(v.id, p_event_id, 'complete', v.status, 'completed', p_actor_email, p_actor_id, p_note);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_booking_hold(p_event_id uuid, p_hold_local text, p_actor_email text, p_actor_id uuid, p_note text) RETURNS void AS $$
DECLARE
  v bookings%ROWTYPE;
  v_tz text;
  v_hold timestamptz;
  v_raw text;
BEGIN
  PERFORM lock_event_resources(p_event_id);
  SELECT * INTO v FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v.status IN ('canceled', 'completed') THEN RAISE EXCEPTION 'booking_closed'; END IF;
  SELECT timezone INTO v_tz FROM events WHERE id = p_event_id;
  v_raw := btrim(COALESCE(p_hold_local, ''));
  IF v_raw = '' THEN
    v_hold := NULL;
  ELSIF v_raw ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' THEN
    v_hold := v_raw::timestamptz;
  ELSE
    v_hold := replace(v_raw, 'T', ' ')::timestamp AT TIME ZONE COALESCE(v_tz, 'America/New_York');
  END IF;
  UPDATE bookings SET hold_until = v_hold WHERE id = v.id;
  IF booking_blocks(v.status, v_hold) OR v.status = 'confirmed' THEN
    PERFORM raise_if_resource_overlap(p_event_id);
  END IF;
  PERFORM write_booking_history(v.id, p_event_id, 'hold', v.status, v.status, p_actor_email, p_actor_id, COALESCE(NULLIF(p_note, ''), v_raw));
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reschedule_event(
  p_event_id uuid, p_date date, p_start text, p_end text, p_timezone text,
  p_setup integer, p_breakdown integer, p_travel integer,
  p_actor_email text, p_actor_id uuid, p_note text
) RETURNS void AS $$
DECLARE
  v_status text;
  v_old_date text;
  v_old_start text;
  v_old_end text;
  v_old_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_booking uuid;
BEGIN
  SELECT b.id, b.status, e.event_date::text, e.start_time, e.end_time, e.timezone
  INTO v_booking, v_status, v_old_date, v_old_start, v_old_end, v_old_tz
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_status IN ('canceled', 'completed') THEN RAISE EXCEPTION 'booking_closed'; END IF;
  UPDATE events SET
    event_date = p_date,
    start_time = COALESCE(p_start, ''),
    end_time = COALESCE(p_end, ''),
    timezone = COALESCE(NULLIF(btrim(p_timezone), ''), timezone),
    setup_minutes = p_setup,
    breakdown_minutes = p_breakdown,
    travel_buffer_minutes = COALESCE(p_travel, 0)
  WHERE id = p_event_id;
  SELECT b.status, e.starts_at, e.ends_at INTO v_status, v_start, v_end
  FROM bookings b JOIN events e ON e.id = b.event_id
  WHERE e.id = p_event_id;
  IF v_status IN ('canceled', 'completed') THEN RAISE EXCEPTION 'booking_closed'; END IF;
  IF v_status = 'confirmed' AND (v_start IS NULL OR v_end IS NULL) THEN
    RAISE EXCEPTION 'window_required';
  END IF;
  PERFORM write_booking_history(
    v_booking, p_event_id, 'reschedule', v_status, v_status, p_actor_email, p_actor_id,
    COALESCE(NULLIF(p_note, ''), format(
      'from %s %s-%s %s to %s %s-%s %s',
      COALESCE(v_old_date, ''), COALESCE(v_old_start, ''), COALESCE(v_old_end, ''), COALESCE(v_old_tz, ''),
      COALESCE(p_date::text, ''), COALESCE(p_start, ''), COALESCE(p_end, ''), COALESCE(NULLIF(btrim(p_timezone), ''), v_old_tz)
    ))
  );
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assign_event_staff(
  p_id uuid, p_event_id uuid, p_staff_id uuid, p_role text, p_actor_email text, p_actor_id uuid
) RETURNS uuid AS $$
DECLARE
  v_booking uuid;
  v_status text;
  v_id uuid;
BEGIN
  SELECT id, status INTO v_booking, v_status FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  INSERT INTO assignments (id, event_id, staff_id, role_label, status, blocking)
  VALUES (p_id, p_event_id, p_staff_id, COALESCE(p_role, ''), 'assigned', true)
  ON CONFLICT (event_id, staff_id, role_label) DO UPDATE
    SET status = 'assigned', blocking = true
  RETURNING id INTO v_id;
  PERFORM write_booking_history(v_booking, p_event_id, 'assign', v_status, v_status, p_actor_email, p_actor_id, COALESCE(p_role, ''));
  RETURN v_id;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_event_staff(p_assignment_id uuid, p_event_id uuid, p_actor_email text, p_actor_id uuid) RETURNS void AS $$
DECLARE
  v_booking uuid;
  v_status text;
  v_role text;
BEGIN
  SELECT b.id, b.status, a.role_label INTO v_booking, v_status, v_role
  FROM bookings b
  JOIN assignments a ON a.event_id = b.event_id
  WHERE b.event_id = p_event_id AND a.id = p_assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment_not_found'; END IF;
  DELETE FROM assignments WHERE id = p_assignment_id AND event_id = p_event_id;
  PERFORM write_booking_history(v_booking, p_event_id, 'release', v_status, v_status, p_actor_email, p_actor_id, COALESCE(v_role, ''));
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reserve_event_equipment(
  p_id uuid, p_event_id uuid, p_equipment_id uuid, p_quantity integer, p_actor_email text, p_actor_id uuid
) RETURNS uuid AS $$
DECLARE
  v_booking uuid;
  v_status text;
  v_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  SELECT id, status INTO v_booking, v_status FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  INSERT INTO equipment_reservations (id, equipment_id, event_id, quantity, blocking)
  VALUES (p_id, p_equipment_id, p_event_id, p_quantity, true)
  ON CONFLICT (equipment_id, event_id) DO UPDATE
    SET quantity = EXCLUDED.quantity, blocking = true
  RETURNING id INTO v_id;
  PERFORM write_booking_history(v_booking, p_event_id, 'assign', v_status, v_status, p_actor_email, p_actor_id, p_quantity::text);
  RETURN v_id;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_event_equipment(p_reservation_id uuid, p_event_id uuid, p_actor_email text, p_actor_id uuid) RETURNS void AS $$
DECLARE
  v_booking uuid;
  v_status text;
BEGIN
  SELECT b.id, b.status INTO v_booking, v_status
  FROM bookings b
  JOIN equipment_reservations r ON r.event_id = b.event_id
  WHERE b.event_id = p_event_id AND r.id = p_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  DELETE FROM equipment_reservations WHERE id = p_reservation_id AND event_id = p_event_id;
  PERFORM write_booking_history(v_booking, p_event_id, 'release', v_status, v_status, p_actor_email, p_actor_id, '');
END $$ LANGUAGE plpgsql;

ALTER TABLE booking_history ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON booking_history FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Recompute instants for rows that already have a wall-clock time.
UPDATE events SET start_time = start_time;
