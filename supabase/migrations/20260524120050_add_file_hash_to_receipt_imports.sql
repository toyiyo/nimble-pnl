-- Add file_hash column to support duplicate-upload detection.
-- The column is nullable: legacy rows have NULL, and clients that fail
-- to hash (e.g. browser OOM on huge files) insert NULL and rely on the
-- post-OCR semantic check instead.

ALTER TABLE public.receipt_imports
  ADD COLUMN IF NOT EXISTS file_hash TEXT;

COMMENT ON COLUMN public.receipt_imports.file_hash IS
  'Lowercase-hex SHA-256 digest of the uploaded file bytes. NULL for receipts uploaded before this column existed or when client-side hashing failed.';
