# Categorization: background rule application + supplier-assign semantics

**Date:** 2026-07-02
**Branch:** `fix/categorization-background`
**Status:** Approved by Jose (options: supplier = assign-not-filter; backfill in migration)

## Problems (both verified in production)

### P1 — POS rules never apply in the background

New POS sales flow in via pg_cron (`toast-unified-sales-sync` every 5 min →
`sync_all_toast_to_unified_sales()`; same pattern for Focus). Two mechanisms
each defeat rule application:

1. The bulk-sync SQL functions set `app.skip_unified_sales_triggers = 'true'`,
   bypassing the `auto_categorize_pos_sale` BEFORE INSERT trigger (intentional,
   for CPU limits — keep this).
2. Their batch fallback is gated:
   ```sql
   IF auth.uid() IS NOT NULL THEN
     PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000);
   ELSE
     RAISE LOG '... skipping batch categorization (service-role caller)';
   END IF;
   ```
   pg_cron / service-role callers always have `auth.uid() IS NULL`, so
   categorization **never** runs automatically. Only a manual "Apply to
   existing" click (authenticated RPC) categorizes.

The gate exists because `20260209000000_add_auth_to_apply_rule_functions.sql`
added a hard `auth.uid()` permission check to `apply_rules_to_pos_sales` /
`apply_rules_to_bank_transactions` that RAISES for service-role callers —
reusing the user-facing RPC as the background engine collided with its
hardening.

