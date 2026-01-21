-- ============================================================================
-- Migration: Update RLS Policies for Collaborator Access
--
-- Updates existing policies to use capability-based access functions
-- for proper collaborator permission enforcement.
--
-- Key changes:
-- - Accountant can access financial tables (bank_transactions, invoices, etc.)
-- - Inventory helper can access products and inventory tables
-- - Chef collaborator can access recipes and view inventory
-- - All collaborators are isolated from team data
-- ============================================================================

-- ============================================================================
-- PRODUCTS TABLE
-- Collaborator access: collaborator_inventory (edit), collaborator_chef (view-only)
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view products for their restaurants" ON public.products;
DROP POLICY IF EXISTS "Users can insert products for their restaurants" ON public.products;
DROP POLICY IF EXISTS "Users can update products for their restaurants" ON public.products;
DROP POLICY IF EXISTS "Users can delete products for their restaurants" ON public.products;

-- Recreate with capability-based access
CREATE POLICY "Users can view products for their restaurants"
ON public.products
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:inventory'));

CREATE POLICY "Users can insert products for their restaurants"
ON public.products
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:inventory'));

CREATE POLICY "Users can update products for their restaurants"
ON public.products
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:inventory'));

CREATE POLICY "Users can delete products for their restaurants"
ON public.products
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager']));

-- ============================================================================
-- INVENTORY_TRANSACTIONS TABLE
-- Collaborator access: collaborator_inventory only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view inventory transactions for their restaurants" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Users can insert inventory transactions for their restaurants" ON public.inventory_transactions;

CREATE POLICY "Users can view inventory transactions for their restaurants"
ON public.inventory_transactions
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:inventory'));

CREATE POLICY "Users can insert inventory transactions for their restaurants"
ON public.inventory_transactions
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:inventory'));

-- ============================================================================
-- RECIPES TABLE
-- Collaborator access: collaborator_chef only
-- ============================================================================

-- First check if policies exist (they might be in a different migration)
DROP POLICY IF EXISTS "Users can view recipes for their restaurants" ON public.recipes;
DROP POLICY IF EXISTS "Users can insert recipes for their restaurants" ON public.recipes;
DROP POLICY IF EXISTS "Users can update recipes for their restaurants" ON public.recipes;
DROP POLICY IF EXISTS "Users can delete recipes for their restaurants" ON public.recipes;

CREATE POLICY "Users can view recipes for their restaurants"
ON public.recipes
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:recipes'));

CREATE POLICY "Users can insert recipes for their restaurants"
ON public.recipes
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:recipes'));

CREATE POLICY "Users can update recipes for their restaurants"
ON public.recipes
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:recipes'));

CREATE POLICY "Users can delete recipes for their restaurants"
ON public.recipes
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager', 'chef']));

-- ============================================================================
-- RECIPE_INGREDIENTS TABLE
-- Collaborator access: collaborator_chef only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view recipe ingredients for their restaurants" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "Users can insert recipe ingredients for their restaurants" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "Users can update recipe ingredients for their restaurants" ON public.recipe_ingredients;
DROP POLICY IF EXISTS "Users can delete recipe ingredients for their restaurants" ON public.recipe_ingredients;

CREATE POLICY "Users can view recipe ingredients for their restaurants"
ON public.recipe_ingredients
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM recipes r
    WHERE r.id = recipe_ingredients.recipe_id
    AND user_has_capability(r.restaurant_id, 'view:recipes')
  )
);

CREATE POLICY "Users can insert recipe ingredients for their restaurants"
ON public.recipe_ingredients
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM recipes r
    WHERE r.id = recipe_ingredients.recipe_id
    AND user_has_capability(r.restaurant_id, 'edit:recipes')
  )
);

CREATE POLICY "Users can update recipe ingredients for their restaurants"
ON public.recipe_ingredients
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM recipes r
    WHERE r.id = recipe_ingredients.recipe_id
    AND user_has_capability(r.restaurant_id, 'edit:recipes')
  )
);

