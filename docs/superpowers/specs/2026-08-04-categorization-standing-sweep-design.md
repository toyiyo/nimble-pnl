# Standing Categorization Sweep — Design

**Date:** 2026-08-04
**Branch:** `fix/categorization-standing-sweep`
**Status:** Proposed

## Problem

Categorization has two mechanisms and no owner. Neither one ever revisits a row
after that row's single chance to be evaluated, so any row inserted before its
matching rule existed stays uncategorized forever.

### Mechanism 1 — the insert-time trigger (one shot per row)

`auto_categorize_pos_sale` is a `BEFORE INSERT` trigger on `unified_sales`
([20251111000000_enhanced_categorization_rules.sql:554-558](../../../supabase/migrations/20251111000000_enhanced_categorization_rules.sql:554))
running `auto_apply_pos_categorization_rules()`
([20251111000000_enhanced_categorization_rules.sql:505](../../../supabase/migrations/20251111000000_enhanced_categorization_rules.sql:505)).
It fires exactly once, at insert. A rule created tomorrow never sees the rows
inserted today.

### Mechanism 2 — the batch sweep (only some callers invoke it)

`apply_rules_to_pos_sales_internal(p_restaurant_id uuid, p_batch_limit integer)`
([20260804090300_bounded_categorization_sweep.sql:130-139](../../../supabase/migrations/20260804090300_bounded_categorization_sweep.sql:130))
claims a batch of candidates with `FOR UPDATE SKIP LOCKED`, evaluates them, and
stamps `rules_evaluated_at`. Four sync functions call it inline, immediately
after suppressing the insert trigger via `app.skip_unified_sales_triggers`:

| Caller | Location |
|---|---|
| `sync_toast_to_unified_sales` (both overloads) | prod `pg_get_functiondef`, confirmed 2026-08-04 |
| `sync_focus_to_unified_sales` impl | prod `pg_get_functiondef`, confirmed 2026-08-04 |
| `sync_focus_transactions_to_unified_sales` impl | prod `pg_get_functiondef`, confirmed 2026-08-04 |
| `sync_revel_to_unified_sales` | [20260804090400_pos_sync_failure_visibility.sql:546](../../../supabase/migrations/20260804090400_pos_sync_failure_visibility.sql:546) |

Every other write path into `unified_sales` — square, clover, shift4,
lighthouse, manual_upload, manual — relies on Mechanism 1 alone. Notably
`sync_all_toast_to_unified_sales()`
([20260804090400_pos_sync_failure_visibility.sql:72](../../../supabase/migrations/20260804090400_pos_sync_failure_visibility.sql:72))
and `sync_all_shift4_to_unified_sales()`
([20260804090400_pos_sync_failure_visibility.sql:141](../../../supabase/migrations/20260804090400_pos_sync_failure_visibility.sql:141))
do **not** call the sweep themselves; coverage comes from the per-restaurant
function the Toast wrapper calls, and Shift4 has no such call anywhere.

### `bank_transactions` — one conditional driver, no cron

`apply_rules_to_bank_transactions_internal` is invoked from exactly one place,
[stripe-sync-transactions/index.ts:386](../../../supabase/functions/stripe-sync-transactions/index.ts:386),
and it sits inside `if (syncedCount > 0)`
([stripe-sync-transactions/index.ts:376](../../../supabase/functions/stripe-sync-transactions/index.ts:376)).
A restaurant whose Stripe sync returns no new transactions never has its
existing backlog swept. There is no pg_cron job for it.

### The one universal driver retired itself

`drain_categorization_backlog()`
([20260804090700_categorization_watermark_and_drain_convergence.sql:81](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:81))
sweeps both tables for every restaurant that has an active auto-apply rule
(POS loop [:102-144](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:102),
bank loop [:147-193](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:147)).
It is the only mechanism that is not tied to a sync path — and it deletes its
own pg_cron job on a converged pass
([:215-249](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:215),
`PERFORM cron.unschedule(...)` at
[:247](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:247)).
That was deliberate: it was designed as a one-shot backfill, scheduled at
[20260703090000_categorization_background_and_supplier_assign.sql:1056](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql:1056)
with the comment "The job deletes itself … once converged".

It ran 4 times and retired on 2026-07-04. It is absent from prod's `cron.job`
today (verified against production 2026-08-04; the 15 remaining jobs include no
`categorization-backlog-drain` and no clover job at all).

### Measured impact (production, 2026-08-04)

