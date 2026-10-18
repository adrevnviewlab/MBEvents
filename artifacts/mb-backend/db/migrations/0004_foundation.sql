-- Phase 1 foundation.
-- Customers and events are created once and linked. Planner JSON stays the working
-- planning document for an event; it is not copied into payments, contracts, or guests.
-- Package and service prices are nullable on purpose: no rate is invented here.
-- Existing office logins become role "coordinator" so they keep lead and planner access.
-- The limited "staff" role is for people who should not open office tools.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Identity -----------------------------------------------------------------

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' in email) > 1),
  name text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'sales', 'coordinator', 'staff', 'client', 'guest')),
  password_hash text,
  mfa_secret text,
  mfa_pending text,
  mfa_enabled boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_role_idx ON users (role);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mfa_challenges (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX mfa_challenges_expires_idx ON mfa_challenges (expires_at);

CREATE TABLE mfa_recovery_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id);

CREATE TABLE password_resets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);

ALTER TABLE admin_users ADD COLUMN user_id uuid UNIQUE REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE admin_sessions ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE admin_sessions ADD COLUMN mfa_verified boolean NOT NULL DEFAULT true;
ALTER TABLE admin_audit ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE admin_audit ADD COLUMN entity text NOT NULL DEFAULT '';
ALTER TABLE admin_audit ADD COLUMN ip text NOT NULL DEFAULT '';
CREATE INDEX admin_audit_entity_created_idx ON admin_audit (entity, created_at DESC);

INSERT INTO users (id, email, name, role, password_hash, created_at, updated_at)
SELECT gen_random_uuid(), email, name, 'coordinator', password_hash, created_at, now()
FROM admin_users;

UPDATE admin_users AS account
SET user_id = person.id
FROM users AS person
WHERE person.email = account.email;

-- People and occasions -----------------------------------------------------

CREATE TABLE customers (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email = '' OR (email = lower(email) AND position('@' in email) > 1))
);
CREATE UNIQUE INDEX customers_email_uidx ON customers (email) WHERE email <> '';
CREATE INDEX customers_phone_idx ON customers (phone) WHERE phone <> '';
CREATE TRIGGER customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE leads ADD COLUMN customer_id uuid REFERENCES customers (id) ON DELETE SET NULL;
CREATE INDEX leads_customer_idx ON leads (customer_id);

INSERT INTO customers (id, name, email, phone, created_at, updated_at)
SELECT gen_random_uuid(),
       (array_agg(name ORDER BY created_at DESC))[1],
       lower(email),
       COALESCE((array_agg(NULLIF(phone, '') ORDER BY created_at DESC))[1], ''),
       min(created_at),
       now()
FROM leads
WHERE btrim(email) <> ''
GROUP BY lower(email);

UPDATE leads AS inquiry
SET customer_id = person.id
FROM customers AS person
WHERE btrim(inquiry.email) <> '' AND lower(inquiry.email) = person.email;

INSERT INTO customers (id, name, email, phone, created_at, updated_at)
SELECT id, name, '', phone, created_at, now()
FROM leads
WHERE btrim(email) = '' AND customer_id IS NULL;

UPDATE leads SET customer_id = id WHERE btrim(email) = '' AND customer_id IS NULL;

