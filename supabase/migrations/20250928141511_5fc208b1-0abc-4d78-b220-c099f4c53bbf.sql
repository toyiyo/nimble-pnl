-- Create trigger function for automatic inventory deduction
CREATE OR REPLACE FUNCTION public.trigger_automatic_inventory_deduction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  -- Process inventory deduction for the new sale
  PERFORM public.process_unified_inventory_deduction(
    NEW.restaurant_id,
    NEW.item_name,
    NEW.quantity::integer,
    NEW.sale_date::text
  );
  
  RETURN NEW;
END;
$function$;

-- Create trigger on unified_sales table
CREATE TRIGGER automatic_inventory_deduction_trigger
  AFTER INSERT ON public.unified_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_automatic_inventory_deduction();

-- Enable automatic deduction by default for existing restaurants
-- (Users can disable this in the AutoDeductionSettings component)
CREATE TABLE IF NOT EXISTS public.auto_deduction_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);

-- Enable RLS on auto_deduction_settings
ALTER TABLE public.auto_deduction_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for auto_deduction_settings
CREATE POLICY "Restaurant owners and managers can manage auto deduction settings"
ON public.auto_deduction_settings
FOR ALL
USING (EXISTS (
  SELECT 1 FROM user_restaurants
  WHERE user_restaurants.restaurant_id = auto_deduction_settings.restaurant_id
  AND user_restaurants.user_id = auth.uid()
  AND user_restaurants.role IN ('owner', 'manager')
));

-- Insert default settings for existing restaurants
INSERT INTO public.auto_deduction_settings (restaurant_id, enabled)
SELECT id, true
FROM public.restaurants
ON CONFLICT (restaurant_id) DO NOTHING;