| Scope | Stranded candidates |
|---|---|
| `bank_transactions` | 3,351 across 8 restaurants, against 274 active auto-apply bank rules |
| `unified_sales` | 9,333 unevaluated, spread over lighthouse (7,967), manual_upload (955), square (185), toast (153), clover (37), manual (36) |

## Approach

**Stop retiring the drain. Schedule it permanently at `*/5 * * * *`.**

This is one change, and it fixes bank and every POS at once, because the sweep
selects candidates by `restaurant_id` and watermark with **no `pos_system`
predicate**
([20260804090300_bounded_categorization_sweep.sql:130-139](../../../supabase/migrations/20260804090300_bounded_categorization_sweep.sql:130)),
and the drain selects restaurants by *rule*, not by connection table
([20260804090700:102-108](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:102)).
A POS integration added next year inherits categorization the moment its rows
land in `unified_sales` — no per-POS wiring, no new cron job. That is the
codified pattern.

### Why retirement was worth removing

Retirement bought one thing: not paying for a converged tick. That cost is now
near zero. The negative-result cache shipped in PR #693
(`rules_evaluated_at`, [20260804090300](../../../supabase/migrations/20260804090300_bounded_categorization_sweep.sql))
means a converged tick reads no candidates at all — production's Toast rollup
went from 10.992s to 0.719–0.834s after that deploy. Against that, retirement
costs correctness permanently and silently: the moment a user creates a rule
after the job has retired, nothing re-evaluates their history.

### Decisions taken

1. **Cadence `*/5 * * * *`.** Matches the four existing POS rollups — jobids 4,
   6, 30 and 38 all run `*/5` (prod `cron.job`, confirmed 2026-08-04). A user
   who creates a rule sees their history recategorized within five minutes.
2. **Keep the four inline sweep calls.** They are not redundant with the
   standing job — those callers suppress the insert trigger, so the inline call
   is what categorizes their rows *in the same transaction*. Removing them
   would introduce up to a 5-minute window where freshly synced Toast/Focus/
   Revel rows show uncategorized. The standing job becomes the safety net, not
   the mechanism.
3. **Codify with a pgTAP conformance test**, not with prose. A doc telling
   future integrators to "remember to call the sweep" is exactly the failure
   mode we are fixing. The test asserts the structural properties that make
   coverage automatic.

## Changes

### 1. Migration — `drain_categorization_backlog()` never retires

`CREATE OR REPLACE FUNCTION public.drain_categorization_backlog()` restating the
full body from
[20260804090700:81-257](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:81)
with one edit: the `IF v_claimed = 0 AND … THEN cron.unschedule(…)` block
([:215-249](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:215))
is replaced by an unconditional `RAISE LOG` of the tick outcome.

Everything else is preserved verbatim: `SECURITY DEFINER`,
`SET search_path = pg_catalog, public`, `SET statement_timeout = '120s'`, the
40-second soft budget, the POS loop (2 × 5000) and bank loop (5 × 1000 with
`p_skip_rebuild => true` plus one `rebuild_account_balances` per restaurant per
tick), and the explicit `WHEN query_canceled` handlers — `WHEN OTHERS` does not
catch SQLSTATE 57014.

The `NOT EXISTS (… leftover …)` subquery at
[:219-244](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:219)
existed **only** to gate retirement. With retirement gone it has no consumer, so
it is deleted — which also removes a per-tick cross-join probe over both tables
for every restaurant with an active rule. Net effect: a converged tick gets
cheaper, not more expensive.

One addition, not a removal: both restaurant loops
([:102-108](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:102),
[:147-152](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:147))
currently do `FOR r IN SELECT DISTINCT cr.restaurant_id … ` with no `ORDER BY`,
so the planner's row order decides who gets swept first. That is harmless for a
job that retires; for a permanent job it is structural starvation — if the
40-second budget is ever exhausted mid-tick, the restaurants the planner
happens to return last are skipped on *every* tick, forever. Both loops gain
`ORDER BY random()`, which costs nothing on a set this small (one row per
restaurant with an active auto-apply rule) and gives every restaurant equal
expected coverage per tick. A deterministic round-robin would need a
last-swept column, i.e. a schema change, for no additional guarantee. Loop
order is not observable by any assertion, so this does not make the pgTAP tests
non-deterministic.

