-- Phase 8. Staff enter venues, partners, and automation templates.
-- This file inserts none of those rows and does not opt anyone into marketing.

ALTER TABLE venues
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN amenities text NOT NULL DEFAULT '',
  ADD COLUMN service_area text NOT NULL DEFAULT '',
  ADD COLUMN published boolean NOT NULL DEFAULT false,
  ADD COLUMN mb_production boolean NOT NULL DEFAULT false;
CREATE INDEX venues_published_idx ON venues (name) WHERE published = true AND active = true;

ALTER TABLE vendors
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN area text NOT NULL DEFAULT '',
  ADD COLUMN relationship_notes text NOT NULL DEFAULT '',
  ADD COLUMN published boolean NOT NULL DEFAULT false,
  ADD COLUMN verified boolean NOT NULL DEFAULT false;
CREATE INDEX vendors_published_idx ON vendors (name) WHERE published = true AND active = true;

-- Null means the customer has not answered. False is an opt-out. Nothing here sets the flag true.
ALTER TABLE customers
  ADD COLUMN marketing_opt_in boolean,
  ADD COLUMN unsubscribe_token text;
CREATE UNIQUE INDEX customers_unsubscribe_token_uidx ON customers (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;

ALTER TABLE leads
  ADD COLUMN venue_id uuid REFERENCES venues (id) ON DELETE SET NULL,
  ADD COLUMN vendor_id uuid REFERENCES vendors (id) ON DELETE SET NULL,
  ADD COLUMN referred_by text;
CREATE INDEX leads_venue_idx ON leads (venue_id);
CREATE INDEX leads_vendor_idx ON leads (vendor_id);

ALTER TABLE events ADD COLUMN referred_by text;

-- Venue and partner photos use the existing file table. notes stay off the public payload.
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
  ADD COLUMN venue_id uuid REFERENCES venues (id) ON DELETE CASCADE,
  ADD COLUMN vendor_id uuid REFERENCES vendors (id) ON DELETE CASCADE,
  ADD CONSTRAINT stored_files_kind_check CHECK (kind IN ('contract', 'event_media', 'venue_photo', 'vendor_photo'));
CREATE INDEX stored_files_venue_idx ON stored_files (venue_id);
CREATE INDEX stored_files_vendor_idx ON stored_files (vendor_id);

-- A client or staff member attaches a partner to one event. Relationship notes are not copied here.
CREATE TABLE event_vendors (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors (id) ON DELETE SET NULL,
  source_key text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX event_vendors_vendor_uidx ON event_vendors (event_id, vendor_id) WHERE vendor_id IS NOT NULL;
CREATE UNIQUE INDEX event_vendors_source_uidx ON event_vendors (event_id, source_key) WHERE source_key <> '';
CREATE INDEX event_vendors_event_idx ON event_vendors (event_id);
CREATE TRIGGER event_vendors_updated BEFORE UPDATE ON event_vendors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Staff write the kind, channel, delay, and copy. No template rows are inserted.
CREATE TABLE automation_templates (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN (
    'inquiry_confirmation', 'sales_follow_up', 'consultation_reminder', 'proposal_follow_up',
    'deposit_reminder', 'planning_deadline', 'rsvp_reminder', 'event_preparation',
    'thank_you', 'review_request', 'referral'
  )),
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0 AND delay_minutes <= 527040),
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_templates_kind_idx ON automation_templates (kind);
CREATE TRIGGER automation_templates_updated BEFORE UPDATE ON automation_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE event_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_templates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE event_vendors, automation_templates FROM %I', r);
    END IF;
  END LOOP;
END $$;
