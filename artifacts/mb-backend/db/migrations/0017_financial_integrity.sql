-- Phase 05: structured payment kinds, one active deposit per event, contract immutability, reconcile runs.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'other';

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('deposit', 'balance', 'other'));

UPDATE payments
SET kind = 'deposit'
WHERE kind = 'other' AND (schedule_key LIKE 'deposit:%' OR schedule_key = 'deposit');

-- One active deposit obligation per event (due or paid). Voided deposits do not block a replacement.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_deposit_uidx
  ON payments (event_id)
  WHERE kind = 'deposit' AND status IN ('due', 'paid');

CREATE TABLE IF NOT EXISTS finance_reconcile_runs (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  report jsonb NOT NULL,
  dry_run boolean NOT NULL DEFAULT true,
  approved_at timestamptz,
  approved_by text NOT NULL DEFAULT '',
  applied_at timestamptz,
  actor_email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_reconcile_runs_event_idx ON finance_reconcile_runs (event_id, created_at DESC);

ALTER TABLE finance_reconcile_runs ENABLE ROW LEVEL SECURITY;

-- Signed contracts stay signed; body and signature fields are immutable after signing.
CREATE OR REPLACE FUNCTION contracts_keep_signed() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'signed' AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.signed_name IS DISTINCT FROM OLD.signed_name
    OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
    OR NEW.signed_ip IS DISTINCT FROM OLD.signed_ip
    OR NEW.file_id IS DISTINCT FROM OLD.file_id
    OR NEW.title IS DISTINCT FROM OLD.title
  ) THEN
    RAISE EXCEPTION 'signed_contract_immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contracts_keep_signed ON contracts;
CREATE TRIGGER contracts_keep_signed BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION contracts_keep_signed();
