-- Add sequence number to preserve receipt item order
ALTER TABLE receipt_line_items 
ADD COLUMN line_sequence INTEGER DEFAULT 0;