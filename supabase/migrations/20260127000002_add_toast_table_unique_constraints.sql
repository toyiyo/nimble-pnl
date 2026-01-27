-- Add missing unique constraints for Toast tables
-- These are required for upsert operations in the order processor

-- Unique constraint for toast_order_items (restaurant_id, toast_item_guid, toast_order_guid)
ALTER TABLE public.toast_order_items
  ADD CONSTRAINT toast_order_items_unique_item
  UNIQUE (restaurant_id, toast_item_guid, toast_order_guid);

-- Unique constraint for toast_payments (restaurant_id, toast_payment_guid, toast_order_guid)
ALTER TABLE public.toast_payments
  ADD CONSTRAINT toast_payments_unique_payment
  UNIQUE (restaurant_id, toast_payment_guid, toast_order_guid);
