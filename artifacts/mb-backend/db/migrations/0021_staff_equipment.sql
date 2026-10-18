-- Phase 10: technician role + optional equipment check-out timestamp.
-- Reservation overlap and inventory checks stay in the calendar/operations engine.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_profile_type_check') THEN
    ALTER TABLE staff DROP CONSTRAINT staff_profile_type_check;
  END IF;
  ALTER TABLE staff ADD CONSTRAINT staff_profile_type_check
    CHECK (profile_type IN ('dj', 'mc', 'dancer', 'coordinator', 'technician', 'other'));
END $$;

ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS checked_out_at timestamptz;
