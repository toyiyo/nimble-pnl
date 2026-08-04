# POS sync: bound the categorization re-scan, and make every POS path behave the same

**Date:** 2026-08-03
**Branch:** `fix/pos-sync-categorization-rescan`
**Status:** approved (design review pending)

---

## 1. Problem

`SELECT sync_all_toast_to_unified_sales()` is the most expensive statement on
production: 53,463 calls, 455,230,797 ms total, 8,515 ms mean, 119,971 ms max.

84% of each run is one call:
`PERFORM apply_rules_to_pos_sales_internal(p_restaurant_id, 10000)`.

That function re-evaluates **every uncategorized `unified_sales` row against
every active categorization rule, on every run**. Rows that match no rule stay
uncategorized forever, so they are re-evaluated again on the next run — 288
times a day.

`EXPLAIN (ANALYZE, BUFFERS)` on the driver query for restaurant "Home":

```
Limit  (cost=0.67..208.08 rows=10000 width=36) (actual time=6115.723..6115.723 rows=0 loops=1)
  Buffers: shared hit=4821275
  ->  Nested Loop  (actual time=6115.721..6115.722 rows=0 loops=1)
        ->  Index Scan using idx_unified_sales_rule_candidates on unified_sales s
              (actual time=0.100..131.232 rows=51366 loops=1)   Buffers: shared hit=43721
        ->  Function Scan on find_matching_rules_for_pos_sale matched
              (actual time=0.116..0.116 rows=0 loops=51366)
              Filter: (rule_id IS NOT NULL)   Buffers: shared hit=4777554
Execution Time: 6116.236 ms
```

51,366 candidate rows × 87 active rules → **0 matches**, 4.78 M of 5.66 M total
buffer hits inside the function scan.

