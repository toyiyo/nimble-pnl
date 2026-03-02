-- Migration: Add was_previously_deleted column to bank_statement_lines
-- Purpose: Flag statement lines whose fingerprints match tombstoned (deleted) transactions
--          so the review UI can show users why lines were auto-excluded.

ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS was_previously_deleted BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.bank_statement_lines.was_previously_deleted IS
'True when the line matches a tombstoned (previously deleted) bank transaction fingerprint. Auto-excluded from import.';
