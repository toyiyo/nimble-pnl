# POS Sales — stale "Uncategorized" badge — implementation plan

- **Design:** `docs/superpowers/specs/2026-05-23-pos-sales-categorized-badge-design.md`
- **Branch:** `fix/pos-sales-categorized-badge`
- **Worktree:** `.claude/worktrees/pos-sales-categorized-badge`
- **Triage:** `sig:539980c1fe88`

## Step 0 — Setup

Already done: worktree created off `main`, design doc committed, Phase 2.5
review feedback folded into the design.

## Step 1 — Migration + pgTAP first (TDD, server side)

1. Write `supabase/migrations/<ts>_unified_sales_totals_categorization_counts.sql`:
   - `CREATE OR REPLACE FUNCTION public.get_unified_sales_totals(UUID, DATE, DATE, TEXT)`
   - Same parameters, same body, same `SECURITY DEFINER` + `auth.uid()` guard.
   - Extended `RETURNS TABLE (... uncategorized_count BIGINT, pending_review_count BIGINT)`.
   - Two new aggregations:
     - `COUNT(*) FILTER (WHERE us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NULL)::BIGINT AS uncategorized_count`
     - `COUNT(*) FILTER (WHERE us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NOT NULL)::BIGINT AS pending_review_count`
   - Inherits the `parent_sale_id IS NULL` filter and date/search predicates
     already in the function — no extra `WHERE` work.
   - Comment in the migration header noting that `GRANT EXECUTE` from
     `20260123001310_…` carries forward because the input-parameter signature
     is unchanged.

2. Write `supabase/tests/36_get_unified_sales_totals_categorization_counts.sql`:
   - Distinct restaurant UUID (ending `…0098`) to avoid colliding with the
     `…0099` fixture used in `35_…`.
   - `SELECT plan(N)` covering:
     1. Returns `0`/`0` on empty fixture.
     2. `is_categorized = false AND suggested_category_id IS NULL` → counted in `uncategorized_count`.
     3. `is_categorized IS NULL AND suggested_category_id IS NULL` → also counted in `uncategorized_count` (legacy null rows).
     4. `is_categorized = false AND suggested_category_id IS NOT NULL` → counted in `pending_review_count`, NOT in `uncategorized_count`.
     5. `is_categorized = true` → excluded from both counts.
     6. `parent_sale_id IS NOT NULL` (child split) → excluded from both.
     7. `p_start_date` / `p_end_date` honoured by both counts.
     8. Non-member call → `RAISE EXCEPTION 'Access denied to restaurant'` (lives_ok / throws_ok).
   - Use `BEGIN; SELECT plan(N); …; SELECT * FROM finish(); ROLLBACK;` per
     CLAUDE.md.

3. `npm run db:reset` locally, then `npm run test:db` to confirm both
   `35_…` and `36_…` pass.

## Step 2 — TypeScript types

4. Regenerate Supabase types (project convention is to commit them):
   `npx supabase gen types typescript --linked > src/integrations/supabase/types.ts`
   (or whatever the existing types path is — verify via `find src -name 'types.ts' | grep supabase`).

## Step 3 — Hook surface

5. Update `src/hooks/useUnifiedSalesTotals.tsx`:
   - Extend `SalesTotals` with `uncategorizedCount: number` and `pendingReviewCount: number`.
   - Map them from the RPC result in the `queryFn`:
     `uncategorizedCount: Number(result?.uncategorized_count ?? 0)` /
     `pendingReviewCount: Number(result?.pending_review_count ?? 0)`.
   - Add `0` defaults to both fallback shapes (the early-return when
     `!restaurantId` and the `data ??` shape returned to callers).
   - Keep `staleTime: 30000` unchanged.

6. Add unit test `tests/unit/useUnifiedSalesTotals.test.ts` (new file unless
   one already exists for this hook):
   - Mock `supabase.rpc('get_unified_sales_totals', …)` to resolve with one
     row including `uncategorized_count: 3, pending_review_count: 1`.
   - Render the hook with `renderHook` + a React Query client.
   - Assert `result.current.totals.uncategorizedCount === 3` and
     `.pendingReviewCount === 1`.
   - Second test: `restaurantId = null` → `totals` is the zero-default shape.

## Step 4 — POSSales.tsx rewire

7. Edits to `src/pages/POSSales.tsx`:
   - Delete the `uncategorizedSalesCount` `useMemo` (lines 323-327). Keep the
     `suggestedSales` list `useMemo` (still used for rendering, just not for
     the count badge or its visibility).
   - In the destructure of `useUnifiedSalesTotals`, also pull `isLoading` (it's
     already pulled as `totalsLoading`). No new variable needed.
   - At the AI card (around line 871-938):
     - Button `disabled`:
       `disabled={isCategorizingPending || (!totalsLoading && serverTotals.uncategorizedCount === 0)}`
     - "Uncategorized" badge text becomes `<span className="tabular-nums">{serverTotals.uncategorizedCount}</span> uncategorized`.
     - "Pending review" badge visibility moves to
       `serverTotals.pendingReviewCount > 0` (was `suggestedSales.length > 0`).
     - "Pending review" badge text becomes `<span className="tabular-nums">{serverTotals.pendingReviewCount}</span> pending review`.
   - At the segmented control (lines 1023-1053):
     - The `count` props on the `Uncategorized` and `Pending Review` buttons
       become `serverTotals.uncategorizedCount` and
       `serverTotals.pendingReviewCount` respectively.
     - Wrap the count `<span>` (line 1044) with `tabular-nums` and add
       `aria-label={\`${option.count} ${option.label}\`}` for screen readers.

