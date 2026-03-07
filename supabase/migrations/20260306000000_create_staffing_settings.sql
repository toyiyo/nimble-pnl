-- Create staffing_settings table for per-restaurant staffing suggestion parameters
CREATE TABLE IF NOT EXISTS staffing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  target_splh NUMERIC NOT NULL DEFAULT 60.00,
  avg_ticket_size NUMERIC NOT NULL DEFAULT 8.00,
  target_labor_pct NUMERIC NOT NULL DEFAULT 22.0,
  min_staff INTEGER NOT NULL DEFAULT 1,
  lookback_weeks INTEGER NOT NULL DEFAULT 4,
  manual_projections JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One config per restaurant
  CONSTRAINT staffing_settings_restaurant_id_unique UNIQUE (restaurant_id)
);

-- RLS
ALTER TABLE staffing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their restaurant staffing settings" ON staffing_settings;
CREATE POLICY "Users can view their restaurant staffing settings"
  ON staffing_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = staffing_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners and managers can manage staffing settings" ON staffing_settings;
CREATE POLICY "Owners and managers can manage staffing settings"
  ON staffing_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = staffing_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_staffing_settings_updated_at ON staffing_settings;
CREATE TRIGGER update_staffing_settings_updated_at
  BEFORE UPDATE ON staffing_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Index
CREATE INDEX IF NOT EXISTS idx_staffing_settings_restaurant_id
  ON staffing_settings(restaurant_id);
