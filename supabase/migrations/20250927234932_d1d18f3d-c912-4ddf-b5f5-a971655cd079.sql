-- Fix the searchable text trigger - the unaccent function might be causing issues
CREATE OR REPLACE FUNCTION public.update_product_searchable_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Create searchable text with proper text processing
  NEW.searchable_text := lower(regexp_replace(
    coalesce(NEW.name,'') || ' ' || 
    coalesce(NEW.brand,'') || ' ' || 
    coalesce(NEW.category,'') || ' ' ||
    coalesce(NEW.supplier_name,'') || ' ' ||
    array_to_string(coalesce(NEW.receipt_item_names, '{}'), ' '),
    '[^a-zA-Z0-9 ]','','g'
  ));
  RETURN NEW;
END;
$function$