CREATE POLICY "Users can delete recipe ingredients for their restaurants"
ON public.recipe_ingredients
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM recipes r
    WHERE r.id = recipe_ingredients.recipe_id
    AND user_has_role(r.restaurant_id, ARRAY['owner', 'manager', 'chef'])
  )
);

-- ============================================================================
-- BANK_TRANSACTIONS TABLE
-- Collaborator access: collaborator_accountant only
-- ============================================================================

-- Drop existing authenticated policies (not the anon denial policy)
DROP POLICY IF EXISTS "Users can view transactions for their restaurants" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can insert transactions for their restaurants" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can update transactions for their restaurants" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can delete transactions for their restaurants" ON public.bank_transactions;
DROP POLICY IF EXISTS "Owners and managers can insert transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Owners and managers can update transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Owners and managers can delete transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users with edit capability can manage transactions" ON public.bank_transactions;

CREATE POLICY "Users can view transactions for their restaurants"
ON public.bank_transactions
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:transactions'));

CREATE POLICY "Users can insert transactions for their restaurants"
ON public.bank_transactions
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:transactions'));

CREATE POLICY "Users can update transactions for their restaurants"
ON public.bank_transactions
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:transactions'));

CREATE POLICY "Users can delete transactions for their restaurants"
ON public.bank_transactions
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager']));

-- ============================================================================
-- pending_outflows TABLE
-- Collaborator access: collaborator_accountant only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view pending_outflows for their restaurants" ON public.pending_outflows;
DROP POLICY IF EXISTS "Users can insert pending_outflows for their restaurants" ON public.pending_outflows;
DROP POLICY IF EXISTS "Users can update pending_outflows for their restaurants" ON public.pending_outflows;
DROP POLICY IF EXISTS "Users can delete pending_outflows for their restaurants" ON public.pending_outflows;

CREATE POLICY "Users can view pending_outflows for their restaurants"
ON public.pending_outflows
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:pending_outflows'));

CREATE POLICY "Users can insert pending_outflows for their restaurants"
ON public.pending_outflows
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:pending_outflows'));

CREATE POLICY "Users can update pending_outflows for their restaurants"
ON public.pending_outflows
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:pending_outflows'));

CREATE POLICY "Users can delete pending_outflows for their restaurants"
ON public.pending_outflows
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager']));

-- ============================================================================
-- INVOICES TABLE
-- Collaborator access: collaborator_accountant only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view invoices for their restaurants" ON public.invoices;
DROP POLICY IF EXISTS "Users can insert invoices for their restaurants" ON public.invoices;
DROP POLICY IF EXISTS "Users can update invoices for their restaurants" ON public.invoices;
DROP POLICY IF EXISTS "Users can delete invoices for their restaurants" ON public.invoices;

CREATE POLICY "Users can view invoices for their restaurants"
ON public.invoices
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:invoices'));

CREATE POLICY "Users can insert invoices for their restaurants"
ON public.invoices
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:invoices'));

CREATE POLICY "Users can update invoices for their restaurants"
ON public.invoices
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:invoices'));

CREATE POLICY "Users can delete invoices for their restaurants"
ON public.invoices
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager']));

-- ============================================================================
-- CUSTOMERS TABLE
-- Collaborator access: collaborator_accountant only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view customers for their restaurants" ON public.customers;
DROP POLICY IF EXISTS "Users can insert customers for their restaurants" ON public.customers;
DROP POLICY IF EXISTS "Users can update customers for their restaurants" ON public.customers;
DROP POLICY IF EXISTS "Users can delete customers for their restaurants" ON public.customers;

CREATE POLICY "Users can view customers for their restaurants"
ON public.customers
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:customers'));

CREATE POLICY "Users can insert customers for their restaurants"
ON public.customers
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:customers'));

