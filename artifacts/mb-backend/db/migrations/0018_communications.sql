-- Phase 06: notification dedupe keys and SMS approval flag (off by default).

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uidx
  ON notifications (topic, dedupe_key)
  WHERE dedupe_key <> '';

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS sms_enabled boolean NOT NULL DEFAULT false;
