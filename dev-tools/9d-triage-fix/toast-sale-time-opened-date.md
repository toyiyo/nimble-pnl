# Phase 9d Triage — PR #529 (fix/toast-sale-time-opened-date)

**Commit at start of phase:** `91c6456bcac720091006413208f5fed3d2c3d4b0`
**Fix commit:** `655d93a40d0e9ea39c2a9743c3b83d4f00f8a29a`
**Pushed:** yes

---

## Inline review comments (gh api pulls/529/comments)

| ID | Author | File | Line | Classification | Action |
|----|--------|------|------|----------------|--------|
| 3327853204 | coderabbitai[bot] | `docs/superpowers/plans/...md` | 15 | **nit** — markdownlint MD001 heading jump H1→H3 | Fixed: changed `###` to `##` |
| 3327853206 | coderabbitai[bot] | `progress.md` | 10 | **nit** — markdownlint MD058 blank line before table | Fixed: added blank line before table |
| 3327853208 | coderabbitai[bot] | `progress.md` | 93 | **nit** — "github.com" capitalization | Fixed: changed to "GitHub.com" |
| 3327853209 | coderabbitai[bot] | `supabase/migrations/...sql` | 45 | **bug/correctness** — `clock_timestamp()` vs `NOW()` mismatch causes rows written in the transaction to potentially be excluded from `aggregate_unified_sales_to_daily` (because `synced_at >= v_sync_start` can be false when `v_sync_start = clock_timestamp()` which may lag `NOW()`) | **Fixed:** `clock_timestamp()` → `NOW()` in migration |
| 3327853213 | coderabbitai[bot] | `supabase/migrations/...sql` | 115 | **bug/correctness** — regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}` doesn't require timezone designator; offset-less strings would be cast using PostgreSQL session TimeZone, breaking the "absolute UTC instant" contract | **Fixed:** regex upgraded to `'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$'` at all 10 sites (8 COALESCE blocks in both overloads + backfill DO block + 4 `closedDate IS NOT NULL` → regex-guarded sale_time CASEs) |
| 3327853215 | coderabbitai[bot] | `supabase/tests/39_unified_sales_sold_at.sql` | 77 | **bug/correctness** — hard-coded fixture date `'2026-05-29'` expires outside 90-day backfill window on 2026-08-27; TEST 12 will fail despite correct migration | **Fixed:** all order_date literals replaced with `(CURRENT_DATE - INTERVAL '1 day')::date`; sync call date args and TEST 10 assertion updated accordingly; backfill regex also upgraded to match migration |

## PR conversation comments (gh api issues/529/comments)

| ID | Author | Classification | Action |
|----|--------|----------------|--------|
| 4581245386 | netlify[bot] | **info** — deploy preview ready | Read only |
| 4581245430 | vercel[bot] | **info** — vercel deploy | Read only |
| 4581245813 | supabase[bot] | **info** — supabase preview branch deployed | Read only |
| 4581245871 | coderabbitai[bot] | **info** — walkthrough summary | Read only |
| 4581265604 | sonarqubecloud[bot] | **info** — quality gate passed (2 new issues noted but gate passed) | Read only |

## PR-level reviews (gh pr view 529 --json reviews)

| Review ID | Author | State | Body summary | Classification | Action |
|-----------|--------|-------|--------------|----------------|--------|
| PRR_kwDOPw--bs8AAAABBejZug | coderabbitai | COMMENTED | 6 actionable comments posted; detailed review with outside-diff comments, nitpick, and autofix suggestions | see breakdown below |

### Outside-diff comments from review body

| File | Lines | Severity | Classification | Action |
|------|-------|----------|----------------|--------|
| `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` | 77-94 | Major | **refactor/suggestion** — add `refetchOnWindowFocus: true` and `refetchOnMount: true` to useQuery (repo policy) | **Implemented** |
| `supabase/functions/generate-schedule/index.ts` | 190-223 | Major | **refactor/suggestion** — fail fast on `restaurantResult.error` and `salesResult.error` instead of silently swallowing RLS/fetch errors as "no timezone" or "no sales" | **Implemented** |

### Nitpick comments from review body

| File | Lines | Classification | Action |
|------|-------|----------------|--------|
| `src/hooks/useHourlySalesPattern.ts` | 143-177 | **nit** — add `refetchOnWindowFocus: true` and `refetchOnMount: true` per repo policy | **Implemented** |

---

## Summary counts

| Category | Count | Disposition |
|----------|-------|-------------|
| bug/correctness fixes | 3 | All fixed and committed |
| refactor/suggestion implemented | 3 | All implemented and committed |
| nit implemented | 3 | All implemented and committed |
| info (bots) | 5 | Read only |
| **Total comments processed** | **14** | — |

## Verification

- `npm run test`: 4348/4350 pass (2 expected skips) — CLEAN
- `npx tsc --noEmit`: 0 errors — CLEAN
- `npm run test:db`: 12/12 sold_at tests pass; 1355/1356 total (1 pre-existing failure in unrelated `enqueue_weekly_brief_jobs`) — CLEAN
- Push: `origin/fix/toast-sale-time-opened-date` at `655d93a4`
