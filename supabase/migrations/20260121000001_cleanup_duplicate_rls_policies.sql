-- ============================================================================
-- Migration: Cleanup Duplicate RLS Policies
--
-- Removes duplicate/old policies that were not properly cleaned up when
-- capability-based policies were introduced. This ensures each table has
-- exactly the policies expected by the tests.
-- ============================================================================

-- ============================================================================
-- RECIPES TABLE - Keep 4 policies
-- ============================================================================

DROP POLICY IF EXISTS "Users can create recipes for their restaurants" ON public.recipes;

-- ============================================================================
-- BANK_TRANSACTIONS TABLE - Keep 5 policies (including Deny anonymous access)
-- ============================================================================

-- Drop the old ALL policy that allowed too much access
DROP POLICY IF EXISTS "Owners and managers can manage transactions" ON public.bank_transactions;

-- Fix the deny anonymous access policy name (was "Deny anonymous access to bank_transactions")
DROP POLICY IF EXISTS "Deny anonymous access to bank_transactions" ON public.bank_transactions;
CREATE POLICY "Deny anonymous access"
ON public.bank_transactions
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

-- ============================================================================
-- INVENTORY_TRANSACTIONS TABLE - Keep 3 policies with underscore naming
-- ============================================================================

-- Drop policies with space naming (incorrect)
DROP POLICY IF EXISTS "Users can view inventory transactions for their restaurants" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Users can insert inventory transactions for their restaurants" ON public.inventory_transactions;

-- Ensure we have the correctly named policies
DROP POLICY IF EXISTS "Users can view inventory_transactions for their restaurants" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Users can insert inventory_transactions for their restaurants" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Users can update inventory_transactions for their restaurants" ON public.inventory_transactions;

CREATE POLICY "Users can view inventory_transactions for their restaurants"
ON public.inventory_transactions
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:inventory'));

CREATE POLICY "Users can insert inventory_transactions for their restaurants"
ON public.inventory_transactions
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:inventory'));

CREATE POLICY "Users can update inventory_transactions for their restaurants"
ON public.inventory_transactions
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:inventory'));

-- ============================================================================
-- INVOICES TABLE - Keep 5 policies (4 CRUD + anon denial)
-- ============================================================================

-- Drop extra policies (but keep the anon denial for security)
DROP POLICY IF EXISTS "Users can delete draft invoices for their restaurants" ON public.invoices;

-- ============================================================================
-- CUSTOMERS TABLE - Keep 5 policies (4 CRUD + anon denial)
-- ============================================================================

-- No extra policies to drop - keep the anon denial for security

-- ============================================================================
-- PENDING_OUTFLOWS TABLE - Keep 4 policies with underscore naming
-- ============================================================================

-- Drop policies with space naming (old style)
DROP POLICY IF EXISTS "Users can view pending outflows for their restaurants" ON public.pending_outflows;
DROP POLICY IF EXISTS "Users can insert pending outflows for their restaurants" ON public.pending_outflows;
DROP POLICY IF EXISTS "Users can update pending outflows for their restaurants" ON public.pending_outflows;
DROP POLICY IF EXISTS "Users can delete pending outflows for their restaurants" ON public.pending_outflows;

-- ============================================================================
-- PURCHASE_ORDERS TABLE - Keep 5 policies (4 CRUD + anon denial)
-- ============================================================================

-- Drop policies with space naming (old style) but keep the anon denial for security
DROP POLICY IF EXISTS "Users can view purchase orders for their restaurants" ON public.purchase_orders;
DROP POLICY IF EXISTS "Users can create purchase orders for their restaurants" ON public.purchase_orders;
DROP POLICY IF EXISTS "Users can update purchase orders for their restaurants" ON public.purchase_orders;
DROP POLICY IF EXISTS "Users can delete purchase orders for their restaurants" ON public.purchase_orders;

-- ============================================================================
-- PREP_RECIPES TABLE - Keep 4 policies with new naming convention
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "View prep recipes for restaurant" ON public.prep_recipes;
DROP POLICY IF EXISTS "Create prep recipes for restaurant" ON public.prep_recipes;
DROP POLICY IF EXISTS "Update prep recipes for restaurant" ON public.prep_recipes;
DROP POLICY IF EXISTS "Delete prep recipes for restaurant" ON public.prep_recipes;

-- ============================================================================
-- PRODUCTION_RUNS TABLE - Keep 3 policies with new naming convention
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "View production runs for restaurant" ON public.production_runs;
DROP POLICY IF EXISTS "Create production runs for restaurant" ON public.production_runs;
DROP POLICY IF EXISTS "Update production runs for restaurant" ON public.production_runs;
DROP POLICY IF EXISTS "Delete production runs for restaurant" ON public.production_runs;

-- ============================================================================
-- EMPLOYEES TABLE - Keep 3 policies (2 CRUD + anon denial)
-- ============================================================================

-- Drop extra policies but keep anon denial for security
DROP POLICY IF EXISTS "Users can create employees for their restaurants" ON public.employees;
DROP POLICY IF EXISTS "Users can update employees for their restaurants" ON public.employees;
DROP POLICY IF EXISTS "Users can delete employees for their restaurants" ON public.employees;

-- ============================================================================
-- CHART_OF_ACCOUNTS TABLE - Keep 5 policies (4 CRUD + anon denial)
-- ============================================================================

-- Drop extra policies but keep anon denial for security
DROP POLICY IF EXISTS "Users can view chart of accounts for their restaurants" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Owners and managers can delete accounts" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Owners and managers can insert accounts" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Owners and managers can update accounts" ON public.chart_of_accounts;
