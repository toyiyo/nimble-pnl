-- Create restaurant_financial_settings table for per-restaurant COGS calculation preferences
CREATE TABLE IF NOT EXISTS restaurant_financial_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  cogs_calculation_method TEXT NOT NULL DEFAULT 'inventory'
    CHECK (cogs_calculation_method IN ('inventory', 'financials', 'combined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One config per restaurant
  CONSTRAINT restaurant_financial_settings_restaurant_id_unique UNIQUE (restaurant_id)
);

-- RLS
ALTER TABLE restaurant_financial_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their restaurant financial settings" ON restaurant_financial_settings;
CREATE POLICY "Users can view their restaurant financial settings"
  ON restaurant_financial_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = restaurant_financial_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners and managers can manage financial settings" ON restaurant_financial_settings;
CREATE POLICY "Owners and managers can manage financial settings"
  ON restaurant_financial_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = restaurant_financial_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_restaurant_financial_settings_updated_at ON restaurant_financial_settings;
CREATE TRIGGER update_restaurant_financial_settings_updated_at
  BEFORE UPDATE ON restaurant_financial_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Index
CREATE INDEX IF NOT EXISTS idx_restaurant_financial_settings_restaurant_id
  ON restaurant_financial_settings(restaurant_id);