CREATE POLICY "Users can update customers for their restaurants"
ON public.customers
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:customers'));

CREATE POLICY "Users can delete customers for their restaurants"
ON public.customers
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager']));

-- ============================================================================
-- CHART_OF_ACCOUNTS TABLE
-- Collaborator access: collaborator_accountant only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view chart_of_accounts for their restaurants" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Users can insert chart_of_accounts for their restaurants" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Users can update chart_of_accounts for their restaurants" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Users can delete chart_of_accounts for their restaurants" ON public.chart_of_accounts;

CREATE POLICY "Users can view chart_of_accounts for their restaurants"
ON public.chart_of_accounts
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:chart_of_accounts'));

CREATE POLICY "Users can insert chart_of_accounts for their restaurants"
ON public.chart_of_accounts
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:chart_of_accounts'));

CREATE POLICY "Users can update chart_of_accounts for their restaurants"
ON public.chart_of_accounts
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:chart_of_accounts'));

CREATE POLICY "Users can delete chart_of_accounts for their restaurants"
ON public.chart_of_accounts
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner']));

-- ============================================================================
-- JOURNAL_ENTRIES TABLE
-- Collaborator access: collaborator_accountant only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view journal_entries for their restaurants" ON public.journal_entries;
DROP POLICY IF EXISTS "Users can insert journal_entries for their restaurants" ON public.journal_entries;
DROP POLICY IF EXISTS "Users can update journal_entries for their restaurants" ON public.journal_entries;
DROP POLICY IF EXISTS "Users can delete journal_entries for their restaurants" ON public.journal_entries;

CREATE POLICY "Users can view journal_entries for their restaurants"
ON public.journal_entries
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:transactions'));

CREATE POLICY "Users can insert journal_entries for their restaurants"
ON public.journal_entries
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:transactions'));

CREATE POLICY "Users can update journal_entries for their restaurants"
ON public.journal_entries
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:transactions'));

CREATE POLICY "Users can delete journal_entries for their restaurants"
ON public.journal_entries
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager']));

-- ============================================================================
-- PURCHASE_ORDERS TABLE
-- Collaborator access: collaborator_inventory only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view purchase_orders for their restaurants" ON public.purchase_orders;
DROP POLICY IF EXISTS "Users can insert purchase_orders for their restaurants" ON public.purchase_orders;
DROP POLICY IF EXISTS "Users can update purchase_orders for their restaurants" ON public.purchase_orders;
DROP POLICY IF EXISTS "Users can delete purchase_orders for their restaurants" ON public.purchase_orders;

CREATE POLICY "Users can view purchase_orders for their restaurants"
ON public.purchase_orders
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:purchase_orders'));

CREATE POLICY "Users can insert purchase_orders for their restaurants"
ON public.purchase_orders
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:purchase_orders'));

CREATE POLICY "Users can update purchase_orders for their restaurants"
ON public.purchase_orders
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:purchase_orders'));

CREATE POLICY "Users can delete purchase_orders for their restaurants"
ON public.purchase_orders
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager']));

-- ============================================================================
-- PREP_RECIPES and PREP_RECIPE_INGREDIENTS TABLES
-- Collaborator access: collaborator_chef only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view prep_recipes for their restaurants" ON public.prep_recipes;
DROP POLICY IF EXISTS "Users can insert prep_recipes for their restaurants" ON public.prep_recipes;
DROP POLICY IF EXISTS "Users can update prep_recipes for their restaurants" ON public.prep_recipes;
DROP POLICY IF EXISTS "Users can delete prep_recipes for their restaurants" ON public.prep_recipes;

CREATE POLICY "Users can view prep_recipes for their restaurants"
ON public.prep_recipes
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:prep_recipes'));

CREATE POLICY "Users can insert prep_recipes for their restaurants"
ON public.prep_recipes
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:prep_recipes'));

CREATE POLICY "Users can update prep_recipes for their restaurants"
ON public.prep_recipes
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:prep_recipes'));

