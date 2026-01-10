-- SECURITY FIX: Verify and document RLS + GRANT strategy
-- 
-- CONTEXT: Supabase uses a two-layer security model:
-- 1. GRANT statements give table-level permissions to roles (authenticated, anon, service_role)
-- 2. RLS policies enforce row-level access control
--
-- This migration verifies that all sensitive tables have RLS enabled.
-- If RLS is enabled, GRANT statements are safe because policies control access.
-- If RLS were disabled, GRANT statements would allow unrestricted access.

DO $$
DECLARE
  v_table_name text;
  v_rls_enabled boolean;
  v_missing_rls text[] := ARRAY[]::text[];
BEGIN
  -- List of critical tables that MUST have RLS enabled
  FOR v_table_name IN 
    SELECT unnest(ARRAY[
      'employees',
      'profiles', 
      'customers',
      'bank_transactions',
      'employee_compensation_history',
      'time_punches',
      'purchase_orders',
      'purchase_order_lines',
      'square_connections',
      'connected_banks',
      'bank_account_balances',
      'chart_of_accounts',
      'journal_entries',
      'unified_sales',
      'invoices',
      'shifts',
      'time_off_requests',
      'employee_tips'
    ])
  LOOP
    -- Check if RLS is enabled for this table
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE c.relname = v_table_name
    AND n.nspname = 'public';
    
    -- If table exists and RLS is not enabled, add to missing list
    IF FOUND AND (v_rls_enabled IS NULL OR v_rls_enabled = false) THEN
      v_missing_rls := array_append(v_missing_rls, v_table_name);
      RAISE WARNING 'SECURITY ISSUE: Table % does not have RLS enabled!', v_table_name;
    END IF;
  END LOOP;
  
  -- If any tables are missing RLS, raise an exception
  IF array_length(v_missing_rls, 1) > 0 THEN
    RAISE EXCEPTION 'SECURITY CRITICAL: The following tables do not have RLS enabled: %', 
      array_to_string(v_missing_rls, ', ');
  END IF;
  
  RAISE NOTICE 'RLS verification passed: All critical tables have RLS enabled';
END $$;

-- Add comments documenting the security model
COMMENT ON TABLE public.employees IS 
  'RLS enforced: Users can only access employees for restaurants they belong to. Table GRANT to authenticated is safe because RLS policies control access.';

COMMENT ON TABLE public.customers IS 
  'RLS enforced: Users can only access customers for restaurants they belong to. Table GRANT to authenticated is safe because RLS policies control access.';

COMMENT ON TABLE public.bank_transactions IS 
  'RLS enforced: Only owners/managers can access transactions for their restaurants. Table GRANT to authenticated is safe because RLS policies control access.';

COMMENT ON TABLE public.employee_compensation_history IS 
  'RLS enforced: Users can only view compensation for employees in restaurants they belong to. Table GRANT to authenticated is safe because RLS policies control access.';

COMMENT ON TABLE public.time_punches IS 
  'RLS enforced: Employees see own punches, managers see all restaurant punches. Table GRANT to authenticated is safe because RLS policies control access.';

COMMENT ON TABLE public.purchase_orders IS 
  'RLS enforced: Users can only access purchase orders for restaurants they belong to. Table GRANT to authenticated is safe because RLS policies control access.';

COMMENT ON TABLE public.square_connections IS 
  'RLS enforced: Only owners/managers can access POS connections for their restaurants. Table GRANT to authenticated is safe because RLS policies control access.';

-- Verify no policies use USING (true) without proper role restrictions
DO $$
DECLARE
  v_policy record;
  v_risky_policies int := 0;
BEGIN
  -- Find policies with USING (true) that apply to 'authenticated' or 'public' roles
  FOR v_policy IN
    SELECT 
      schemaname,
      tablename,
      policyname,
      roles,
      cmd,
      qual
    FROM pg_policies
    WHERE schemaname = 'public'
    AND qual = 'true'
    AND (
      roles::text[] @> ARRAY['public']::text[]
      OR roles::text[] @> ARRAY['authenticated']::text[]
    )
    AND tablename IN (
      'employees', 'customers', 'bank_transactions', 'time_punches',
      'employee_compensation_history', 'purchase_orders', 'square_connections',
      'unified_sales', 'invoices', 'profiles'
    )
  LOOP
    -- Skip policies intended for specific secure purposes
    IF v_policy.policyname NOT LIKE '%service_role%' 
       AND v_policy.policyname NOT LIKE '%Service role%'
       AND v_policy.tablename NOT IN ('unit_conversions', 'po_number_counters')
    THEN
      v_risky_policies := v_risky_policies + 1;
      RAISE WARNING 'POTENTIAL SECURITY ISSUE: Policy %.% on table % uses USING (true) for roles %',
        v_policy.schemaname, v_policy.policyname, v_policy.tablename, v_policy.roles;
    END IF;
  END LOOP;
  
  IF v_risky_policies > 0 THEN
    RAISE EXCEPTION 'Found % potentially risky policies with USING (true) - please review',
      v_risky_policies;
  END IF;
  
  RAISE NOTICE 'Policy verification passed: No risky USING (true) policies found on critical tables';
END $$;
