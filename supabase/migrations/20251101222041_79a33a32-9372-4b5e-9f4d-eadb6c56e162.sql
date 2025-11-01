-- Create reconciliation_item_finds table
CREATE TABLE IF NOT EXISTS public.reconciliation_item_finds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_item_id UUID NOT NULL REFERENCES public.reconciliation_items(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  location TEXT,
  notes TEXT,
  found_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  found_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_reconciliation_item_finds_item_id 
  ON public.reconciliation_item_finds(reconciliation_item_id);

-- Enable RLS
ALTER TABLE public.reconciliation_item_finds ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view finds for their restaurants
CREATE POLICY "Users can view finds for their restaurants" 
  ON public.reconciliation_item_finds FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM reconciliation_items ri
      JOIN inventory_reconciliations ir ON ri.reconciliation_id = ir.id
      JOIN user_restaurants ur ON ur.restaurant_id = ir.restaurant_id
      WHERE ri.id = reconciliation_item_finds.reconciliation_item_id
      AND ur.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can manage finds for their restaurants
CREATE POLICY "Users can manage finds for their restaurants" 
  ON public.reconciliation_item_finds FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM reconciliation_items ri
      JOIN inventory_reconciliations ir ON ri.reconciliation_id = ir.id
      JOIN user_restaurants ur ON ur.restaurant_id = ir.restaurant_id
      WHERE ri.id = reconciliation_item_finds.reconciliation_item_id
      AND ur.user_id = auth.uid()
    )
  );

-- Function to auto-calculate actual_quantity from finds
CREATE OR REPLACE FUNCTION calculate_actual_from_finds()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE reconciliation_items
  SET actual_quantity = (
    SELECT COALESCE(SUM(quantity), 0)
    FROM reconciliation_item_finds
    WHERE reconciliation_item_id = COALESCE(NEW.reconciliation_item_id, OLD.reconciliation_item_id)
  )
  WHERE id = COALESCE(NEW.reconciliation_item_id, OLD.reconciliation_item_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update actual_quantity when finds change
DROP TRIGGER IF EXISTS update_actual_quantity_from_finds ON reconciliation_item_finds;
CREATE TRIGGER update_actual_quantity_from_finds
  AFTER INSERT OR UPDATE OR DELETE ON reconciliation_item_finds
  FOR EACH ROW
  EXECUTE FUNCTION calculate_actual_from_finds();

-- Migrate existing data: convert existing counts to finds
INSERT INTO reconciliation_item_finds (
  reconciliation_item_id,
  quantity,
  notes,
  found_at
)
SELECT 
  id,
  actual_quantity,
  'Migrated from existing count',
  COALESCE(counted_at, created_at)
FROM reconciliation_items
WHERE actual_quantity IS NOT NULL 
  AND actual_quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM reconciliation_item_finds 
    WHERE reconciliation_item_id = reconciliation_items.id
  );