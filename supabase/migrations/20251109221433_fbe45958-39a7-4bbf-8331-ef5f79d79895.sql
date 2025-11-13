-- Create table for storing CSV column mapping templates
-- This allows users to save and reuse column mappings for their restaurant

CREATE TABLE IF NOT EXISTS public.csv_mapping_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  csv_headers TEXT[] NOT NULL,
  column_mappings JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Ensure unique template names per restaurant
  UNIQUE(restaurant_id, template_name)
);

-- Add RLS policies
ALTER TABLE public.csv_mapping_templates ENABLE ROW LEVEL SECURITY;

-- Users can view templates for their restaurants
CREATE POLICY "Users can view mapping templates for their restaurants"
  ON public.csv_mapping_templates
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = csv_mapping_templates.restaurant_id
        AND ur.user_id = auth.uid()
    )
  );

-- Users can insert templates for their restaurants
CREATE POLICY "Users can insert mapping templates for their restaurants"
  ON public.csv_mapping_templates
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = csv_mapping_templates.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

-- Users can update templates for their restaurants
CREATE POLICY "Users can update mapping templates for their restaurants"
  ON public.csv_mapping_templates
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = csv_mapping_templates.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

-- Users can delete templates for their restaurants
CREATE POLICY "Users can delete mapping templates for their restaurants"
  ON public.csv_mapping_templates
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.restaurant_id = csv_mapping_templates.restaurant_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_csv_mapping_templates_restaurant 
  ON public.csv_mapping_templates(restaurant_id);

-- Add comment
COMMENT ON TABLE public.csv_mapping_templates IS 
'Stores saved CSV column mapping templates for restaurants, allowing users to reuse mappings for files with the same structure';