-- Add tax_amount to focus_orders — sum of SeatRecord.TaxTotal1..5 across all
-- seats on the check, captured by the parser (focusDatafeedParser.ts) and
-- persisted by focusTransactionSyncHandler.upsertOrder.
--
-- Tiny table; metadata-only default in PG11+ (no table rewrite). Existing
-- rows get 0 until re-synced — correct, since tax was never captured before
-- this migration.
--
-- Design ref: docs/superpowers/specs/2026-07-10-focus-tax-capture-design.md §"Layer 2"

ALTER TABLE public.focus_orders
ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.focus_orders.tax_amount IS
  'Sum of SeatRecord.TaxTotal1..5 across all seats on the check (Focus POS '
  'datafeed). Feeds the item_type=''tax'' unified_sales row emitted by '
  '_sync_focus_transactions_to_unified_sales_impl. Existing rows default to '
  '0 until re-synced.';
