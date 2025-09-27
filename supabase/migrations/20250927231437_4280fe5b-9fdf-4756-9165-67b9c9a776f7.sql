-- Enable required extensions for advanced fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Add searchable_text column (not generated, updated via trigger)
ALTER TABLE products ADD COLUMN IF NOT EXISTS searchable_text text;

-- Function to update searchable text
CREATE OR REPLACE FUNCTION update_product_searchable_text()
RETURNS TRIGGER AS $$
BEGIN
  NEW.searchable_text := lower(regexp_replace(
    unaccent(
      coalesce(NEW.name,'') || ' ' || 
      coalesce(NEW.brand,'') || ' ' || 
      coalesce(NEW.category,'') || ' ' ||
      coalesce(NEW.supplier_name,'') || ' ' ||
      array_to_string(coalesce(NEW.receipt_item_names, '{}'), ' ')
    ),
    '[^a-z0-9 ]','','g'
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger to automatically update searchable_text
DROP TRIGGER IF EXISTS update_products_searchable_text ON products;
CREATE TRIGGER update_products_searchable_text
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_product_searchable_text();

-- Update existing records
UPDATE products SET updated_at = updated_at; -- This will trigger the searchable_text update

-- Create trigram index for fast fuzzy searching
CREATE INDEX IF NOT EXISTS idx_products_trgm 
ON products USING gin (searchable_text gin_trgm_ops);

-- Create additional indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_searchable_text 
ON products (searchable_text);