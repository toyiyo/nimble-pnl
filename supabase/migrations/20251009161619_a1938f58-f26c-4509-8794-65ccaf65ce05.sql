-- Phase 1: Create product_suppliers junction table
CREATE TABLE product_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  -- Price tracking fields
  last_unit_cost NUMERIC,
  last_purchase_date TIMESTAMP WITH TIME ZONE,
  last_purchase_quantity NUMERIC,
  
  -- History for trend analysis
  average_unit_cost NUMERIC,
  purchase_count INTEGER DEFAULT 0,
  
  -- Supplier-specific product info
  supplier_sku TEXT,
  supplier_product_name TEXT,
  lead_time_days INTEGER,
  minimum_order_quantity NUMERIC,
  
  is_preferred BOOLEAN DEFAULT false,
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(product_id, supplier_id)
);

-- Indexes for performance
CREATE INDEX idx_product_suppliers_product ON product_suppliers(product_id);
CREATE INDEX idx_product_suppliers_supplier ON product_suppliers(supplier_id);
CREATE INDEX idx_product_suppliers_restaurant ON product_suppliers(restaurant_id);

-- Enable RLS
ALTER TABLE product_suppliers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view product suppliers for their restaurants"
  ON product_suppliers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = product_suppliers.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage product suppliers for their restaurants"
  ON product_suppliers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = product_suppliers.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'chef')
    )
  );

-- Phase 2: Add supplier_id to inventory_transactions
ALTER TABLE inventory_transactions 
ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX idx_inventory_transactions_supplier ON inventory_transactions(supplier_id);

-- Phase 3: Create upsert_product_supplier function
CREATE OR REPLACE FUNCTION upsert_product_supplier(
  p_restaurant_id UUID,
  p_product_id UUID,
  p_supplier_id UUID,
  p_unit_cost NUMERIC,
  p_quantity NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  -- Check if relationship exists
  SELECT * INTO v_existing
  FROM product_suppliers
  WHERE product_id = p_product_id 
    AND supplier_id = p_supplier_id;
  
  IF FOUND THEN
    -- Update existing relationship with new price data
    UPDATE product_suppliers
    SET 
      last_unit_cost = p_unit_cost,
      last_purchase_date = NOW(),
      last_purchase_quantity = p_quantity,
      purchase_count = purchase_count + 1,
      average_unit_cost = (
        (average_unit_cost * purchase_count + p_unit_cost) / 
        (purchase_count + 1)
      ),
      updated_at = NOW()
    WHERE product_id = p_product_id 
      AND supplier_id = p_supplier_id;
  ELSE
    -- Create new relationship
    INSERT INTO product_suppliers (
      restaurant_id,
      product_id,
      supplier_id,
      last_unit_cost,
      last_purchase_date,
      last_purchase_quantity,
      average_unit_cost,
      purchase_count,
      is_preferred
    ) VALUES (
      p_restaurant_id,
      p_product_id,
      p_supplier_id,
      p_unit_cost,
      NOW(),
      p_quantity,
      p_unit_cost,
      1,
      -- Set as preferred if it's the first supplier for this product
      NOT EXISTS (
        SELECT 1 FROM product_suppliers 
        WHERE product_id = p_product_id
      )
    );
  END IF;
END;
$$;

-- Phase 4: Migrate existing product-supplier relationships
INSERT INTO product_suppliers (
  restaurant_id,
  product_id,
  supplier_id,
  last_unit_cost,
  last_purchase_date,
  purchase_count,
  average_unit_cost,
  is_preferred
)
SELECT 
  p.restaurant_id,
  p.id as product_id,
  p.supplier_id,
  p.cost_per_unit as last_unit_cost,
  p.updated_at as last_purchase_date,
  1 as purchase_count,
  p.cost_per_unit as average_unit_cost,
  true as is_preferred
FROM products p
WHERE p.supplier_id IS NOT NULL
ON CONFLICT (product_id, supplier_id) DO NOTHING;