CREATE TABLE venues (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  area text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  capacity text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venues_name_idx ON venues (name);
CREATE TRIGGER venues_updated BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE events (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads (id) ON DELETE SET NULL,
  venue_id uuid REFERENCES venues (id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  event_type text NOT NULL DEFAULT '',
  event_date date,
  start_time text NOT NULL DEFAULT '',
  end_time text NOT NULL DEFAULT '',
  guest_count text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('inquiry', 'planning', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_customer_idx ON events (customer_id);
CREATE INDEX events_date_idx ON events (event_date);
CREATE INDEX events_status_date_idx ON events (status, event_date);
CREATE INDEX events_lead_idx ON events (lead_id);
CREATE INDEX events_venue_idx ON events (venue_id);
CREATE TRIGGER events_updated BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One reservation per occasion. This is the booking, not a second copy of the event.
CREATE TABLE bookings (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE REFERENCES events (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'hold', 'confirmed', 'cancelled')),
  hold_until timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_status_idx ON bookings (status);
CREATE TRIGGER bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO customers (id, name, email, phone, created_at, updated_at)
SELECT gen_random_uuid(),
       COALESCE(NULLIF((array_agg(planner.data->'details'->>'clientNames'))[1], ''), 'Client'),
       lower(planner.data->'details'->>'email'),
       COALESCE((array_agg(NULLIF(planner.data->'details'->>'phone', '')))[1], ''),
       min(planner.created_at),
       now()
FROM planner_events AS planner
WHERE COALESCE(planner.data->'details'->>'email', '') LIKE '%@%'
  AND NOT EXISTS (
    SELECT 1 FROM customers AS person WHERE person.email = lower(planner.data->'details'->>'email')
  )
GROUP BY lower(planner.data->'details'->>'email');

INSERT INTO events (id, customer_id, lead_id, name, event_type, event_date, start_time, end_time, guest_count, status, created_at, updated_at)
SELECT planner.id,
       COALESCE(inquiry.customer_id, person.id),
       planner.lead_id,
       COALESCE(NULLIF(planner.data->'details'->>'clientNames', ''), 'Event'),
       COALESCE(planner.data->'details'->>'eventType', ''),
       CASE WHEN planner.data->'details'->>'eventDate' ~ '^\d{4}-\d{2}-\d{2}$'
            THEN (planner.data->'details'->>'eventDate')::date ELSE NULL END,
       COALESCE(planner.data->'details'->>'startTime', ''),
       COALESCE(planner.data->'details'->>'endTime', ''),
       COALESCE(planner.data->'details'->>'guestCount', ''),
       'planning',
       planner.created_at,
       planner.updated_at
FROM planner_events AS planner
LEFT JOIN leads AS inquiry ON inquiry.id = planner.lead_id
LEFT JOIN customers AS person ON person.email <> '' AND person.email = lower(COALESCE(planner.data->'details'->>'email', ''));

INSERT INTO bookings (id, event_id, status, created_at, updated_at)
SELECT gen_random_uuid(), id, 'pending', created_at, updated_at FROM events;

ALTER TABLE planner_events ADD COLUMN event_id uuid UNIQUE REFERENCES events (id) ON DELETE CASCADE;
UPDATE planner_events SET event_id = id;
ALTER TABLE planner_events ALTER COLUMN event_id SET NOT NULL;
CREATE INDEX planner_events_event_idx ON planner_events (event_id);

-- Office people who can be scheduled. Auth role stays on users.
CREATE TABLE staff (
  id uuid PRIMARY KEY,
  user_id uuid UNIQUE REFERENCES users (id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  job_title text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_active_idx ON staff (active);
CREATE TRIGGER staff_updated BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO staff (id, user_id, name, email, created_at, updated_at)
SELECT id, id, name, email, created_at, updated_at
FROM users
WHERE role IN ('admin', 'manager', 'sales', 'coordinator', 'staff');

CREATE TABLE vendors (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  preferred boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendors_category_idx ON vendors (category);
CREATE TRIGGER vendors_updated BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Catalogs. price_cents stays null until MB Events enters an approved amount.
CREATE TABLE services (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER services_updated BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE packages (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER packages_updated BEFORE UPDATE ON packages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE package_services (
  package_id uuid NOT NULL REFERENCES packages (id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (package_id, service_id)
);

CREATE TABLE proposals (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  package_id uuid REFERENCES packages (id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposals_event_idx ON proposals (event_id);
CREATE TRIGGER proposals_updated BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE proposal_items (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES proposals (id) ON DELETE CASCADE,
  service_id uuid REFERENCES services (id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_amount_cents integer CHECK (unit_amount_cents IS NULL OR unit_amount_cents >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposal_items_proposal_idx ON proposal_items (proposal_id);

CREATE TABLE stored_files (
  id uuid PRIMARY KEY,
  event_id uuid REFERENCES events (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('contract', 'event_media')),
  filename text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  byte_size integer NOT NULL CHECK (byte_size >= 0 AND byte_size <= 20000000),
  checksum_sha256 text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stored_files_event_idx ON stored_files (event_id);
CREATE INDEX stored_files_kind_idx ON stored_files (kind);

CREATE TABLE contracts (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES proposals (id) ON DELETE SET NULL,
  file_id uuid REFERENCES stored_files (id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'void')),
  body text NOT NULL DEFAULT '',
  signed_name text NOT NULL DEFAULT '',
  signed_at timestamptz,
  signed_ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contracts_event_idx ON contracts (event_id);
CREATE TRIGGER contracts_updated BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payments (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings (id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT '',
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  due_on date,
  status text NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'void')),
  method text NOT NULL DEFAULT '',
  provider_ref text NOT NULL DEFAULT '',
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_event_status_idx ON payments (event_id, status);
CREATE UNIQUE INDEX payments_provider_ref_uidx ON payments (provider_ref) WHERE provider_ref <> '';
CREATE TRIGGER payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE REFERENCES events (id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER invitations_updated BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE guests (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  party_size integer NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 50),
  table_label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guests_event_idx ON guests (event_id);
CREATE TRIGGER guests_updated BEFORE UPDATE ON guests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE rsvps (
  id uuid PRIMARY KEY,
  guest_id uuid NOT NULL UNIQUE REFERENCES guests (id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL REFERENCES invitations (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'yes', 'no')),
  note text NOT NULL DEFAULT '',
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rsvps_invitation_idx ON rsvps (invitation_id);
CREATE TRIGGER rsvps_updated BEFORE UPDATE ON rsvps FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION rsvps_match_event() RETURNS trigger AS $$
DECLARE guest_event uuid; invite_event uuid;
BEGIN
  SELECT event_id INTO guest_event FROM guests WHERE id = NEW.guest_id;
  SELECT event_id INTO invite_event FROM invitations WHERE id = NEW.invitation_id;
  IF guest_event IS NULL OR invite_event IS NULL OR guest_event <> invite_event THEN
    RAISE EXCEPTION 'rsvp_event_mismatch';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER rsvps_event_match BEFORE INSERT OR UPDATE ON rsvps FOR EACH ROW EXECUTE FUNCTION rsvps_match_event();

CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  event_id uuid REFERENCES events (id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES staff (id) ON DELETE SET NULL,
  title text NOT NULL,
  due_on date,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_event_idx ON tasks (event_id);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id);
CREATE TRIGGER tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE equipment (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER equipment_updated BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE equipment_reservations (
  id uuid PRIMARY KEY,
  equipment_id uuid NOT NULL REFERENCES equipment (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (equipment_id, event_id)
);
CREATE INDEX equipment_reservations_event_idx ON equipment_reservations (event_id);

CREATE OR REPLACE FUNCTION equipment_not_overbooked() RETURNS trigger AS $$
DECLARE available integer; used integer;
BEGIN
  SELECT quantity INTO available FROM equipment WHERE id = NEW.equipment_id;
  SELECT COALESCE(SUM(quantity), 0) INTO used
  FROM equipment_reservations
  WHERE equipment_id = NEW.equipment_id AND id <> NEW.id;
  IF available IS NULL OR used + NEW.quantity > available THEN
    RAISE EXCEPTION 'equipment_overbooked';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER equipment_quantity_check BEFORE INSERT OR UPDATE ON equipment_reservations FOR EACH ROW EXECUTE FUNCTION equipment_not_overbooked();

CREATE TABLE assignments (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  role_label text NOT NULL DEFAULT '',
  call_time text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'confirmed', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, staff_id, role_label)
);
CREATE INDEX assignments_staff_idx ON assignments (staff_id);
CREATE TRIGGER assignments_updated BEFORE UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  event_id uuid REFERENCES events (id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'in_app')),
  topic text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'read')),
  provider_ref text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_status_idx ON notifications (status, created_at DESC);

CREATE VIEW audit_logs AS
SELECT id, created_at, actor_email, user_id, action, entity, subject_id, ip, before_value, after_value
FROM admin_audit;

-- Supabase API roles stay locked out of every new table. The app uses the owner role.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;
