-- Phase 4 sales and booking finance.
-- No prices, tax rates, deposit percents, venues, partners, or accounts are inserted.
-- Planner JSON payments are not copied here.

ALTER TABLE package_services ADD COLUMN optional boolean NOT NULL DEFAULT false;

CREATE TABLE pricing_rules (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('overtime', 'travel', 'setup', 'discount', 'adjustment', 'tax', 'deposit')),
  label text NOT NULL,
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  percent numeric(8, 4) CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_cents IS NOT NULL OR percent IS NOT NULL)
);
CREATE INDEX pricing_rules_kind_idx ON pricing_rules (kind) WHERE active = true;
CREATE TRIGGER pricing_rules_updated BEFORE UPDATE ON pricing_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE proposal_versions (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES proposals (id) ON DELETE CASCADE,
  number integer NOT NULL CHECK (number > 0),
  kind text NOT NULL DEFAULT 'quote' CHECK (kind IN ('quote', 'change')),
  snapshot jsonb NOT NULL,
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, number)
);
CREATE INDEX proposal_versions_proposal_idx ON proposal_versions (proposal_id, number DESC);

CREATE UNIQUE INDEX contracts_event_uidx ON contracts (event_id);

ALTER TABLE payments ADD COLUMN schedule_key text NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN provider_intent text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX payments_schedule_key_uidx ON payments (event_id, schedule_key) WHERE schedule_key <> '';

-- A succeeded payment keeps its amount. Refunds are separate rows.
CREATE OR REPLACE FUNCTION payments_keep_paid() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'paid' AND (
    NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.provider_ref IS DISTINCT FROM OLD.provider_ref
  ) THEN
    RAISE EXCEPTION 'paid_payment_immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER payments_keep_paid BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_keep_paid();

CREATE TABLE payment_adjustments (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  payment_id uuid REFERENCES payments (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('refund', 'cancellation')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  note text NOT NULL DEFAULT '',
  actor_email text NOT NULL DEFAULT '',
  provider_ref text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_adjustments_event_idx ON payment_adjustments (event_id);
CREATE INDEX payment_adjustments_payment_idx ON payment_adjustments (payment_id);

CREATE OR REPLACE FUNCTION payment_adjustments_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment_adjustments_append_only';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_adjustments_no_change
  BEFORE UPDATE OR DELETE ON payment_adjustments
  FOR EACH ROW EXECUTE FUNCTION payment_adjustments_append_only();

CREATE TABLE receipts (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  provider_ref text NOT NULL DEFAULT '',
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  emailed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX receipts_payment_provider_uidx ON receipts (payment_id, provider_ref);

-- Event id only. The payload is not stored.
CREATE TABLE stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE pricing_rules, proposal_versions, payment_adjustments, receipts, stripe_events FROM %I', r);
    END IF;
  END LOOP;
END $$;