**Affected functions (live prod defs verified):**
- `sync_toast_to_unified_sales(uuid)` and `(uuid, date, date)` — both gated
- `_sync_focus_to_unified_sales_impl`, `_sync_focus_transactions_to_unified_sales_impl` — both gated
- `sync_shift4_to_unified_sales` — NOT affected (doesn't bypass the trigger; no change)
- `supabase/functions/stripe-sync-transactions/index.ts:297` calls
  `apply_rules_to_bank_transactions` with the service-role key → the RPC's
  permission check **raises** (`auth.uid()` NULL); bank rule application from
  that sync path errors out.

**Impact:** 11,744 uncategorized POS rows / 30 days across 3 restaurants that
have active `auto_apply` rules (1,509 are Sales Tax rows).

### P2 — Bank rules with a `supplier_id` can never match bank-feed transactions

Rule-creation UI attaches `supplier_id` as a match filter ("make this rule
more specific"). But 7,958 of 8,058 `bank_transactions` have
`supplier_id IS NULL`, and both matchers treat rule.supplier_id as a strict
filter:

- `find_matching_rules_for_bank_transaction` (batch):
  `AND (cr.supplier_id IS NULL OR cr.supplier_id::TEXT = (p_transaction->>'supplier_id'))`
  → `FALSE OR NULL` → NULL → row excluded. (Also a NULL-comparison bug: the
  predicate is never TRUE for supplier-less transactions.)
- `matches_bank_transaction_rule` (insert trigger): explicit
  `IF v_supplier_id IS NULL ... RETURN false`.

So Jose's two SYGMA rules (`description contains 'SYGMA'`, supplier = SYGMA,
`apply_count = 0`) match nothing, even on manual apply. 10 active bank rules
in prod carry a supplier_id.

## Design

### D1 — Internal/public split for the batch rule engines

Create two **internal** functions containing the current bodies minus the
permission check:

- `apply_rules_to_pos_sales_internal(p_restaurant_id uuid, p_batch_limit int)`
- `apply_rules_to_bank_transactions_internal(p_restaurant_id uuid, p_batch_limit int)`

Rules:
- `SECURITY DEFINER`, `SET search_path = public`.
- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated;`
  `GRANT EXECUTE ... TO service_role;` — clients cannot call them via
  PostgREST; SECURITY DEFINER sync functions (owner: postgres) and the
  service-role edge functions can.
- Body change beyond removing the auth check: anything that writes
  `auth.uid()` (e.g. `journal_entries.created_by`) must tolerate NULL. Verify
  the column is nullable; if not, leave it NULL-safe via the existing insert
  (check during build — pgTAP asserts the cron-context path works end to end).

The **public** `apply_rules_to_pos_sales` / `apply_rules_to_bank_transactions`
keep their exact signatures and permission checks, and become thin wrappers
delegating to the internal functions. Frontend `useApplyRulesV2` keeps working
unchanged.

Update the four gated sync functions: replace the `IF auth.uid() IS NOT NULL`
block with an unconditional
`PERFORM apply_rules_to_pos_sales_internal(p_restaurant_id, 10000);`.
Re-declare each sync function with its **full current production body**
(pulled from live prod, not from a stale migration) so nothing else changes.

Update `stripe-sync-transactions/index.ts` to RPC
`apply_rules_to_bank_transactions_internal` (service role has EXECUTE).

### D2 — Supplier on a rule = assignment when other criteria exist

New semantics, applied identically in **both** matchers
(`find_matching_rules_for_bank_transaction`, `matches_bank_transaction_rule`):

- A rule is "supplier-only" when it has NO other positive criteria:
  `description_pattern IS NULL AND amount_min IS NULL AND amount_max IS NULL`.
  For supplier-only rules, supplier_id remains a strict filter (transaction
  must already be linked to that supplier). Fix the NULL-comparison so a
  supplier-less transaction yields FALSE, not NULL.
- When the rule HAS other criteria, supplier_id is **not** a filter. Matching
  is decided by the other criteria alone.

On apply (all three write paths), when the matched rule has a supplier_id and
the transaction has none, assign it:
- batch (`apply_rules_to_bank_transactions_internal`): return the rule's
  supplier_id from the matcher (add column to the RETURNS TABLE of
  `find_matching_rules_for_bank_transaction`) and
  `supplier_id = COALESCE(bank_transactions.supplier_id, <rule supplier>)`.
- trigger (`auto_apply_bank_categorization_rules`):
  `NEW.supplier_id := COALESCE(NEW.supplier_id, v_matching_rule.supplier_id);`
  (select supplier_id into the matching-rule record).
- Adding a column to `find_matching_rules_for_bank_transaction`'s RETURNS
  TABLE requires DROP + CREATE (Postgres can't change OUT parameters via
  CREATE OR REPLACE); re-grant as currently granted.

POS rules also have a supplier_id column but POS matching
(`find_matching_rules_for_pos_sale`) doesn't filter on supplier — no POS
change.

**UI (`EnhancedCategoryRulesDialog.tsx`):**
- Supplier field copy changes to assignment semantics (e.g. label/help: "Tag
  matching transactions with this supplier").
- The "too generic" validation no longer counts `supplierId` as specificity
  when a description pattern exists (supplier no longer restricts matching);
  amount range still counts. Supplier-only rules (no description) remain valid
  and specific.
- Rule-list condition summary renders supplier as "Assigns supplier: X" when
  other criteria exist, "Supplier: X" when supplier-only.

**No data cleanup needed:** existing supplier-carrying rules start matching by
their description patterns and now also tag the supplier — which is the
evident user intent.

### D3 — One-time backfill inside the migration

After creating/updating everything, the migration loops over restaurants that
have at least one active `auto_apply` categorization rule and drains the
backlog:

```sql
FOR r IN SELECT DISTINCT restaurant_id FROM categorization_rules
         WHERE is_active AND auto_apply LOOP
  LOOP
    SELECT applied_count INTO n FROM apply_rules_to_pos_sales_internal(r.restaurant_id, 5000);
    EXIT WHEN n = 0; i := i + 1; EXIT WHEN i > 50;   -- bounded
  END LOOP;
  -- same loop for apply_rules_to_bank_transactions_internal
END LOOP;
```

- Empty local/CI databases: zero restaurants → no-op.
- Bounded iterations guard against a pathological non-converging loop.
- Wrap each restaurant in BEGIN/EXCEPTION so one bad restaurant doesn't fail
  the whole migration (log a WARNING instead).

## Out of scope (noted for follow-up)

- Absurd `apply_count` values on two rules (9.09M and 14.8M) suggest the
  manual apply loop double-counts or re-applies; investigate separately.
- `transaction_categorization_rules` and `rule_application_log` tables exist
  but are empty/unused — dead schema, separate cleanup.
- A periodic re-categorization cron (rules created after import apply to old
  rows only via manual click). The trigger + sync-time batch cover the fresh
  data path; manual click covers retroactive application. Acceptable.

## Testing

**pgTAP (`supabase/tests/`):**
1. Toast sync path without auth: seed connection/orders + active auto_apply
   rule, call `sync_toast_to_unified_sales` with no `auth.uid()` → matching
   `unified_sales` rows end up categorized (this is the regression test for
   the whole P1 bug).
2. `apply_rules_to_pos_sales` (public) still raises for a non-member /
   anonymous caller; `_internal` works without auth and is not executable by
   `authenticated`/`anon` (check `has_function_privilege`).
3. Same pair for bank functions.
4. Supplier semantics: (a) rule with description+supplier matches a
   supplier-less transaction and assigns the supplier (trigger path and batch
   path); (b) supplier-only rule does NOT match a supplier-less transaction;
   (c) supplier-only rule matches a transaction already linked to the
   supplier.
5. Backfill block: uncategorized seeded rows are categorized after the
   migration runs (implicitly covered by db reset in test 1 setup, or a
   dedicated assertion).

**Vitest:** UI validation change in `EnhancedCategoryRulesDialog` (generic
pattern + supplier no longer passes; generic pattern + amount range still
passes) if the validation logic is extractable; otherwise cover via component
test.

**Manual/prod verification after merge:** re-run the diagnostic queries —
uncategorized Sales Tax rows for restaurant `7c0c76e3` should drop to 0 and
stay at 0 after the next cron cycle; SYGMA transactions categorized with
supplier tagged.

## Migration safety

- Single new migration file; all `CREATE OR REPLACE` except
  `find_matching_rules_for_bank_transaction` (DROP+CREATE for RETURNS TABLE
  change) — re-grant EXECUTE to match current grants.
- Sync function bodies are re-declared from **live prod definitions** (via
  `pg_get_functiondef`) with only the gate replaced, avoiding regression from
  stale migration sources.
- Idempotent: safe to re-run (OR REPLACE + guarded DROP + backfill converges
  to 0).
