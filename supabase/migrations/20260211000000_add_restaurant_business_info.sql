-- Add structured business info columns to restaurants table
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS zip TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS business_email TEXT,
  ADD COLUMN IF NOT EXISTS ein TEXT,
  ADD COLUMN IF NOT EXISTS entity_type TEXT;

-- Add constraint for entity_type
ALTER TABLE restaurants
  ADD CONSTRAINT chk_entity_type CHECK (
    entity_type IS NULL OR entity_type IN ('llc', 'corporation', 'sole_proprietor', 'partnership', 's_corporation', 'non_profit')
  );

-- Add constraint for state (2-char when provided)
ALTER TABLE restaurants
  ADD CONSTRAINT chk_state_length CHECK (
    state IS NULL OR char_length(state) = 2
  );
