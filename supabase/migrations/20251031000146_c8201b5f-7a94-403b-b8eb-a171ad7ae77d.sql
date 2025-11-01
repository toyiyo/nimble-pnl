-- Add missing columns to unified_sales table for split and categorization functionality

-- Add updated_at column with trigger to auto-update
ALTER TABLE unified_sales 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Add is_split column to track split sales
ALTER TABLE unified_sales 
ADD COLUMN IF NOT EXISTS is_split BOOLEAN DEFAULT false;

-- Add parent_sale_id to link split items back to original sale
ALTER TABLE unified_sales 
ADD COLUMN IF NOT EXISTS parent_sale_id UUID REFERENCES unified_sales(id);

-- Add category_id for categorization
ALTER TABLE unified_sales 
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES chart_of_accounts(id);

-- Add is_categorized flag
ALTER TABLE unified_sales 
ADD COLUMN IF NOT EXISTS is_categorized BOOLEAN DEFAULT false;

-- Add suggested_category_id for AI suggestions
ALTER TABLE unified_sales 
ADD COLUMN IF NOT EXISTS suggested_category_id UUID REFERENCES chart_of_accounts(id);

-- Add AI confidence and reasoning fields
ALTER TABLE unified_sales 
ADD COLUMN IF NOT EXISTS ai_confidence TEXT;

ALTER TABLE unified_sales 
ADD COLUMN IF NOT EXISTS ai_reasoning TEXT;

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_unified_sales_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_unified_sales_updated_at ON unified_sales;
CREATE TRIGGER trigger_update_unified_sales_updated_at
  BEFORE UPDATE ON unified_sales
  FOR EACH ROW
  EXECUTE FUNCTION update_unified_sales_updated_at();

-- Create index on parent_sale_id for performance
CREATE INDEX IF NOT EXISTS idx_unified_sales_parent_sale_id ON unified_sales(parent_sale_id);

-- Create index on category_id for performance
CREATE INDEX IF NOT EXISTS idx_unified_sales_category_id ON unified_sales(category_id);