The function keeps its name. Renaming would mean `DROP FUNCTION` + recreate,
plus edits to the cron command, the pgTAP fixtures, and the generated
`src/integrations/supabase/types.ts` — churn with no behavioural gain. "Drain
the categorization backlog" still describes what a tick does; only its lifetime
changes. The `COMMENT ON FUNCTION`
([:259](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:259))
is rewritten to state the new contract explicitly: standing job, never retires,
POS-agnostic by construction, covers `bank_transactions` too.

`REVOKE ALL … FROM PUBLIC, anon, authenticated` / `GRANT EXECUTE … TO
service_role`
([:272-273](../../../supabase/migrations/20260804090700_categorization_watermark_and_drain_convergence.sql:272))
are re-asserted, because `CREATE OR REPLACE` on a function that was dropped and
recreated in some environments would otherwise inherit default ACLs.

### 2. Migration — schedule the standing job

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'categorization-backlog-drain') THEN
    PERFORM cron.unschedule('categorization-backlog-drain');
  END IF;
  PERFORM cron.schedule(
    'categorization-backlog-drain',
    '*/5 * * * *',
    'SELECT public.drain_categorization_backlog()'
  );
END $$;
```

Unschedule-then-schedule converges from either starting state: prod, where the
job is absent because it retired itself, and any environment where it still
exists on a different schedule. Same shape as the original schedule block at
[20260703090000:1048-1060](../../../supabase/migrations/20260703090000_categorization_background_and_supplier_assign.sql:1048).

No backfill `DO` block. The 12,684 stranded rows drain on the normal ticks:
POS at 10,000/restaurant/tick and bank at 5,000/restaurant/tick clears the
current backlog within the first one or two ticks per restaurant, inside the
40-second budget the function already enforces.

### 3. Conformance test — `supabase/tests/51_standing_categorization_sweep.sql`

The codification. Four properties, each of which would have caught a real bug:

1. **The standing job exists on `*/5 * * * *`.** Catches a migration that
   replaces the function but forgets the schedule.
2. **`pg_get_functiondef(drain_categorization_backlog)` contains no
   `cron.unschedule`.** Structural, not behavioural — it pins that the drain can
   never again acquire the ability to retire, whatever the tick outcome.
3. **`pg_get_functiondef(apply_rules_to_pos_sales_internal)` contains no
   `pos_system` reference.** This is the property that makes future POS
   integrations free. If someone adds `AND s.pos_system = 'toast'` as an
   optimization, this test fails and explains why.

   Both text assertions strip SQL comments before matching:

   ```sql
   regexp_replace(
     regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
     '--[^\n]*', '', 'g')
   ```

   Without stripping, the tests punish exactly the behaviour this codebase
   rewards. `20260804090300_bounded_categorization_sweep.sql` explains its own
   invariants in long prose comments
   ([:116-129](../../../supabase/migrations/20260804090300_bounded_categorization_sweep.sql:116)),
   and the migration written for *this* design will carry a comment saying "do
   not add a `pos_system` filter here" — which would fail an unstripped match on
   its own warning.

   Text matching also cannot see a filter expressed some other way (a join
   against a connection table, say). Assertion 4 is the behavioural twin that
   catches those; 3 catches the literal predicate with a message that names the
   reason. They are kept as a pair, not as alternatives.
4. **A row with an unrecognized `pos_system` is swept.** The behavioural twin of
   (3): insert a `unified_sales` row with `pos_system = 'future_pos'` — a value
   no sync function, connection table, or edge function knows about — plus a
   matching rule, run one tick, assert the row is categorized. This proves a
   hypothetical future POS is covered with zero integration work.

Plus regression coverage for the two paths that were broken:

5. A converged tick leaves the job scheduled (the inverse of the 2026-07-04
   strand).
6. A `bank_transactions` candidate with an active auto-apply bank rule is
   categorized by a drain tick.

### 4. Invert the tests that pin the old semantics

`supabase/tests/50_categorization_backlog_drain.sql` currently asserts
retirement in three places and must be updated, not deleted — an old test that
pins removed behaviour is the cheapest possible regression guard once inverted:

| Test | Current assertion | Change |
|---|---|---|
| 6 ([:76-80](../../../supabase/tests/50_categorization_backlog_drain.sql:76)) | "a converged (complete + clean + 0-row) tick unschedules the drain job" | Invert: a converged tick **keeps** the job scheduled |
| 9 ([:167-173](../../../supabase/tests/50_categorization_backlog_drain.sql:167)) | "a tick with a backlog waiting does not retire the drain job" | Unchanged — still true, still meaningful |
| 10 ([:175-183](../../../supabase/tests/50_categorization_backlog_drain.sql:175)) | "once every candidate is evaluated the drain still retires itself" | Invert: the job survives an exhausted backlog |

The re-arm block at
[:148-159](../../../supabase/tests/50_categorization_backlog_drain.sql:148)
becomes dead once test 6 no longer retires the job; it is removed. The file
header ([:1-25](../../../supabase/tests/50_categorization_backlog_drain.sql:1))
describes the self-retire lifecycle and its live-cron race caveat, and is
rewritten to match. Tests 1–5 and 7–8 (existence, schedule, the two ACL
assertions, the empty-database tick, and the two watermark assertions) are
unaffected.

The one comment that **must survive verbatim** is the statement-snapshot warning
at [:161-165](../../../supabase/tests/50_categorization_backlog_drain.sql:161):
each tick runs as its own statement, never folded into the assertion, because an
outer scan of `cron.job` cannot see a `cron.unschedule()` performed by a
volatile function called in the same command. That hazard caused a real pgTAP
failure on PR #693 and still applies to any test that reads `cron.job` after
calling the drain.

## What this does not change

- **No schema change.** No new column, index, or table.
- **No edge function change.** `stripe-sync-transactions`' conditional sweep at
  [index.ts:376](../../../supabase/functions/stripe-sync-transactions/index.ts:376)
  stays as-is; it is now a fast path in front of the standing job rather than
  the only path.
- **No change to the four inline sweep calls** (decision 2).
- **No new cron job.** The existing job name is reused.
- **No UI, route, hook, or component change.**

## Risks

**A standing job that always finds work would run every 5 minutes forever.**
Bounded by construction: the function already carries
`SET statement_timeout = '120s'` and a 40-second soft budget that breaks out of
both loops, so a tick cannot overlap the next one badly. Post-deploy
verification (below) confirms ticks settle back to sub-second once the backlog
clears.

**Overlapping ticks are survivable.** pg_cron does not serialize runs of the
same job, so a 120s-timeout tick on a 300s cadence could in principle overlap a
successor. Nothing corrupts if it does: the sweeps claim candidates with
`FOR UPDATE SKIP LOCKED`, so two ticks partition the backlog rather than
duplicating work, and `rebuild_account_balances` is an idempotent recompute
(`current_balance = compute_account_balance(id)`, not an increment —
[20251019021231_942cf575-c06d-491f-9f5f-77c57b85d1a2.sql:61-84](../../../supabase/migrations/20251019021231_942cf575-c06d-491f-9f5f-77c57b85d1a2.sql:61)).
The cost of overlap is redundant work and brief row-lock waits.

**The watermark ⊇ matcher invariant still governs correctness.** The drain's
restaurant selection filters on `is_active AND auto_apply`, while
`categorization_rules_watermark` deliberately filters on `is_active` +
`applies_to` only, because the matchers ignore `auto_apply`. A watermark
narrower than the matcher's rule set is a silent permanent missed match. This
design touches neither predicate, and test 7 in
[50_categorization_backlog_drain.sql:112-120](../../../supabase/tests/50_categorization_backlog_drain.sql:112)
continues to pin it.

**"Cron ticks succeeded" is not evidence.** On 2026-07-05 a scheduler change
passed five reviewers, Codex, CodeRabbit, 19 pgTAP tests and full CI, and was
caught only by prod verification minutes after deploy. Post-deploy we must
confirm rows are actually being *selected*, not just that the job ran:
`cron.job` contains the job, `cron.job_run_details` shows succeeded ticks, and
the counts of unevaluated candidates in `bank_transactions` and `unified_sales`
(grouped by `pos_system`) are falling toward zero.

## Testing

- **pgTAP:** new `supabase/tests/51_standing_categorization_sweep.sql`; updated
  `supabase/tests/50_categorization_backlog_drain.sql`. Run via
  `npm run test:db`.
- **Fixtures:** the `bbbbbbbb-0000-…` namespace is already taken by
  50's "Drain Guard Restaurant"
  ([:91-110](../../../supabase/tests/50_categorization_backlog_drain.sql:91)).
  51 uses a distinct namespace, grep-verified unused across `supabase/tests/`
  before adoption.
- **E2E:** none. The seam is a pg_cron-driven SQL function with no user-facing
  route, dialog, or flow change; Playwright cannot drive pg_cron. pgTAP is the
  correct level.
- **Post-deploy prod verification:** as described under Risks, within minutes of
  the migration landing.
