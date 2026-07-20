-- Tests for focus fee-item revenue classification
-- Migration: 20260719154500_focus_fee_classification.sql
--
-- Design: docs/superpowers/specs/2026-07-19-focus-fee-classification-design.md
--
-- Section 1: _focus_is_fee_item predicate
--   Third-party delivery fee line items (Dispatch Fee, Dispatch Service Fee,
--   RailsUpcharge, ...) should be identified as pass-through fees by
--   case-insensitive name pattern, NOT counted as real sale items.

BEGIN;
SELECT plan(9);

-- ─────────────────────────────────────────────────────────────────────────────
-- Section 1: _focus_is_fee_item predicate
-- ─────────────────────────────────────────────────────────────────────────────

SELECT ok(
  public._focus_is_fee_item('Dispatch Fee'),
  '_focus_is_fee_item: TRUE for ''Dispatch Fee'''
);

SELECT ok(
  public._focus_is_fee_item('Dispatch Service Fee'),
  '_focus_is_fee_item: TRUE for ''Dispatch Service Fee'''
);

SELECT ok(
  public._focus_is_fee_item('Dispatch Fee2'),
  '_focus_is_fee_item: TRUE for ''Dispatch Fee2'''
);

SELECT ok(
  public._focus_is_fee_item('RailsUpcharge'),
  '_focus_is_fee_item: TRUE for ''RailsUpcharge'''
);

SELECT ok(
  public._focus_is_fee_item('Rails Upcharge'),
  '_focus_is_fee_item: TRUE for ''Rails Upcharge'''
);

SELECT ok(
  NOT public._focus_is_fee_item('CLYellow Cake'),
  '_focus_is_fee_item: FALSE for ''CLYellow Cake'' (real sale item)'
);

SELECT ok(
  NOT public._focus_is_fee_item('Dispatch Tip'),
  '_focus_is_fee_item: FALSE for ''Dispatch Tip'' (tip, not fee)'
);

SELECT ok(
  NOT public._focus_is_fee_item(NULL),
  '_focus_is_fee_item: FALSE for NULL'
);

SELECT ok(
  NOT public._focus_is_fee_item(''),
  '_focus_is_fee_item: FALSE for empty string'
);

SELECT * FROM finish();
ROLLBACK;
