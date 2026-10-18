-- Phase 7: MB Invites. One invitation row per event. No guest rows, no reminder
-- copy, and no marketing opt-in are inserted here.

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'invite_only',
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plus_one_cap integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rsvp_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS theme_color text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS theme_accent text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS theme_image text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS involves_minors boolean NOT NULL DEFAULT false;

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_mode_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_mode_check CHECK (mode IN ('public', 'private', 'invite_only'));
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_plus_one_cap_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_plus_one_cap_check CHECK (plus_one_cap >= 0 AND plus_one_cap <= 49);

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS checkin_code_hash text,
  ADD COLUMN IF NOT EXISTS is_minor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS guests_token_hash_uidx ON guests (token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS guests_checkin_code_hash_uidx ON guests (checkin_code_hash) WHERE checkin_code_hash IS NOT NULL;

ALTER TABLE rsvps
  ADD COLUMN IF NOT EXISTS plus_ones integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_plus_ones_check;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_plus_ones_check CHECK (plus_ones >= 0 AND plus_ones <= 49);

ALTER TABLE planner_guest_requests
  ADD COLUMN IF NOT EXISTS invite_guest_id uuid REFERENCES guests (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS planner_guest_requests_invite_guest_idx ON planner_guest_requests (invite_guest_id);

-- Guest photos use the same file table and size cap. They stay pending until a host approves them.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'stored_files' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%kind%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE stored_files DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE stored_files
  ADD CONSTRAINT stored_files_kind_check CHECK (kind IN ('contract', 'event_media', 'venue_photo', 'vendor_photo', 'guest_media'));

CREATE TABLE message_jobs (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  guest_id uuid REFERENCES guests (id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  kind text NOT NULL DEFAULT 'invite' CHECK (kind IN ('invite', 'reminder')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  to_address text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX message_jobs_due_idx ON message_jobs (status, next_attempt_at);
CREATE INDEX message_jobs_event_idx ON message_jobs (event_id, created_at DESC);

CREATE TABLE guest_media (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  file_id uuid NOT NULL UNIQUE REFERENCES stored_files (id) ON DELETE CASCADE,
  guest_id uuid REFERENCES guests (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX guest_media_event_status_idx ON guest_media (event_id, status);

ALTER TABLE message_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_media ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE message_jobs, guest_media FROM %I', r);
    END IF;
  END LOOP;
END $$;
