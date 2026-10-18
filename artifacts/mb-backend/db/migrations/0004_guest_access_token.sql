-- Revocable guest song-request links. Existing rows are left untouched;
-- the app fills a token the next time a host or admin opens the planner.
ALTER TABLE planner_events ADD COLUMN IF NOT EXISTS guest_access_token text;

CREATE UNIQUE INDEX IF NOT EXISTS planner_events_guest_token_idx
  ON planner_events (guest_access_token)
  WHERE guest_access_token IS NOT NULL;
