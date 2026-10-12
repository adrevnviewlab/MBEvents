-- Hard size limits on planner documents (the app also checks each write).
ALTER TABLE planner_events
  ADD CONSTRAINT planner_events_size_check
  CHECK (octet_length(data::text) < 1000000 AND octet_length(admin_data::text) < 1500000);

-- Bind admin sessions to the credential they were issued for, so changing the owner's
-- MB_ADMIN_PASSWORD (or resetting a staff password) ends existing sessions.
ALTER TABLE admin_sessions ADD COLUMN credential text NOT NULL DEFAULT '';

-- Supports pruning of stale rate-limit counters.
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);