The root cause is structural, not statistical. In
[`20260703090000_categorization_background_and_supplier_assign.sql:339`](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql#L339)
the candidate set is joined to the matcher with `CROSS JOIN LATERAL`, the
matcher's output is filtered (`matched.rule_id IS NOT NULL`), and `LIMIT
p_batch_limit` sits at the end. **`LIMIT` bounds output rows, not function
invocations** — the matcher runs for every candidate row before the limit can
apply. `LIMIT 10000` therefore does not bound the work at all.

### Blast radius

| Restaurant | Uncategorized rows | Active rules |
|---|---|---|
| Home | 51,366 | 87 |
| Russos Pizzeria | 2,707 | 495 |
| Wetzel's–Cold Stone | 38 | 70 |

The same function is shared by three cron-driven paths, and
`apply_rules_to_bank_transactions_internal`
([`…20260703090000…sql:483`](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql#L483))
has the identical shape:

| pg_cron job | Schedule | Calls the sweep | Mean |
|---|---|---|---|
| 4 `toast-unified-sales-sync` | `*/5 * * * *` | yes | 9.21 s |
| 38 `focus-unified-sales-sync` | `*/5 * * * *` | yes | 0.10 s |
| 30 `focus-transactions-sync` | `*/5 * * * *` | yes | 0.77 s (max 11.2 s) |

`drain_categorization_backlog()` calls both internal functions and is currently
unscheduled (it self-unscheduled on 2026-07-05); it inherits this fix for free
if it is ever re-enabled.

### Second bug: Revel rows are never rule-categorized

Two mechanisms categorize POS rows, and each POS path must use exactly one:

- the `BEFORE INSERT` trigger `auto_categorize_pos_sale` →
  `auto_apply_pos_categorization_rules()`, which categorizes row-by-row at
  insert time; or
- the batch sweep, used when the trigger is deliberately suppressed for bulk
  speed via the `app.skip_unified_sales_triggers` GUC.

| POS | Suppresses trigger | Calls sweep | Result |
|---|---|---|---|
| Shift4, Square, Clover | no | no | trigger categorizes at INSERT — correct |
| Toast, Focus, Focus-txns | yes | yes | trigger suppressed, sweep compensates — correct but slow |
| **Revel** | **yes** | **no** | **trigger suppressed, nothing compensates — never categorized** |

`sync_revel_to_unified_sales` sets the suppression GUC at
[`20260721160000_revel_rpc_sold_at_self_heal.sql:200`](../../../supabase/migrations/20260721160000_revel_rpc_sold_at_self_heal.sql#L200)
and clears it at
[line 382](../../../supabase/migrations/20260721160000_revel_rpc_sold_at_self_heal.sql#L382),
but never calls the sweep. Production confirms it: Revel rows created in
2026-08 are **543 rows, 0 categorized**. The 2026-07 rows that are categorized
(3,834) were caught by `drain_categorization_backlog` before it unscheduled
itself.

### Third gap: silent failure

Every `sync_all_*` wrapper swallows per-restaurant errors with
`EXCEPTION WHEN OTHERS THEN RAISE WARNING`
([toast:65](../../../supabase/migrations/20260216120000_toast_incremental_sync.sql#L65),
[shift4:72](../../../supabase/migrations/20260127100000_shift4_lighthouse_sync_enhancements.sql#L72),
[focus:63](../../../supabase/migrations/20260705003631_focus_legacy_cron_no_claim_bump.sql#L63),
[focus-txns:129](../../../supabase/migrations/20260703120000_focus_backfill_reliability.sql#L129)).
`RAISE WARNING` goes to the Postgres log and nowhere a human looks.

Worse, **`WHEN OTHERS` does not catch `query_canceled` (57014)** — plpgsql
excludes it, along with `assert_failure`, by design. This repo already learned
that lesson and encoded it at
[`…20260703090000…sql:953`](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql#L953),
where `drain_categorization_backlog` names `WHEN query_canceled` explicitly.
The `sync_all_*` wrappers do not. So when
`sync_toast_to_unified_sales` — which carries `SET statement_timeout TO '120s'`
— times out for one restaurant, the handler does **not** fire: the exception
propagates and aborts the entire cron run, silently skipping every restaurant
later in the loop. That is what produced the 733 aborts over four days in Feb
2026. The immediate trigger was fixed by
[`20260216120000_toast_incremental_sync.sql`](../../../supabase/migrations/20260216120000_toast_incremental_sync.sql)
(1 failure since, 0 in the last 30 days), but the missing-isolation defect is
still present on all four paths — and this change makes those paths do more
work, so it must close with it.

---

## 2. Approach

A **negative-result cache**: record that a row has already been evaluated
against the current rule set, and skip it until either the row changes or the
restaurant's rules change. Explicitly *not* a set-based rewrite of
`find_matching_rules_for_pos_sale` — that is a larger, riskier change and the
cache alone removes the 288×/day rescan.

Steady state after this lands: the candidate set is empty on almost every run,
so the sweep costs an index probe that returns zero rows.

---

## 3. Design

### 3.1 Schema — evaluated marker

```sql
ALTER TABLE public.unified_sales
  ADD COLUMN rules_evaluated_at timestamptz NOT NULL DEFAULT '-infinity';

ALTER TABLE public.bank_transactions
  ADD COLUMN rules_evaluated_at timestamptz NOT NULL DEFAULT '-infinity';
```

Production is **PostgreSQL 17.6**. `'-infinity'::timestamptz` is a non-volatile
constant, so this uses the PG 11+ fast-default path: metadata-only, no table
rewrite, no `ACCESS EXCLUSIVE` lock held for the length of a 190k-row rewrite.

Existing rows land on `'-infinity'`, which is strictly less than any real
watermark — so every existing row is a candidate exactly once, then drains.

### 3.2 Invalidation — rule watermark, no invalidation write

```sql
SELECT max(GREATEST(cr.created_at, COALESCE(cr.updated_at, cr.created_at)))
  INTO v_rules_changed_at
FROM public.categorization_rules cr
WHERE cr.restaurant_id = p_restaurant_id
  AND cr.is_active
  AND cr.auto_apply
  AND cr.applies_to IN ('pos_sales', 'both');

IF v_rules_changed_at IS NULL THEN
  RETURN QUERY SELECT 0, 0;   -- no active rules: nothing can match
  RETURN;
END IF;
```

Candidate predicate is `rules_evaluated_at < v_rules_changed_at`; rows are
stamped **`= v_rules_changed_at`**, not `now()`. A rule committed after this
transaction's snapshot carries a `created_at` at or after the watermark this
run computed, so the next run re-opens every row. Changing any rule
invalidates the whole restaurant's cache with zero writes to `unified_sales`.

`categorization_rules.updated_at` is maintained by trigger
`update_categorization_rules_updated_at BEFORE UPDATE` → `update_accounting_updated_at()`,
verified on production — so edits and deactivations both move the watermark.

**Known limitation (accepted).** A hard `DELETE` of a rule does not move the
watermark, and a rule whose `created_at` is bit-identical to the current
watermark would never invalidate. Deleting a rule is safe by construction —
this is a *negative* cache, and removing a rule can only reduce the match set,
never create a missed match. The timestamp tie is a genuine (≈1e-6) hole. The
zero-tolerance alternative is a per-restaurant monotonic version counter
bumped by an `AFTER INSERT/UPDATE/DELETE` trigger on `categorization_rules`;
it is deliberately deferred as unnecessary complexity for the observed rule
volume (≤495 rules per restaurant, edited by hand). The boundary is pinned by
a pgTAP test so a future change cannot widen it silently.

### 3.3 Driver query — stamp first, then match

The current single query is replaced by two statements. Statement 1 selects and
stamps the batch; statement 2 runs the matcher against exactly those ids.

```sql
WITH batch AS MATERIALIZED (
  SELECT s.id
  FROM public.unified_sales s
  WHERE s.restaurant_id = p_restaurant_id
    AND (s.is_categorized = false OR s.category_id IS NULL)
    AND s.is_split = false
    AND s.rules_evaluated_at < v_rules_changed_at
  ORDER BY s.sale_date DESC
  LIMIT p_batch_limit
), stamped AS (
  UPDATE public.unified_sales u
     SET rules_evaluated_at = v_rules_changed_at
    FROM batch b
   WHERE u.id = b.id
  RETURNING u.id
)
SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_batch_ids FROM stamped;
```

`MATERIALIZED` is required, not decorative: since PG 12 a CTE referenced once
is inlined by default, and the entire point of this rewrite is that the `LIMIT`
must be an optimisation barrier the matcher cannot cross. Spelling it out makes
the guarantee independent of planner heuristics.

Then the matcher runs over a set that is provably `≤ p_batch_limit` rows:

```sql
FOR v_sale IN
  SELECT s.id, s.total_price, s.sale_date,
         m.rule_id, m.rule_name, m.category_id AS rule_category_id,
         m.is_split_rule, m.split_categories
  FROM public.unified_sales s
  CROSS JOIN LATERAL public.find_matching_rules_for_pos_sale(
    p_restaurant_id,
    jsonb_build_object('item_name', s.item_name,
                       'total_price', s.total_price,
                       'pos_category', s.pos_category)
  ) m
  WHERE s.id = ANY(v_batch_ids)
    AND m.rule_id IS NOT NULL
  ORDER BY s.sale_date DESC
LOOP
  -- body unchanged: split branch, split_pos_sale, plain UPDATE,
  -- apply_count/last_applied_at bookkeeping, per-row EXCEPTION handler.
  -- One addition, on the success path only:
  --   v_applied_dates := v_applied_dates || v_sale.sale_date::date;
  -- feeding the single end-of-sweep re-aggregation in §3.4.
END LOOP;
```

`v_batch_ids` is `uuid[]` and `v_applied_dates` is `date[]`, both declared in
`DECLARE`. If `v_batch_ids` comes back empty the loop body never runs — the
common steady-state path costs one index probe and nothing else.

Unmatched rows never entered the old `FOR` loop, which is exactly why they were
never marked. Stamping before the loop fixes that at the source.

Everything else about the function is preserved verbatim: `SECURITY DEFINER`,
`SET search_path = pg_catalog, public`, the `p_batch_limit` validation at
[`…20260703090000…sql:322`](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql#L322),
the documented absence of a permission check (the public wrapper
`apply_rules_to_pos_sales` enforces membership —
[line 442](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql#L442)),
the split-rule branch, and the `REVOKE`/`GRANT` grants at
[lines 411–413](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql#L411).

### 3.4 Trigger suppression around the sweep — load-bearing

`unified_sales` carries `trigger_unified_sales_to_daily`, which is
**`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`** →
`trigger_unified_sales_aggregation()` → `aggregate_unified_sales_to_daily()` →
`calculate_daily_pnl()`. A full daily re-aggregation and P&L recompute, per row.

The stamping `UPDATE` in §3.3 touches up to 10,000 rows. Left alone it would
fire 10,000 aggregations per sweep — strictly worse than the bug being fixed.
This is not hypothetical: `sync_toast_to_unified_sales` resets
`app.skip_unified_sales_triggers` to `'false'` **before** it calls the sweep,
so the flag is already off when `apply_rules_to_pos_sales_internal` runs. The
existing per-row `UPDATE ... SET is_categorized = true` pays this cost today
for every *matched* row; it is invisible at Home only because Home matches zero
rows.

So the sweep suppresses the trigger for its own duration and re-aggregates the
touched dates once at the end — the same pattern `sync_revel_to_unified_sales`
already uses at
[lines 382–392](../../../supabase/migrations/20260721160000_revel_rpc_sold_at_self_heal.sql#L382):

```sql
v_prev_skip := COALESCE(current_setting('app.skip_unified_sales_triggers', true), 'false');
PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

-- ... stamp + match + apply ...

PERFORM set_config('app.skip_unified_sales_triggers', v_prev_skip, true);

-- Caller already owns aggregation if it had suppression on when it called us.
IF v_applied_count > 0 AND v_prev_skip IS DISTINCT FROM 'true' THEN
  PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
  FROM (SELECT DISTINCT unnest(v_applied_dates) AS sale_date) d;
END IF;
```

Restoring the **previous** value rather than blindly `'false'` matters: the
function is also reachable from `drain_categorization_backlog()` and from the
public wrapper, and a future caller may hold suppression across the call.

**Equivalence argument — all five triggers, not just the aggregation one.**
Suppression widens a window that other triggers also sit in, so the argument
has to enumerate them rather than reason about `trigger_unified_sales_to_daily`
alone. `unified_sales` carries exactly five non-internal triggers (verified in
production via `pg_get_triggerdef`; the split-rule one has no migration source —
see §7 item 2):

| Trigger | Timing | Honours the GUC? | Effect of the wider suppression window |
|---|---|---|---|
| `auto_categorize_pos_sale` → `auto_apply_pos_categorization_rules()` | BEFORE INSERT | **yes** | No-op either way. It only fires on rows the sweep inserts — split children — and its guard is `is_categorized = false OR category_id IS NULL`, while `split_pos_sale` inserts children with `is_categorized = true` and a non-null `category_id` ([`20251122170000…sql:120-121`](../../../supabase/migrations/20251122170000_fix_split_pos_sale_cleanup.sql#L120)). Guard already fails today; suppressing it changes nothing. |
| `automatic_inventory_deduction_trigger` → `trigger_automatic_inventory_deduction()` | AFTER INSERT | no | Behaviour is identical inside and outside the window, because it never reads the GUC. (It does deduct inventory a second time for split children — pre-existing, unchanged by this design, and untouched by suppression.) |
| `trigger_auto_apply_pos_split_rules` → `auto_apply_pos_split_rules()` | AFTER INSERT | no | Identical inside and outside the window. Its guard is `category_id IS NOT NULL AND is_categorized = false AND is_split = false`, which split children never satisfy (`is_categorized = true`), so it does not fire in either regime. |
| `trigger_unified_sales_to_daily` → `trigger_unified_sales_aggregation()` | AFTER INSERT OR DELETE OR UPDATE | **yes** | **The one that actually changes.** Compensated by the single end-of-sweep re-aggregation below. |
| `trigger_update_unified_sales_updated_at` | BEFORE UPDATE | no | Identical. Disjoint from the new §3.5 trigger (which writes only `rules_evaluated_at`), so their relative firing order is immaterial. |

Only the fourth row changes, and it is end-state-equivalent rather than a
functional change: `aggregate_unified_sales_to_daily` sums
`COALESCE(total_price, unit_price*quantity, 0) WHERE adjustment_type IS NULL`
and never reads `category_id`, so categorising a row cannot change a daily
total. Split rules do add rows, and split children inherit the parent's
`sale_date`
([`20251122170000_fix_split_pos_sale_cleanup.sql:117`](../../../supabase/migrations/20251122170000_fix_split_pos_sale_cleanup.sql#L117)),
so recording the parent's date covers both the child `INSERT`s and the parent's
`is_split = true` `UPDATE`.

This table is written out rather than asserted because the conclusion currently
rests on two unguarded triggers whose guards *happen* to exclude the rows the
sweep touches. If either guard is ever relaxed, the equivalence breaks, and the
reasoning needs to be visible for that to be caught.

`bank_transactions` has no aggregation-on-UPDATE trigger, so its half of the
change carries none of this hazard. Its existing `p_skip_rebuild` /
`rebuild_account_balances` handling is untouched.

### 3.5 Cache reset on row change — trigger, not per-writer patches

```sql
CREATE OR REPLACE FUNCTION public.reset_rules_evaluated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public   -- SECURITY INVOKER: assigning to NEW needs no elevation
AS $$
BEGIN
  IF NEW.item_name    IS DISTINCT FROM OLD.item_name
  OR NEW.total_price  IS DISTINCT FROM OLD.total_price
  OR NEW.pos_category IS DISTINCT FROM OLD.pos_category THEN
    NEW.rules_evaluated_at := '-infinity';
  END IF;
  RETURN NEW;
END;
$$;
```

`BEFORE UPDATE FOR EACH ROW` on `unified_sales` (and the analogous
`description` / `amount` variant on `bank_transactions`).

Those three columns are exactly the matcher's inputs — `jsonb_build_object('item_name', …, 'total_price', …, 'pos_category', …)`
— so a change to any of them invalidates the cached negative result and nothing
else does. Toast's upsert path writes precisely these fields in its
`ON CONFLICT DO UPDATE`, so this is not a theoretical case.

A trigger rather than patching each `ON CONFLICT DO UPDATE` because PostgREST
upserts from edge functions bypass the RPCs entirely; the trigger is the only
place that sees every writer.

The trigger deliberately **does not** honour `app.skip_unified_sales_triggers`.
That flag exists to skip *expensive* work (aggregation, per-row matching)
during bulk syncs; this trigger is three `IS DISTINCT FROM` comparisons and an
assignment on a tuple already in memory, and skipping it during a bulk sync
would leave stale cache entries for exactly the rows the bulk sync just
changed.

The §3.3 stamping `UPDATE` does not touch any of the three watched columns, so
it cannot reset the stamp it is writing. That correctness rests on a coincidence
of column lists, so it is pinned by an explicit pgTAP assertion.

### 3.6 Indexes

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_rule_candidates_v2
  ON public.unified_sales (restaurant_id, rules_evaluated_at, sale_date DESC)
  WHERE is_split = false AND (is_categorized = false OR category_id IS NULL);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_rule_candidates_v2
  ON public.bank_transactions (restaurant_id, rules_evaluated_at, transaction_date DESC)
  WHERE is_split = false AND excluded_reason IS NULL
    AND (is_categorized = false OR category_id IS NULL);
```

Equality column first, range column next — and the ordering is chosen for the
steady state, not the drain. After the backlog drains,
`rules_evaluated_at < watermark` matches ~0 rows and the scan terminates at the
first index entry, 288 times a day. The alternative
`(restaurant_id, sale_date DESC)` with `rules_evaluated_at` as a filter would
satisfy the `ORDER BY` without a sort but would walk all 51k index entries on
every run — precisely the pathology being removed. The cost of this ordering is
a sort node during the ~6-run drain: ≤51k narrow rows, tens of milliseconds.
**This trade-off is recorded in the migration comment so it is not "optimised"
back.**

These supersede `idx_unified_sales_rule_candidates` and
`idx_bank_transactions_rule_candidates` from
[`20251127120000_targeted_apply_rule_batches.sql:228`](../../../supabase/migrations/20251127120000_targeted_apply_rule_batches.sql#L228).
The old indexes are dropped in a **separate, later** migration so a rollback of
the function change still has an index to use.

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block and the
Supabase CLI wraps each migration file in one. Repo convention (11 existing
files, e.g.
[`20260727130000_idx_unified_sales_restaurant_item_name.sql:13`](../../../supabase/migrations/20260727130000_idx_unified_sales_restaurant_item_name.sql#L13)
and
[`20260708193107_idx_unified_sales_uncategorized_feed.sql:8`](../../../supabase/migrations/20260708193107_idx_unified_sales_uncategorized_feed.sql#L8))
is one CIC statement per migration file, with a comment explaining why and a
design-doc provenance line. Followed here.

### 3.7 Failure visibility — name `query_canceled`, then reuse the connection tables

Each `sync_all_*` per-restaurant handler gains an explicit `query_canceled`
arm — without it, a `statement_timeout` in one restaurant still aborts the
whole run:

```sql
EXCEPTION
  -- WHEN OTHERS does NOT catch query_canceled (57014); name it explicitly so a
  -- timed-out restaurant is skipped instead of aborting the whole cron run.
  WHEN query_canceled THEN
    RAISE WARNING 'sync_all_<pos>: timed out for restaurant %: %',
      v_connection.restaurant_id, SQLERRM;
    PERFORM public.record_pos_sync_error('<pos>', v_connection.restaurant_id, SQLERRM);
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to sync <pos> restaurant %: %',
      v_connection.restaurant_id, SQLERRM;
    PERFORM public.record_pos_sync_error('<pos>', v_connection.restaurant_id, SQLERRM);
END;
```

The recording itself is a small helper so the four wrappers share one
implementation rather than four copy-pasted blocks:

```sql
CREATE OR REPLACE FUNCTION public.record_pos_sync_error(
  p_pos text, p_restaurant_id uuid, p_message text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  SET LOCAL statement_timeout = '5s';
  EXECUTE format(
    'UPDATE public.%I SET connection_status = ''error'',
                          last_error = left($1, 500),
                          last_error_at = now()
      WHERE restaurant_id = $2',
    p_pos || '_connections')
  USING p_message, p_restaurant_id;
EXCEPTION WHEN OTHERS THEN
  NULL;  -- error bookkeeping must never mask the original failure
END;
$$;

-- MANDATORY. Supabase's default ACL on the public schema grants EXECUTE to
-- anon and authenticated (verified: pg_default_acl carries
-- {postgres=X,anon=X,authenticated=X,service_role=X} for schema public).
-- Without this REVOKE, a SECURITY DEFINER function that writes to
-- <pos>_connections is reachable with the public anon key, letting any caller
-- set connection_status='error' and an attacker-controlled last_error on ANY
-- restaurant's connection row — a cross-tenant write that bypasses RLS
-- entirely. Same pattern the sibling internals already use at
-- 20260703090000…sql:411-413.
REVOKE EXECUTE ON FUNCTION public.record_pos_sync_error(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pos_sync_error(text, uuid, text)
  TO service_role;
```

`p_pos` is supplied only as a literal by the four wrappers, never from user
input; the `format(%I)` quoting is belt-and-braces. The `REVOKE` above is not —
it is the only thing keeping this function off the PostgREST surface, and it
must ship in the same migration as the `CREATE`. On the success path each
wrapper clears the fields (`connection_status = 'connected'`,
`last_error = NULL`, `last_error_at = NULL`).

`connection_status`, `last_error`, and `last_error_at` already exist on
`toast_connections`, `shift4_connections`, `focus_connections`, and
`revel_connections` — verified on production. No new table, per the decision to
reuse an existing mechanism.

The write is reliable inside the handler: a plpgsql `EXCEPTION` block is a
subtransaction, so once `query_canceled` is caught the rollback to the savepoint
completes and the handler runs with a fresh statement budget. It does **not**
run on `pg_terminate_backend`/SIGTERM, or if the outer `cron.schedule` statement
itself is cancelled; those remain visible only in `cron.job_run_details`, which
is acceptable. `SET LOCAL statement_timeout = '5s'` guarantees the bookkeeping
can never itself hang.

`square_connections` and `clover_connections` lack these columns — out of
scope. Revel is driven from the `revel-bulk-sync` edge function (pg_cron jobid
40) rather than a `sync_all_*` wrapper, so it has no plpgsql handler to patch;
its error surfacing is the edge function's concern and is out of scope.

### 3.8 Revel correctness fix

Add the missing sweep call to `sync_revel_to_unified_sales`, mirroring Toast —
after the suppression flag is cleared at
[line 382](../../../supabase/migrations/20260721160000_revel_rpc_sold_at_self_heal.sql#L382)
and before the existing batch re-aggregation:

```sql
PERFORM public.apply_rules_to_pos_sales_internal(p_restaurant_id, 10000);
```

Sourced from `20260721160000_revel_rpc_sold_at_self_heal.sql` (the latest
definition, confirmed against production via `pg_get_functiondef`).

### 3.9 No backfill block

Existing rows default to `'-infinity'` and drain at `p_batch_limit` per run.
Home's 51,366 rows clear in ~6 runs (≈30 minutes at `*/5`). A backfill `DO`
block inside the migration would risk the 2-minute statement timeout that
already rolled back a migration in this repo
([`…20260703090000…sql:888`](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql#L888)).

### 3.10 Cron cadence unchanged

Deliberate. The docs, however, drifted and should be corrected alongside:

| Claim | Where | Production |
|---|---|---|
| "`toast-bulk-sync` — Scheduled sync (cron, every 6 hours)" | [`docs/INTEGRATIONS.md:272`](../../../docs/INTEGRATIONS.md#L272) | jobid 7, `0 0,2,4,…,22 * * *` — every **2** hours |
| "Cron runs every 6 hours - all restaurants eventually get synced" | `CLAUDE.md` (Toast §Scale Considerations) | same as above |
| — | neither doc | jobid 4 `toast-unified-sales-sync`, `*/5 * * * *` — the job this design fixes, undocumented |

---

## 4. Migration files

Ordered; today is 2026-08-03 and the latest existing prefix is
`20260803100000`, so these start at `20260804`. Prefixes must be unique —
Supabase keys `schema_migrations` on the 14-digit prefix alone.

| File | Contents |
|---|---|
| `20260804090000_rules_evaluated_at_columns.sql` | both `ADD COLUMN`s, both reset trigger functions + triggers, `NOTIFY pgrst, 'reload schema'` |
| `20260804090100_idx_unified_sales_rule_candidates_v2.sql` | CIC only |
| `20260804090200_idx_bank_transactions_rule_candidates_v2.sql` | CIC only |
| `20260804090300_bounded_categorization_sweep.sql` | `CREATE OR REPLACE` both internal functions |
| `20260804090400_pos_sync_failure_visibility.sql` | `record_pos_sync_error()` helper **and its `REVOKE`/`GRANT`** (§3.7 — same file as the `CREATE`, non-negotiable), four `sync_all_*` wrappers (`query_canceled` arm + error recording), Revel sweep call |
| `20260804090500_drop_superseded_rule_candidate_indexes.sql` | `DROP INDEX CONCURRENTLY IF EXISTS` ×2, own file each statement |

**`CREATE OR REPLACE FUNCTION` is a full-body rewrite.** Every recreated
function must be copied from its *latest* definition — the one sorting last
before the new migration — not from the first one that defines the name. This
repo has three recorded incidents of silent feature reversion from getting this
wrong. Sources, all verified against production `pg_get_functiondef`:

| Function | Copy source |
|---|---|
| `apply_rules_to_pos_sales_internal` | `20260703090000…sql:300` |
| `apply_rules_to_bank_transactions_internal` | `20260703090000…sql:483` |
| `sync_revel_to_unified_sales` | `20260721160000…sql:177` |
| `sync_all_toast_to_unified_sales` | `20260216120000…sql:28` (**not** `20260127000000…sql:511`) |
| `sync_all_shift4_to_unified_sales` | `20260127100000…sql:49` |
| `sync_all_focus_to_unified_sales` | `20260705003631…sql` |
| `sync_all_focus_transactions_to_unified_sales` | `20260703120000…sql` |

⚠️ `sync_toast_to_unified_sales`, `_sync_focus_to_unified_sales_impl`, and
`_sync_focus_transactions_to_unified_sales_impl` were patched **in place** by a
`DO` block at
[`…20260703090000…sql:840`](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql#L840),
so their live bodies differ from every migration file. This design does not
modify them — but if that changes, the body must be sourced from
`pg_get_functiondef` on production, never from a migration file.

---

## 5. Testing

pgTAP (`supabase/tests/`):

1. Uncategorized row matching no rule is stamped after one sweep, and is **not**
   re-evaluated by a second sweep (the core assertion — assert on
   `rules_evaluated_at`, and on the sweep's `total_count` being 0 the second
   time).
2. Inserting a new active `auto_apply` rule re-opens previously stamped rows.
3. Editing an existing rule (which bumps `updated_at`) re-opens them.
4. Deactivating a rule does not re-open them, and does not cause a missed match.
5. Restaurant with zero active rules: sweep returns `(0, 0)` and writes nothing.
6. Changing `item_name` / `total_price` / `pos_category` resets the stamp to
   `-infinity`; changing any other column does not.
7. **The §3.3 stamping `UPDATE` does not reset its own stamp** (§3.5 coincidence).
8. **The sweep does not fire `trigger_unified_sales_to_daily` per row** — assert
   `daily_sales.updated_at` is unchanged when the sweep applies zero rows, and
   that a sweep applying rows produces the same `daily_sales.gross_revenue` as
   the pre-change behaviour.
9. Split-rule branch still splits correctly and the parent's date is
   re-aggregated once.
10. Watermark tie boundary: a rule whose `created_at` exactly equals the stamp
    is documented as not re-opening (pins §3.2's accepted limitation).
11. Bank equivalents of 1, 2, and 6.
12. `p_batch_limit` validation still raises for `NULL`, `0`, and negatives.
13. **`query_canceled` isolation** — with a `sync_all_*` wrapper whose inner
    call is forced to time out (`SET LOCAL statement_timeout = '1ms'`), the run
    completes, the failing restaurant's connection row shows
    `connection_status = 'error'` with a populated `last_error`, and the
    *following* restaurant in the loop still syncs. This is the assertion that
    fails against today's code.
14. A restaurant that syncs cleanly after a prior failure has
    `connection_status`/`last_error`/`last_error_at` cleared.
15. **`record_pos_sync_error` is not callable by `anon` or `authenticated`** —
    `SET LOCAL ROLE anon`, expect `throws_ok` with `42501`; same for
    `authenticated`; `has_function_privilege('service_role', …, 'EXECUTE')` is
    true. Guards the §3.7 cross-tenant-write hole against a future migration
    re-granting by omission.

Plan-shape check: `EXPLAIN` the §3.3 statement and assert the matcher's
`loops` equals the batch size, not the candidate count.

Verification on production after deploy (read-only):
`SELECT mean_exec_time FROM cron.job_run_details` for jobid 4 before/after, and
`count(*) FILTER (WHERE rules_evaluated_at = '-infinity')` per restaurant
trending to zero over ~6 runs.

---

## 6. Risk and rollback

- **Highest risk** is the trigger-suppression change in §3.4 — it alters when
  `daily_sales` is recomputed. Mitigated by test 8 and by the fact that
  `aggregate_unified_sales_to_daily` provably ignores `category_id`.
- **Rollback** is `CREATE OR REPLACE` back to the prior function bodies. The
  column and triggers can stay: with the old function bodies they are inert.
  This is why the old indexes are dropped in a separate, last migration.
- **No data migration**, so nothing to undo.

---

## 7. Out of scope (found, deliberately not fixed here)

1. **`sling-bulk-sync` (jobid 20) and `bank-reauth-notices` (jobid 41) fail
   100% of runs** — 645 and 10 all-time — with
   `ERROR: unrecognized configuration parameter "app.settings.supabase_url"`.
   Sling ingestion has never once succeeded. Neighbouring jobs hardcode the
   project URL. Separate fix.
2. **`auto_apply_pos_split_rules` does not honour `app.skip_unified_sales_triggers`**
   (unlike `auto_apply_pos_categorization_rules` and
   `trigger_unified_sales_aggregation`), so split rules fire during bulk syncs
   while plain rules do not. Inconsistent, but not a regression introduced here.
   **Schema drift:** this claim is verified against the live production body via
   `pg_get_functiondef`, not a migration file — `auto_apply_pos_split_rules`,
   `auto_apply_bank_split_rules`, `apply_split_rule_to_pos_sale`, and
   `apply_split_rule_to_bank_transaction` exist in production with **no
   defining migration anywhere in `supabase/migrations/`** (exhaustive grep
   returns zero hits). That is a second instance of the drift class §4 warns
   about: any future `CREATE OR REPLACE` of these four has no in-repo source to
   copy from and must be sourced from `pg_get_functiondef`. §3.4's equivalence
   table depends on one of them, which is why it cites production rather than a
   file. Reconciling them into a migration is its own task.
3. **`daily_sales` double-counts split sales.**
   `aggregate_unified_sales_to_daily` sums all rows with
   `adjustment_type IS NULL` and excludes neither split parents nor their
   children; production has 49 split parents and 56 children, all counted.
   Pre-existing, small blast radius, orthogonal.
4. **`lighthouse` has 7,967 uncategorized rows** but no ingestion since Dec
   2025 — dormant integration.
5. **`square_connections` / `clover_connections` lack error columns**, so §3.7
   cannot extend to them without new columns.
