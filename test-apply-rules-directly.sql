-- Quick test: manually call apply_rules_to_pos_sales to see what happens
-- Run this in Supabase SQL Editor

SELECT * FROM apply_rules_to_pos_sales(
  'b80c60f4-76f9-49e6-9e63-7594d708d31a'::UUID,
  5  -- Just test with 5 sales first
);

-- Check Postgres logs after running this to see any RAISE NOTICE messages
