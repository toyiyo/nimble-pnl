-- Ensure conversion helper matches POS deduction logic
BEGIN;

SELECT plan(5);

-- Direct match kg -> kg
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'KG1', 'Flour KG', 'kg', 1, 'kg', 1.00)
ON CONFLICT DO NOTHING;

SELECT is(
  public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000001', 2, 'kg'),
  2::numeric,
  'KG to KG stays 1:1'
);

-- Volume bottle: 29.5735ml fl oz into 750ml bottle => 1 fl oz ≈ 0.0394 bottles
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'VODKA', 'Vodka Bottle', 'bottle', 750, 'ml', 12.00)
ON CONFLICT DO NOTHING;

SELECT is(
  round(public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000002', 1, 'fl oz'), 4),
  round((29.5735 / 750)::numeric, 4),
  'fl oz converts to fraction of 750ml bottle'
);

-- Weight bag: 4 oz flour into 1 kg bag => 113.398/1000 = 0.1134 bags
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'FLOUR', 'Flour Bag', 'bag', 1, 'kg', 2.50)
ON CONFLICT DO NOTHING;

SELECT is(
  round(public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000003', 4, 'oz'), 4),
  round((4 * 28.3495 / 1000)::numeric, 4),
  'Weight oz converts to kg bag fraction'
);

-- Cup density: 1 cup rice into 10 kg bag => 185g/10kg = 0.0185 bags
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'RICE', 'Basmati Rice', 'bag', 10, 'kg', 20.00)
ON CONFLICT DO NOTHING;

SELECT is(
  public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000004', 1, 'cup'),
  round((185 / 10000.0)::numeric, 4),
  'Cup of rice uses density conversion'
);

-- Fallback: unknown units stay 1:1
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'MISC', 'Misc Item', 'unit', 1, 'unit', 1.00)
ON CONFLICT DO NOTHING;

SELECT is(
  public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000005', 3, 'unit'),
  3::numeric,
  'Unknown stays raw quantity'
);

SELECT * FROM finish();
ROLLBACK;
