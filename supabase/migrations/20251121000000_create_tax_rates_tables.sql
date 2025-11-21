-- Create tax_rates table to store tax configurations
CREATE TABLE IF NOT EXISTS public.tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate NUMERIC(5, 2) NOT NULL CHECK (rate >= 0 AND rate <= 100), -- Percentage (0-100)
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tax_rates_name_unique UNIQUE (restaurant_id, name)
);

-- Create tax_rate_categories junction table to link tax rates with categories
CREATE TABLE IF NOT EXISTS public.tax_rate_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_rate_id UUID NOT NULL REFERENCES public.tax_rates(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tax_rate_categories_unique UNIQUE (tax_rate_id, category_id)
);

-- Enable RLS on tax_rates
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tax_rates
CREATE POLICY "Users can view tax rates for their restaurants"
ON public.tax_rates
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tax_rates.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);

CREATE POLICY "Owners and managers can manage tax rates"
ON public.tax_rates
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tax_rates.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- Enable RLS on tax_rate_categories
ALTER TABLE public.tax_rate_categories ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tax_rate_categories
CREATE POLICY "Users can view tax rate categories for their restaurants"
ON public.tax_rate_categories
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tax_rates tr
    JOIN user_restaurants ur ON tr.restaurant_id = ur.restaurant_id
    WHERE tr.id = tax_rate_categories.tax_rate_id
    AND ur.user_id = auth.uid()
  )
);

CREATE POLICY "Owners and managers can manage tax rate categories"
ON public.tax_rate_categories
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM tax_rates tr
    JOIN user_restaurants ur ON tr.restaurant_id = ur.restaurant_id
    WHERE tr.id = tax_rate_categories.tax_rate_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('owner', 'manager')
  )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tax_rates_restaurant ON public.tax_rates(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_tax_rates_active ON public.tax_rates(restaurant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tax_rate_categories_tax_rate ON public.tax_rate_categories(tax_rate_id);
CREATE INDEX IF NOT EXISTS idx_tax_rate_categories_category ON public.tax_rate_categories(category_id);

-- Create function to calculate taxes for a date range
CREATE OR REPLACE FUNCTION calculate_taxes_for_period(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  tax_rate_id UUID,
  tax_rate_name TEXT,
  tax_rate NUMERIC,
  total_taxable_amount NUMERIC,
  calculated_tax NUMERIC,
  transaction_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH tax_rate_data AS (
    -- Get all active tax rates with their categories
    SELECT 
      tr.id AS tax_rate_id,
      tr.name AS tax_rate_name,
      tr.rate,
      COALESCE(array_agg(trc.category_id) FILTER (WHERE trc.category_id IS NOT NULL), ARRAY[]::UUID[]) AS category_ids
    FROM tax_rates tr
    LEFT JOIN tax_rate_categories trc ON tr.id = trc.tax_rate_id
    WHERE tr.restaurant_id = p_restaurant_id
    AND tr.is_active = true
    GROUP BY tr.id, tr.name, tr.rate
  ),
  matching_sales AS (
    -- Match sales to tax rates based on categories
    SELECT 
      trd.tax_rate_id,
      trd.tax_rate_name,
      trd.rate,
      us.id AS sale_id,
      us.total_price
    FROM unified_sales us
    CROSS JOIN tax_rate_data trd
    WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date BETWEEN p_start_date AND p_end_date
    AND us.item_type = 'sale'
    AND (
      -- If no categories specified, apply to all sales
      cardinality(trd.category_ids) = 0
      OR
      -- Otherwise, match by category
      us.category_id = ANY(trd.category_ids)
    )
    -- Exclude parent sales that have been split
    AND NOT EXISTS (
      SELECT 1 FROM unified_sales child
      WHERE child.parent_sale_id = us.id
    )
  )
  SELECT 
    ms.tax_rate_id,
    ms.tax_rate_name,
    ms.rate AS tax_rate,
    SUM(ms.total_price) AS total_taxable_amount,
    SUM(ms.total_price * ms.rate / 100) AS calculated_tax,
    COUNT(DISTINCT ms.sale_id) AS transaction_count
  FROM matching_sales ms
  GROUP BY ms.tax_rate_id, ms.tax_rate_name, ms.rate
  ORDER BY ms.tax_rate_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION calculate_taxes_for_period(UUID, DATE, DATE) TO authenticated;

-- Create function to get tax rate details with categories
CREATE OR REPLACE FUNCTION get_tax_rate_with_categories(p_tax_rate_id UUID)
RETURNS TABLE(
  id UUID,
  restaurant_id UUID,
  name TEXT,
  rate NUMERIC,
  description TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  categories JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tr.id,
    tr.restaurant_id,
    tr.name,
    tr.rate,
    tr.description,
    tr.is_active,
    tr.created_at,
    tr.updated_at,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', coa.id,
          'account_code', coa.account_code,
          'account_name', coa.account_name,
          'account_type', coa.account_type,
          'account_subtype', coa.account_subtype
        )
      ) FILTER (WHERE coa.id IS NOT NULL),
      '[]'::jsonb
    ) AS categories
  FROM tax_rates tr
  LEFT JOIN tax_rate_categories trc ON tr.id = trc.tax_rate_id
  LEFT JOIN chart_of_accounts coa ON trc.category_id = coa.id
  WHERE tr.id = p_tax_rate_id
  GROUP BY tr.id, tr.restaurant_id, tr.name, tr.rate, tr.description, tr.is_active, tr.created_at, tr.updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION get_tax_rate_with_categories(UUID) TO authenticated;

-- Add updated_at trigger for tax_rates
CREATE OR REPLACE FUNCTION update_tax_rates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tax_rates_updated_at
BEFORE UPDATE ON public.tax_rates
FOR EACH ROW
EXECUTE FUNCTION update_tax_rates_updated_at();