CREATE POLICY "Users can delete prep_recipes for their restaurants"
ON public.prep_recipes
FOR DELETE
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager', 'chef']));

-- ============================================================================
-- production_runs TABLE
-- Collaborator access: collaborator_chef only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view production_runs for their restaurants" ON public.production_runs;
DROP POLICY IF EXISTS "Users can insert production_runs for their restaurants" ON public.production_runs;
DROP POLICY IF EXISTS "Users can update production_runs for their restaurants" ON public.production_runs;

CREATE POLICY "Users can view production_runs for their restaurants"
ON public.production_runs
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:batches'));

CREATE POLICY "Users can insert production_runs for their restaurants"
ON public.production_runs
FOR INSERT
WITH CHECK (user_has_capability(restaurant_id, 'edit:batches'));

CREATE POLICY "Users can update production_runs for their restaurants"
ON public.production_runs
FOR UPDATE
USING (user_has_capability(restaurant_id, 'edit:batches'));

-- ============================================================================
-- EMPLOYEES TABLE
-- Collaborator access: collaborator_accountant can view (for payroll context)
-- ============================================================================

DROP POLICY IF EXISTS "Users can view employees for their restaurants" ON public.employees;
DROP POLICY IF EXISTS "Owners and managers can manage employees" ON public.employees;

CREATE POLICY "Users can view employees for their restaurants"
ON public.employees
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:employees'));

-- Keep management restricted to owner/manager (no collaborator can manage employees)
CREATE POLICY "Owners and managers can manage employees"
ON public.employees
FOR ALL
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager']))
WITH CHECK (user_has_role(restaurant_id, ARRAY['owner', 'manager']));

-- ============================================================================
-- FINANCIAL_STATEMENT_CACHE TABLE
-- Collaborator access: collaborator_accountant only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view financial_statement_cache for their restaurants" ON public.financial_statement_cache;

CREATE POLICY "Users can view financial_statement_cache for their restaurants"
ON public.financial_statement_cache
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:financial_statements'));

-- ============================================================================
-- CONNECTED_BANKS TABLE
-- Collaborator access: collaborator_accountant (view only)
-- ============================================================================

DROP POLICY IF EXISTS "Users can view connected_banks for their restaurants" ON public.connected_banks;

CREATE POLICY "Users can view connected_banks for their restaurants"
ON public.connected_banks
FOR SELECT
USING (user_has_capability(restaurant_id, 'view:banking'));

-- Management restricted to owner/manager
DROP POLICY IF EXISTS "Owners and managers can manage connected_banks" ON public.connected_banks;
CREATE POLICY "Owners and managers can manage connected_banks"
ON public.connected_banks
FOR ALL
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager']))
WITH CHECK (user_has_role(restaurant_id, ARRAY['owner', 'manager']));

-- ============================================================================
-- BANK_ACCOUNT_BALANCES TABLE
-- Collaborator access: collaborator_accountant only
-- ============================================================================

DROP POLICY IF EXISTS "Users can view bank_account_balances for their restaurants" ON public.bank_account_balances;

CREATE POLICY "Users can view bank_account_balances for their restaurants"
ON public.bank_account_balances
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM connected_banks cb
    WHERE cb.id = bank_account_balances.connected_bank_id
    AND user_has_capability(cb.restaurant_id, 'view:banking')
  )
);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON POLICY "Users can view products for their restaurants" ON public.products IS
'Capability-based access: requires view:inventory capability. Allows collaborator_inventory and collaborator_chef.';

COMMENT ON POLICY "Users can view transactions for their restaurants" ON public.bank_transactions IS
'Capability-based access: requires view:transactions capability. Allows collaborator_accountant.';

COMMENT ON POLICY "Users can view recipes for their restaurants" ON public.recipes IS
'Capability-based access: requires view:recipes capability. Allows collaborator_chef.';
