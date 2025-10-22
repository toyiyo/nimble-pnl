-- Drop all old versions of categorize_bank_transaction to eliminate ambiguity
DROP FUNCTION IF EXISTS public.categorize_bank_transaction(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.categorize_bank_transaction(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.categorize_bank_transaction(p_transaction_id uuid, p_category_id uuid, p_description text);
DROP FUNCTION IF EXISTS public.categorize_bank_transaction(p_transaction_id uuid, p_category_id uuid, p_description text, p_normalized_payee text);

-- Keep only the latest version with all parameters
-- This function already exists from migration 20251021204739
-- Just ensuring it's the only one that exists