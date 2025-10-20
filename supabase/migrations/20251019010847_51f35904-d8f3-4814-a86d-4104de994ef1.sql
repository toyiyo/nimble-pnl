-- Create function to get account subtypes from enum definitions
CREATE OR REPLACE FUNCTION public.get_account_subtypes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}';
  enum_values text[];
BEGIN
  -- Get asset subtypes
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
  INTO enum_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'asset_subtype_enum';
  
  result := jsonb_set(result, '{asset}', to_jsonb(enum_values));
  
  -- Get liability subtypes
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
  INTO enum_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'liability_subtype_enum';
  
  result := jsonb_set(result, '{liability}', to_jsonb(enum_values));
  
  -- Get equity subtypes
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
  INTO enum_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'equity_subtype_enum';
  
  result := jsonb_set(result, '{equity}', to_jsonb(enum_values));
  
  -- Get revenue subtypes
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
  INTO enum_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'revenue_subtype_enum';
  
  result := jsonb_set(result, '{revenue}', to_jsonb(enum_values));
  
  -- Get expense subtypes
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
  INTO enum_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'expense_subtype_enum';
  
  result := jsonb_set(result, '{expense}', to_jsonb(enum_values));
  
  -- Get cogs subtypes
  SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
  INTO enum_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'cogs_subtype_enum';
  
  result := jsonb_set(result, '{cogs}', to_jsonb(enum_values));
  
  RETURN result;
END;
$$;