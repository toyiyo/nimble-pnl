-- ============================================================================
-- Add MICR printing fields to check_bank_accounts
-- See: docs/superpowers/specs/2026-04-25-check-printing-micr-design.md
-- ============================================================================

ALTER TABLE public.check_bank_accounts
  ADD COLUMN routing_number TEXT,
  ADD COLUMN account_number_encrypted TEXT,
  ADD COLUMN account_number_last4 TEXT,
  ADD COLUMN print_bank_info BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.check_bank_accounts
  ADD CONSTRAINT check_routing_format
  CHECK (routing_number IS NULL OR routing_number ~ '^[0-9]{9}$');

ALTER TABLE public.check_bank_accounts
  ADD CONSTRAINT check_account_last4_format
  CHECK (account_number_last4 IS NULL OR account_number_last4 ~ '^[0-9]{4}$');

COMMENT ON COLUMN public.check_bank_accounts.routing_number IS
  'ABA routing number (9 digits). Plaintext — printed on every check by design.';
COMMENT ON COLUMN public.check_bank_accounts.account_number_encrypted IS
  'pgp_sym_encrypt''d bank account number. Decrypt only via get_check_bank_account_secrets RPC.';
COMMENT ON COLUMN public.check_bank_accounts.account_number_last4 IS
  'Last 4 digits of account number, plaintext, for masked UI display.';
COMMENT ON COLUMN public.check_bank_accounts.print_bank_info IS
  'When true, the printed check includes top-center bank name + bottom MICR line.';
