-- =====================================================================
-- FOCUS POS TRANSACTION TABLE INTEGRITY CONSTRAINTS
--
-- Adds:
--   1. Foreign keys from focus_order_items / focus_payments → focus_orders
--      (ON DELETE CASCADE so voided-order cleanup is automatic)
--   2. card_last4 CHECK enforcing 4-digit numeric only (PCI minimisation)
--
-- Design ref: docs/superpowers/specs/2026-07-01-focus-pos-transactions-design.md §3
-- =====================================================================

-- 1a. focus_order_items → focus_orders (composite FK on the natural key)
ALTER TABLE public.focus_order_items
  ADD CONSTRAINT focus_order_items_order_fk
    FOREIGN KEY (restaurant_id, business_date, focus_check_id)
    REFERENCES public.focus_orders (restaurant_id, business_date, focus_check_id)
    ON DELETE CASCADE;

-- 1b. focus_payments → focus_orders (composite FK on the natural key)
ALTER TABLE public.focus_payments
  ADD CONSTRAINT focus_payments_order_fk
    FOREIGN KEY (restaurant_id, business_date, focus_check_id)
    REFERENCES public.focus_orders (restaurant_id, business_date, focus_check_id)
    ON DELETE CASCADE;

-- 2. Enforce last-4-only storage at the DB boundary (PCI minimisation)
ALTER TABLE public.focus_payments
  ADD CONSTRAINT focus_payments_card_last4_check
    CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');
