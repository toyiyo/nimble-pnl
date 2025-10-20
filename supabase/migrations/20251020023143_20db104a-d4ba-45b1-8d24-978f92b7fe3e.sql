-- Drop old version of categorize_bank_transaction with p_is_split parameter
DROP FUNCTION IF EXISTS public.categorize_bank_transaction(uuid, uuid, text, boolean);

-- Ensure only the new version exists (3 parameters)
-- This was already created in the previous migration, so we just need to drop the old one