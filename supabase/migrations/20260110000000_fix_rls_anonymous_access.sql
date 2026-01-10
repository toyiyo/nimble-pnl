-- SECURITY FIX: Add explicit anonymous access denial policies for sensitive tables
-- This migration addresses security scanner findings by explicitly denying
-- anonymous (unauthenticated) access to tables containing sensitive data.

-- ============================================================================
-- 1. EMPLOYEES TABLE - Employee Personal Information
-- ============================================================================
-- Contains: names, email addresses, phone numbers, salary, hire dates, etc.
CREATE POLICY "Deny anonymous access to employees"
  ON public.employees
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- 2. PROFILES TABLE - User Account Information
-- ============================================================================
-- Contains: email addresses, phone numbers, full names, role information
-- Note: Profiles already has authenticated-only policies, adding explicit anon denial
CREATE POLICY "Deny all anonymous access to profiles"
  ON public.profiles
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- 3. CUSTOMERS TABLE - Customer Contact Information
-- ============================================================================
-- Contains: customer names, email addresses, phone numbers, billing addresses
CREATE POLICY "Deny anonymous access to customers"
  ON public.customers
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- 4. BANK_TRANSACTIONS TABLE - Financial Transaction Data
-- ============================================================================
-- Contains: transaction amounts, merchant names, descriptions, dates
CREATE POLICY "Deny anonymous access to bank_transactions"
  ON public.bank_transactions
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- 5. EMPLOYEE_COMPENSATION_HISTORY TABLE - Salary/Compensation Data
-- ============================================================================
-- Contains: historical compensation data, salary amounts, hourly rates
CREATE POLICY "Deny anonymous access to employee_compensation_history"
  ON public.employee_compensation_history
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- 6. TIME_PUNCHES TABLE - Employee Time Clock Data
-- ============================================================================
-- Contains: employee punch times, locations, shift associations
CREATE POLICY "Deny anonymous access to time_punches"
  ON public.time_punches
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- 7. PURCHASE_ORDERS TABLE - Purchase Order Data
-- ============================================================================
-- Contains: supplier relationships, order totals, purchasing patterns
CREATE POLICY "Deny anonymous access to purchase_orders"
  ON public.purchase_orders
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to purchase_order_lines"
  ON public.purchase_order_lines
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- 8. SQUARE_CONNECTIONS TABLE - POS Integration Credentials
-- ============================================================================
-- Contains: access tokens, refresh tokens, merchant IDs, API scopes
-- Note: Square connections already has authenticated-only policy, adding explicit anon denial
CREATE POLICY "Deny all anonymous access to square_connections"
  ON public.square_connections
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- ADDITIONAL RELATED TABLES - Comprehensive Security Coverage
-- ============================================================================

-- Employee-related tables
CREATE POLICY "Deny anonymous access to shifts"
  ON public.shifts
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to shift_templates"
  ON public.shift_templates
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to time_off_requests"
  ON public.time_off_requests
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to employee_tips"
  ON public.employee_tips
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Bank/Financial tables
CREATE POLICY "Deny anonymous access to connected_banks"
  ON public.connected_banks
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to bank_account_balances"
  ON public.bank_account_balances
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to bank_transaction_splits"
  ON public.bank_transaction_splits
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to transaction_categorization_rules"
  ON public.transaction_categorization_rules
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Accounting tables
CREATE POLICY "Deny anonymous access to chart_of_accounts"
  ON public.chart_of_accounts
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to journal_entries"
  ON public.journal_entries
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to journal_entry_lines"
  ON public.journal_entry_lines
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to financial_statement_cache"
  ON public.financial_statement_cache
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Invoice tables
CREATE POLICY "Deny anonymous access to stripe_connected_accounts"
  ON public.stripe_connected_accounts
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to invoices"
  ON public.invoices
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to invoice_line_items"
  ON public.invoice_line_items
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to invoice_payments"
  ON public.invoice_payments
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Square POS tables
CREATE POLICY "Deny anonymous access to square_locations"
  ON public.square_locations
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to square_catalog_objects"
  ON public.square_catalog_objects
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to square_orders"
  ON public.square_orders
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to square_order_line_items"
  ON public.square_order_line_items
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to square_payments"
  ON public.square_payments
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to square_refunds"
  ON public.square_refunds
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to square_team_members"
  ON public.square_team_members
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny anonymous access to square_shifts"
  ON public.square_shifts
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Purchase order counter table
CREATE POLICY "Deny anonymous access to po_number_counters"
  ON public.po_number_counters
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON POLICY "Deny anonymous access to employees" ON public.employees IS 
  'Security: Prevents unauthorized access to employee personal information including names, emails, phone numbers, and compensation data';

COMMENT ON POLICY "Deny anonymous access to profiles" ON public.profiles IS 
  'Security: Prevents unauthorized access to user account information including emails, phone numbers, and role data';

COMMENT ON POLICY "Deny anonymous access to customers" ON public.customers IS 
  'Security: Prevents unauthorized access to customer contact information and billing addresses';

COMMENT ON POLICY "Deny anonymous access to bank_transactions" ON public.bank_transactions IS 
  'Security: Prevents unauthorized access to financial transaction data including amounts and merchant information';

COMMENT ON POLICY "Deny anonymous access to employee_compensation_history" ON public.employee_compensation_history IS 
  'Security: Prevents unauthorized access to historical salary and compensation data which could violate privacy laws';

COMMENT ON POLICY "Deny anonymous access to time_punches" ON public.time_punches IS 
  'Security: Prevents unauthorized access to employee time tracking data which could violate employee privacy';

COMMENT ON POLICY "Deny anonymous access to purchase_orders" ON public.purchase_orders IS 
  'Security: Prevents unauthorized access to supplier relationships and purchasing patterns';

COMMENT ON POLICY "Deny anonymous access to square_connections" ON public.square_connections IS 
  'Security: Prevents unauthorized access to POS integration credentials including access tokens and API keys';
