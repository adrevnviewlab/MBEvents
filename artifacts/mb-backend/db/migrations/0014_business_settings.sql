-- Phase 02 business configuration.
-- No package prices, deposit percents, or hold lengths are inserted.

CREATE TABLE business_settings (
  id text PRIMARY KEY CHECK (id = 'default'),
  company_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  contact_address text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT '',
  one_event_per_date boolean NOT NULL DEFAULT false,
  require_owner_confirm boolean NOT NULL DEFAULT true,
  require_staff_before_confirm boolean NOT NULL DEFAULT false,
  deposit_due_days integer CHECK (deposit_due_days IS NULL OR deposit_due_days >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT '',
  CHECK (NOT one_event_per_date OR btrim(timezone) <> '')
);

INSERT INTO business_settings (id) VALUES ('default');

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS price_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS price_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON TABLE business_settings FROM %I', r);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;
