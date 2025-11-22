-- Create index on bank_transactions.is_categorized for faster categorization queries
CREATE INDEX IF NOT EXISTS idx_bank_transactions_is_categorized 
ON public.bank_transactions USING btree (is_categorized);

-- Create composite index for common query pattern (restaurant + categorization status)
CREATE INDEX IF NOT EXISTS idx_bank_transactions_restaurant_categorized 
ON public.bank_transactions USING btree (restaurant_id, is_categorized);

-- Create index on unified_sales for similar performance improvements
CREATE INDEX IF NOT EXISTS idx_unified_sales_is_categorized 
ON public.unified_sales USING btree (is_categorized);

CREATE INDEX IF NOT EXISTS idx_unified_sales_restaurant_categorized 
ON public.unified_sales USING btree (restaurant_id, is_categorized);