-- ============================================================================
-- Tests for Collaborator RLS Policies
--
-- Tests the RLS policies introduced for capability-based access control:
-- - products table policies
-- - recipes table policies
-- - bank_transactions table policies
-- - inventory_transactions table policies
-- - pending_outflows table policies
-- - invoices table policies
-- - customers table policies
-- - employees table policies
-- ============================================================================

BEGIN;
SELECT plan(32);

-- ============================================================================
-- Test: Products table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'products',
    ARRAY[
        'Users can view products for their restaurants',
        'Users can insert products for their restaurants',
        'Users can update products for their restaurants',
        'Users can delete products for their restaurants'
    ],
    'products table should have all expected policies'
);

SELECT policy_cmd_is(
    'public',
    'products',
    'Users can view products for their restaurants',
    'select',
    'products view policy should be SELECT'
);

SELECT policy_cmd_is(
    'public',
    'products',
    'Users can insert products for their restaurants',
    'insert',
    'products insert policy should be INSERT'
);

SELECT policy_cmd_is(
    'public',
    'products',
    'Users can update products for their restaurants',
    'update',
    'products update policy should be UPDATE'
);

SELECT policy_cmd_is(
    'public',
    'products',
    'Users can delete products for their restaurants',
    'delete',
    'products delete policy should be DELETE'
);

-- ============================================================================
-- Test: Recipes table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'recipes',
    ARRAY[
        'Users can view recipes for their restaurants',
        'Users can insert recipes for their restaurants',
        'Users can update recipes for their restaurants',
        'Users can delete recipes for their restaurants'
    ],
    'recipes table should have all expected policies'
);

SELECT policy_cmd_is(
    'public',
    'recipes',
    'Users can view recipes for their restaurants',
    'select',
    'recipes view policy should be SELECT'
);

SELECT policy_cmd_is(
    'public',
    'recipes',
    'Users can delete recipes for their restaurants',
    'delete',
    'recipes delete policy should be DELETE - restricted to owner/manager/chef'
);

-- ============================================================================
-- Test: Bank_transactions table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'bank_transactions',
    ARRAY[
        'Users can view transactions for their restaurants',
        'Users can insert transactions for their restaurants',
        'Users can update transactions for their restaurants',
        'Users can delete transactions for their restaurants',
        'Deny anonymous access'
    ],
    'bank_transactions table should have all expected policies'
);

SELECT policy_cmd_is(
    'public',
    'bank_transactions',
    'Users can view transactions for their restaurants',
    'select',
    'bank_transactions view policy should be SELECT'
);

SELECT policy_cmd_is(
    'public',
    'bank_transactions',
    'Users can delete transactions for their restaurants',
    'delete',
    'bank_transactions delete policy should be DELETE - restricted to owner/manager'
);

-- ============================================================================
-- Test: Inventory_transactions table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'inventory_transactions',
    ARRAY[
        'Users can view inventory_transactions for their restaurants',
        'Users can insert inventory_transactions for their restaurants',
        'Users can update inventory_transactions for their restaurants'
    ],
    'inventory_transactions table should have all expected policies'
);

SELECT policy_cmd_is(
    'public',
    'inventory_transactions',
    'Users can view inventory_transactions for their restaurants',
    'select',
    'inventory_transactions view policy should be SELECT'
);

-- ============================================================================
-- Test: Invoices table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'invoices',
    ARRAY[
        'Deny anonymous access to invoices',
        'Users can view invoices for their restaurants',
        'Users can insert invoices for their restaurants',
        'Users can update invoices for their restaurants',
        'Users can delete invoices for their restaurants'
    ],
    'invoices table should have all expected policies'
);

SELECT policy_cmd_is(
    'public',
    'invoices',
    'Users can view invoices for their restaurants',
    'select',
    'invoices view policy should be SELECT'
);

SELECT policy_cmd_is(
    'public',
    'invoices',
    'Users can delete invoices for their restaurants',
    'delete',
    'invoices delete policy should be DELETE - restricted to owner/manager'
);

-- ============================================================================
-- Test: Customers table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'customers',
    ARRAY[
        'Deny anonymous access to customers',
        'Users can view customers for their restaurants',
        'Users can insert customers for their restaurants',
        'Users can update customers for their restaurants',
        'Users can delete customers for their restaurants'
    ],
    'customers table should have all expected policies'
);