8. Add source-text regression test `tests/unit/posSalesCategorizationBadgeSource.test.ts`:
   - Positive: `/serverTotals\.uncategorizedCount/` appears
   - Positive: `/serverTotals\.pendingReviewCount/` appears
   - Positive: `/serverTotals\.pendingReviewCount\s*>\s*0/` appears (badge visibility)
   - Positive: `/!totalsLoading\s*&&\s*serverTotals\.uncategorizedCount\s*===\s*0/` appears (button gate)
   - Negative: `/sales\.filter\(sale => !sale\.is_categorized && !sale\.suggested_category_id\)/` does NOT appear
   - Negative: the `suggestedSales.length > 0` substring does NOT appear in the file

## Step 5 — Cache invalidation in the three mutation hooks

9. `src/hooks/useCategorizePosSale.tsx` — add
   `queryClient.invalidateQueries({ queryKey: ['unified-sales-totals'] })`
   inside `onSuccess`.

10. `src/hooks/useCategorizePosSales.tsx` — same addition in `onSuccess`.

11. `src/hooks/useBulkPosSaleActions.tsx` — locate the bulk-categorize mutation
    `onSuccess` and add the same invalidation. (Verify file path; the hook is
    imported in POSSales.tsx as `useBulkCategorizePosSales`.)

12. Source-text test `tests/unit/posCategorizationInvalidationSource.test.ts`:
    For each of the three hook files, assert the regex
    `/queryClient\.invalidateQueries\(\{\s*queryKey:\s*\['unified-sales-totals'\]\s*\}\)/`
    matches at least once.

## Step 6 — Local CI gate

13. Run sequentially:
    - `npm run typecheck` — must pass
    - `npm run lint` — must pass (allow auto-fix only if `--fix` is needed for trivial whitespace)
    - `npm run test` — full Vitest pass
    - `npm run test:db` — pgTAP green for both `35_` and `36_`
    - `npm run build` — production build clean

14. If any gate fails, fix the underlying issue (not the test) and re-run.

## Step 7 — UI spot-check (manual)

15. `npm run dev:full` and open `/pos-sales`. Confirm:
    - On first load with a paginated 30d window, badge matches `SELECT count(*) FROM unified_sales WHERE restaurant_id = $1 AND is_categorized IS NOT TRUE AND suggested_category_id IS NULL` for the same date range.
    - Categorize one sale via the inline dropdown → uncategorized count decrements; pending review may also shift.
    - Bulk AI categorize → counts drop to 0 (or remaining server count) without manual reload.
    - Switching the segmented control to "Categorized" — the "Uncategorized" pill's adjacent count remains a global server count (badge is intentionally not scoped to the filter selection — it represents the actionable total).

## Step 8 — Phase 6+ — code-simplifier, multi-reviewer, push

16. Phase 6: run `code-simplifier` sub-agent on the diff.
17. Phase 7a: spawn 4 reviewers in parallel (security, sound-logic, maintainability, performance) + Codex adversarial in background. Address any HIGH-CONFIDENCE finding.
18. Phase 8: re-run CI gate (Step 6) after every reviewer-driven change.
19. Phase 9: push, open PR with anonymized body — title `fix(pos-sales): badge counts now come from server (sig:539980c1fe88)`, body references the triage signature trailer.
20. Watch CI; triage any review comments (hard gate per project workflow).
21. Phase 10: append lesson to `memory/lessons.md` only if there's a non-trivial
    learning (likely: "paginated client filter as a count source is a quiet
    correctness bug — for any 'N of X' badge, prefer the same server
    aggregation that already backs sibling metrics on the same page").

## Risks / rollback

- **Function signature change.** `CREATE OR REPLACE` extending `RETURNS TABLE`
  with new columns is backwards-compatible in Postgres for callers that pull
  by name; the existing `useRevenueBreakdown` and `useMonthlyMetrics` callers
  ignore the new columns by virtue of mapping individual properties from the
  RPC result row. No code change to those hooks.
- **Type regen drift.** If `supabase gen types` produces an unrelated diff
  (e.g. some new column elsewhere in the schema picked up), trim it down to
  just `get_unified_sales_totals` in this PR.
- **Rollback** is a one-migration revert — re-issue the prior
  `CREATE OR REPLACE FUNCTION` with the old `RETURNS TABLE` shape. The client
  rewire continues to compile because `useUnifiedSalesTotals` would receive
  `undefined` for the new columns and `Number(undefined ?? 0)` = `0`. Badge
  silently goes back to "always zero" — not catastrophic, but not the bug
  being fixed either.

---
sig:539980c1fe88
