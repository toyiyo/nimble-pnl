-- Focus fee-item revenue classification
--
-- Design: docs/superpowers/specs/2026-07-19-focus-fee-classification-design.md
--
-- Third-party delivery fee line items (Dispatch Fee, Dispatch Service Fee,
-- RailsUpcharge, ...) are priced CheckItemRecords that the Focus sync RPC
-- currently classifies as item_type='sale', inflating revenue. This
-- migration adds an IMMUTABLE helper predicate to identify them by
-- case-insensitive item-name pattern so the sync RPC can reclassify them
-- as adjustment_type='fee' (pass-through, excluded from revenue).
--
-- Conservative: matches only known third-party delivery pass-through fees.
-- Does NOT broadly match '%fee%' (a real "Corkage"/"Split-Plate" charge
-- stays a sale until we learn otherwise). Extending is a one-line OR.

CREATE OR REPLACE FUNCTION public._focus_is_fee_item(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_name IS NOT NULL AND (
       lower(p_name) LIKE '%dispatch%fee%'   -- Dispatch Fee, Dispatch Service Fee, Dispatch Fee2
    OR lower(p_name) LIKE '%rails%upcharge%'  -- RailsUpcharge, Rails Upcharge
  );
$$;

REVOKE ALL ON FUNCTION public._focus_is_fee_item(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._focus_is_fee_item(text) TO service_role;
