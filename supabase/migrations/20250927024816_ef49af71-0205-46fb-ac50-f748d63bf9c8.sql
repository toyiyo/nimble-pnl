-- Create restaurant inventory settings table
CREATE TABLE public.restaurant_inventory_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  default_markup_multiplier NUMERIC NOT NULL DEFAULT 2.5,
  markup_by_category JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);

-- Enable RLS
ALTER TABLE public.restaurant_inventory_settings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Restaurant owners and managers can manage inventory settings"
ON public.restaurant_inventory_settings
FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.user_restaurants
  WHERE restaurant_id = restaurant_inventory_settings.restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
));

-- Create trigger for updated_at
CREATE TRIGGER update_restaurant_inventory_settings_updated_at
BEFORE UPDATE ON public.restaurant_inventory_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();