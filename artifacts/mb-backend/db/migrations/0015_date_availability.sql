-- Phase 03: one active hold or confirmed booking per business calendar date.
-- Leads and tentative bookings without a live hold do not reserve the date.
-- Staff and equipment overlap checks stay in place beside this rule.

-- Serialize hold/confirm/reschedule attempts for the same calendar date.
CREATE OR REPLACE FUNCTION lock_event_date(p_date date) RETURNS void AS $$
BEGIN
  IF p_date IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(872341, hashtext(p_date::text));
END $$ LANGUAGE plpgsql;

-- True when another booking already reserves the date (confirmed, or tentative with a future hold).
CREATE OR REPLACE FUNCTION date_is_blocked(p_date date, p_exclude uuid DEFAULT NULL) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM events e
    JOIN bookings b ON b.event_id = e.id
    WHERE e.event_date = p_date
      AND (p_exclude IS NULL OR e.id <> p_exclude)
      AND booking_blocks(b.status, b.hold_until)
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION raise_if_date_taken(p_event_id uuid, p_date date DEFAULT NULL) RETURNS void AS $$
DECLARE
  v_date date;
BEGIN
  v_date := COALESCE(p_date, (SELECT event_date FROM events WHERE id = p_event_id));
  IF v_date IS NULL THEN RETURN; END IF;
  PERFORM lock_event_date(v_date);
  IF date_is_blocked(v_date, p_event_id) THEN
    RAISE EXCEPTION 'date_taken';
  END IF;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_booking_hold(p_event_id uuid, p_hold_local text, p_actor_email text, p_actor_id uuid, p_note text) RETURNS void AS $$
DECLARE
  v bookings%ROWTYPE;
  v_tz text;
  v_hold timestamptz;
  v_raw text;
  v_date date;
BEGIN
  PERFORM lock_event_resources(p_event_id);
  SELECT * INTO v FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v.status IN ('canceled', 'completed') THEN RAISE EXCEPTION 'booking_closed'; END IF;
  SELECT timezone, event_date INTO v_tz, v_date FROM events WHERE id = p_event_id;
  PERFORM lock_event_date(v_date);
  v_raw := btrim(COALESCE(p_hold_local, ''));
  IF v_raw = '' THEN
    v_hold := NULL;
  ELSIF v_raw ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' THEN
    v_hold := v_raw::timestamptz;
  ELSE
    v_hold := replace(v_raw, 'T', ' ')::timestamp AT TIME ZONE COALESCE(v_tz, 'America/New_York');
  END IF;
  IF booking_blocks(v.status, v_hold) OR v.status = 'confirmed' THEN
    PERFORM raise_if_date_taken(p_event_id, v_date);
  END IF;
  UPDATE bookings SET hold_until = v_hold WHERE id = v.id;
  IF booking_blocks(v.status, v_hold) OR v.status = 'confirmed' THEN
    PERFORM raise_if_resource_overlap(p_event_id);
  END IF;
  PERFORM write_booking_history(v.id, p_event_id, 'hold', v.status, v.status, p_actor_email, p_actor_id, COALESCE(NULLIF(p_note, ''), v_raw));
END $$ LANGUAGE plpgsql;

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
  PERFORM raise_if_date_taken(p_event_id);
  PERFORM raise_if_resource_overlap(p_event_id);
  IF v.status = 'confirmed' THEN RETURN; END IF;
  UPDATE bookings SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, now()) WHERE id = v.id;
  PERFORM write_booking_history(v.id, p_event_id, 'confirm', v.status, 'confirmed', p_actor_email, p_actor_id, p_note);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reschedule_event(
  p_event_id uuid, p_date date, p_start text, p_end text, p_timezone text,
  p_setup integer, p_breakdown integer, p_travel integer,
  p_actor_email text, p_actor_id uuid, p_note text
) RETURNS void AS $$
DECLARE
  v_status text;
  v_hold timestamptz;
  v_old_date text;
  v_old_start text;
  v_old_end text;
  v_old_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_booking uuid;
BEGIN
  SELECT b.id, b.status, b.hold_until, e.event_date::text, e.start_time, e.end_time, e.timezone
  INTO v_booking, v_status, v_hold, v_old_date, v_old_start, v_old_end, v_old_tz
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_status IN ('canceled', 'completed') THEN RAISE EXCEPTION 'booking_closed'; END IF;
  PERFORM lock_event_date(p_date);
  IF booking_blocks(v_status, v_hold) THEN
    PERFORM raise_if_date_taken(p_event_id, p_date);
  END IF;
  UPDATE events SET
    event_date = p_date,
    start_time = COALESCE(p_start, ''),
    end_time = COALESCE(p_end, ''),
    timezone = COALESCE(NULLIF(btrim(p_timezone), ''), timezone),
    setup_minutes = p_setup,
    breakdown_minutes = p_breakdown,
    travel_buffer_minutes = COALESCE(p_travel, 0)
  WHERE id = p_event_id;
  SELECT b.status, b.hold_until, e.starts_at, e.ends_at INTO v_status, v_hold, v_start, v_end
  FROM bookings b JOIN events e ON e.id = b.event_id
  WHERE e.id = p_event_id;
  IF v_status IN ('canceled', 'completed') THEN RAISE EXCEPTION 'booking_closed'; END IF;
  IF v_status = 'confirmed' AND (v_start IS NULL OR v_end IS NULL) THEN
    RAISE EXCEPTION 'window_required';
  END IF;
  IF booking_blocks(v_status, v_hold) THEN
    PERFORM raise_if_date_taken(p_event_id);
    PERFORM raise_if_resource_overlap(p_event_id);
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

-- Confirmed company policy: one active event per calendar date.
UPDATE business_settings
SET one_event_per_date = true
WHERE id = 'default' AND btrim(timezone) <> '';

ALTER TABLE business_settings ALTER COLUMN one_event_per_date SET DEFAULT true;