SELECT policy_cmd_is(
    'public',
    'customers',
    'Users can view customers for their restaurants',
    'select',
    'customers view policy should be SELECT'
);

-- ============================================================================
-- Test: Pending_outflows table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'pending_outflows',
    ARRAY[
        'Users can view pending_outflows for their restaurants',
        'Users can insert pending_outflows for their restaurants',
        'Users can update pending_outflows for their restaurants',
        'Users can delete pending_outflows for their restaurants'
    ],
    'pending_outflows table should have all expected policies'
);

SELECT policy_cmd_is(
    'public',
    'pending_outflows',
    'Users can view pending_outflows for their restaurants',
    'select',
    'pending_outflows view policy should be SELECT'
);

-- ============================================================================
-- Test: Purchase_orders table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'purchase_orders',
    ARRAY[
        'Deny anonymous access to purchase_orders',
        'Users can view purchase_orders for their restaurants',
        'Users can insert purchase_orders for their restaurants',
        'Users can update purchase_orders for their restaurants',
        'Users can delete purchase_orders for their restaurants'
    ],
    'purchase_orders table should have all expected policies'
);

-- ============================================================================
-- Test: Prep_recipes table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'prep_recipes',
    ARRAY[
        'Users can view prep_recipes for their restaurants',
        'Users can insert prep_recipes for their restaurants',
        'Users can update prep_recipes for their restaurants',
        'Users can delete prep_recipes for their restaurants'
    ],
    'prep_recipes table should have all expected policies'
);

-- ============================================================================
-- Test: Production_runs table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'production_runs',
    ARRAY[
        'Users can view production_runs for their restaurants',
        'Users can insert production_runs for their restaurants',
        'Users can update production_runs for their restaurants'
    ],
    'production_runs table should have all expected policies'
);

-- ============================================================================
-- Test: Employees table has capability-based view and role-restricted management
-- ============================================================================

SELECT policies_are(
    'public',
    'employees',
    ARRAY[
        'Deny anonymous access to employees',
        'Users can view employees for their restaurants',
        'Owners and managers can manage employees',
        'Employees can view their own record'
    ],
    'employees table should have view and management policies'
);

SELECT policy_cmd_is(
    'public',
    'employees',
    'Users can view employees for their restaurants',
    'select',
    'employees view policy should be SELECT'
);

SELECT policy_cmd_is(
    'public',
    'employees',
    'Owners and managers can manage employees',
    'all',
    'employees management policy should be ALL - restricted to owner/manager'
);

-- ============================================================================
-- Test: User_restaurants table has isolation policy for collaborators
-- ============================================================================

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'user_restaurants'
          AND policyname = 'Users can view their restaurant associations'
    ),
    'user_restaurants should have isolation policy for collaborators'
);

SELECT policy_cmd_is(
    'public',
    'user_restaurants',
    'Users can view their restaurant associations',
    'select',
    'user_restaurants isolation policy should be SELECT'
);

-- ============================================================================
-- Test: Chart_of_accounts table has capability-based policies
-- ============================================================================

SELECT policies_are(
    'public',
    'chart_of_accounts',
    ARRAY[
        'Deny anonymous access to chart_of_accounts',
        'Users can view chart_of_accounts for their restaurants',
        'Users can insert chart_of_accounts for their restaurants',
        'Users can update chart_of_accounts for their restaurants',
        'Users can delete chart_of_accounts for their restaurants'
    ],
    'chart_of_accounts table should have all expected policies'
);

-- ============================================================================
-- Test: Connected_banks table has view policy plus management restriction
-- ============================================================================

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'connected_banks'
          AND policyname = 'Users can view connected_banks for their restaurants'
    ),
    'connected_banks should have view policy'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'connected_banks'
          AND policyname = 'Owners and managers can manage connected_banks'
    ),
    'connected_banks should have management policy restricted to owner/manager'
);

-- ============================================================================
-- Test: Financial_statement_cache has capability-based view policy
-- ============================================================================

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'financial_statement_cache'
          AND policyname = 'Users can view financial_statement_cache for their restaurants'
    ),
    'financial_statement_cache should have capability-based view policy'
);

SELECT * FROM finish();
ROLLBACK;
