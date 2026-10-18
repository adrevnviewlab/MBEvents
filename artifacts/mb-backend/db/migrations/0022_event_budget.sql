-- Phase 11: estimated vs actual event costs. amount_cents stays the actual recorded spend.
-- No seeded amounts. Profit still requires at least one event_costs row.

ALTER TABLE event_costs ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';
ALTER TABLE event_costs ADD COLUMN IF NOT EXISTS estimated_cents integer;
ALTER TABLE event_costs ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'manual';
ALTER TABLE event_costs ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES assignments (id) ON DELETE SET NULL;
ALTER TABLE event_costs ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendors (id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_costs_category_check') THEN
    ALTER TABLE event_costs ADD CONSTRAINT event_costs_category_check
      CHECK (category IN ('staff', 'vendor', 'equipment', 'venue', 'travel', 'supplies', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_costs_estimated_cents_check') THEN
    ALTER TABLE event_costs ADD CONSTRAINT event_costs_estimated_cents_check
      CHECK (estimated_cents IS NULL OR estimated_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_costs_source_kind_check') THEN
    ALTER TABLE event_costs ADD CONSTRAINT event_costs_source_kind_check
      CHECK (source_kind IN ('manual', 'staff_payout', 'vendor'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_costs_assignment_idx ON event_costs (assignment_id) WHERE assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_costs_vendor_idx ON event_costs (vendor_id) WHERE vendor_id IS NOT NULL;
