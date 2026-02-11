-- Add source_account and raw_data columns to bank_statement_lines
-- for multi-account CSV import support
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS source_account TEXT;
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- Index for efficient per-account queries within an upload
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_source_account
  ON bank_statement_lines(statement_upload_id, source_account)
  WHERE source_account IS NOT NULL;
