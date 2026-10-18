-- Phase 04: refuse completing an unconfirmed booking.
CREATE OR REPLACE FUNCTION complete_booking(p_event_id uuid, p_actor_email text, p_actor_id uuid, p_note text) RETURNS void AS $$
DECLARE v bookings%ROWTYPE;
BEGIN
  PERFORM lock_event_resources(p_event_id);
  SELECT * INTO v FROM bookings WHERE event_id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v.status = 'canceled' THEN RAISE EXCEPTION 'booking_canceled'; END IF;
  IF v.status = 'completed' THEN RETURN; END IF;
  IF v.status <> 'confirmed' THEN RAISE EXCEPTION 'booking_unconfirmed'; END IF;
  UPDATE bookings SET status = 'completed', hold_until = NULL WHERE id = v.id;
  UPDATE assignments SET blocking = false WHERE event_id = p_event_id AND blocking;
  UPDATE equipment_reservations SET blocking = false WHERE event_id = p_event_id AND blocking;
  PERFORM write_booking_history(v.id, p_event_id, 'complete', v.status, 'completed', p_actor_email, p_actor_id, p_note);
END $$ LANGUAGE plpgsql;
