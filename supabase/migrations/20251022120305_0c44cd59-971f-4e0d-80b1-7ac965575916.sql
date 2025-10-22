-- Add AI confidence and reasoning columns to bank_transactions
ALTER TABLE bank_transactions
  ADD COLUMN ai_confidence TEXT CHECK (ai_confidence IN ('high', 'medium', 'low')),
  ADD COLUMN ai_reasoning TEXT;

-- Create index for better query performance on confidence filtering
CREATE INDEX idx_bank_transactions_ai_confidence ON bank_transactions(ai_confidence) 
  WHERE ai_confidence IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN bank_transactions.ai_confidence IS 'AI model confidence level: high, medium, or low';
COMMENT ON COLUMN bank_transactions.ai_reasoning IS 'AI reasoning for the suggested category';