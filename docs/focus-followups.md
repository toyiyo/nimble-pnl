# Focus POS — open follow-ups

Handoff notes. Context: Focus tax capture shipped (#600), void preservation shipped
(#618, merged), `collected_at_pos` void-exclusion fix in review (#619, CI running).
The three items below are the remaining "fix 1–4" tasks. Each should go through the
`development-workflow` skill (brainstorm → plan → worktree → TDD → review → PR).

## 1. Phantom $0 orders + service-fee-item revenue classification — DONE
- **Status:** Fixed on `fix/focus-fee-item-classification`
  (`docs/superpowers/specs/2026-07-19-focus-fee-classification-design.md`).
  Fee items (`Dispatch Fee`, `Dispatch Service Fee`, `RailsUpcharge`, etc., matched
  by name via the new `_focus_is_fee_item` SQL helper) are now reclassified as
  `item_type='other'`, `adjustment_type='fee'` in
  `_sync_focus_transactions_to_unified_sales_impl`, so they drop out of `revenue`
  while staying in `pass_through_amount` and `collected_at_pos`. Phantom $0
  fee-only checks resolve for free once the fee row is no longer counted as a
  sale — no separate suppression logic was needed. Covered end-to-end by
  `supabase/tests/55_focus_fee_classification.sql` (mixed check, fee-only
  "phantom" check, voided fee, discounted fee, split-child backfill cleanup,
  idempotency).
- **Symptom (original):** some Focus orders (originally reported as "delivery
  orders") import as `$0`. Root cause is understood to be **phantom / fee-only
  checks**, not a parser bug.
- **Two sub-parts (original):**
  - Phantom $0 orders — decide whether to skip/suppress them or surface differently.
  - Fee items like **RailsUpcharge** / **Dispatch Fee** are being counted as `sale`
    revenue; they should be classified as non-sales (pass-through / fee), i.e.
    `adjustment_type` set so they drop out of `revenue`.
- **Files:** `supabase/migrations/20260719154500_focus_fee_classification.sql`,
  `supabase/tests/55_focus_fee_classification.sql`.
- **Later nice-to-have:** the fee-item name matching (`_focus_is_fee_item`) is
  currently pattern-based, validated against the sample fixture
  (`tests/fixtures/focus-datafeed-sample.xml`) rather than a captured real feed
  containing a `RailsUpcharge` line. Capture a real Focus datafeed payload with a
  `RailsUpcharge` item (report_group_id, exact name/price shape) and add it as a
  fixture to lock in the pattern match against a real-world example — same spirit
  as follow-up item 2 below.

## 2. Harden Focus tax parser tests with a real-feed fixture
- Current tax parser tests are synthetic. Add a **real datafeed XML fixture** (a
  captured `blob_url` payload) and assert the parser sums `SeatRecord.TaxTotal1..5`
  into `FocusCheck.taxAmount` correctly end-to-end.
- Sanitize the fixture (no secrets/PII) before committing.
- **Files:** parser + a new fixture under the test dir; parser unit tests.

## 3. 14-day custom-range sync UX
- The custom-range sync is capped at 14 days (a deliberate guard, **not** a bug —
  verified). The UX is confusing: users don't know why a wider range silently
  truncates.
- **Goal:** surface the 14-day limit in the UI (helper text / disabled state / clear
  message) so the cap is understood, or chunk longer ranges into sequential 14-day
  syncs. Decide during brainstorm.
- **Files:** Focus sync UI (setup wizard / sync trigger component) + the edge function
  that enforces the cap.

## Reference — void model recap (for context)
- Focus voids arrive as check-level `<DeleteRecord>`. Handler soft-deletes
  (`focus_orders.is_voided=true`) instead of hard-deleting; the sync RPC deletes the
  check's revenue rows and inserts one negative `adjustment_type='void'` marker
  (`item_type='other'`, `external_item_id = <order>_void`).
- Read layer: `revenue` keys on `item_type='sale' AND adjustment_type IS NULL`;
  `void`/`discount`/`tip`/`tax` all excluded from revenue via `adjustment_type`.
  `collected_at_pos` now also excludes `void` (#619).
