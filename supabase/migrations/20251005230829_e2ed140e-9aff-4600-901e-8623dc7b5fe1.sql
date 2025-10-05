-- Fix trigger function to check auto-deduction settings and pass external_order_id
CREATE OR REPLACE FUNCTION public.trigger_automatic_inventory_deduction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_auto_deduction_enabled boolean;
BEGIN
  -- Check if auto-deduction is enabled for this restaurant
  SELECT enabled INTO v_auto_deduction_enabled
  FROM auto_deduction_settings
  WHERE restaurant_id = NEW.restaurant_id;
  
  -- If setting doesn't exist or is disabled, skip deduction
  IF v_auto_deduction_enabled IS NULL OR v_auto_deduction_enabled = false THEN
    RETURN NEW;
  END IF;
  
  -- Process inventory deduction for the new sale with external_order_id
  PERFORM public.process_unified_inventory_deduction(
    NEW.restaurant_id,
    NEW.item_name,
    NEW.quantity::integer,
    NEW.sale_date::text,
    NEW.external_order_id  -- Now passing the external_order_id
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't fail the INSERT
  RAISE WARNING 'Auto-deduction failed for sale %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;