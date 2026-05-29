# Progress: fix/toast-sale-time-opened-date

## Phase: Preflight — COMPLETED

### Environment Check Results
- Branch: fix/toast-sale-time-opened-date (correct)
- gh: authenticated as jdelgado2002 (github.com)
- jq: 1.7.1-apple (available)
- node: v24.11.1 (available)
- coderabbit: 0.5.2 (available)
- codex: NOT available (warning only)
- SONAR_TOKEN: UNSET (warning only)
- SONAR_PROJECT_KEY: UNSET (warning only)
- .env.local symlink: CREATED (linked to main repo .env.local)

### Notes
- All hard dependencies satisfied (gh, jq, node, coderabbit)
- codex not installed — codexAvailable=false
- Sonar not configured — sonarConfigured=false
- Ready to proceed with build phase

## Phase: Build (TDD) — IN PROGRESS

### Task 8 (orchestration task 8/10): StaffingOverlay — resolve restaurant timezone from useRestaurantContext, pass tz into aggregateHourlySales — COMPLETED (GREEN)
- Commit: `2b743c9f`
- Implementation was already done in Task 7 commit (a65f6c52): useRestaurantContext used, tz resolved and passed to aggregateHourlySales
- Added `tests/unit/StaffingOverlay.tz.test.tsx` (3 tests) — spy on aggregateHourlySales, verify tz arg:
  - Passes `America/New_York` from context when restaurant.timezone = 'America/New_York'
  - Falls back to `America/Chicago` when restaurant has no timezone field
  - Falls back to `America/Chicago` when selectedRestaurant is null
- 4408 unit tests pass; typecheck clean (tsc --noEmit)

### Task 7 (orchestration task 7/10): StaffingOverlay + useHourlySalesPattern query — add sold_at to both unified_sales SELECT column lists — COMPLETED (GREEN)
- Commit: `a65f6c52`
- Added `sold_at timestamptz | null` to both TypeScript type files:
  - `src/integrations/supabase/types.ts` (Row, Insert, Update sections)
  - `src/types/supabase.ts` (Row, Insert, Update sections)
- Updated both SELECT column lists to include `sold_at`:
  - `StaffingOverlay.tsx` line 83: `select('sale_date, sale_time, sold_at, total_price')`
  - `useHourlySalesPattern.ts` line 139: `select('sale_date, sale_time, sold_at, total_price')`
- Wired restaurant timezone into `StaffingOverlay`:
  - Added `import { useRestaurantContext }` from RestaurantContext
  - Reads `const tz = selectedRestaurant?.restaurant?.timezone ?? 'America/Chicago'`
  - Passes `tz` to `aggregateHourlySales(filtered, tz)`
  - Added `tz` to the `daySuggestions` useMemo dependency array
- Fixed existing tests that broke due to new `useRestaurantContext` dependency:
  - `StaffingOverlay.wiring.test.tsx`: added `vi.mock('@/contexts/RestaurantContext', ...)`
  - `StaffingOverlay.deadends.test.tsx`: added `vi.mock('@/contexts/RestaurantContext', ...)`
- Added timezone-sensitivity test to `useHourlySalesPattern.test.ts` (11 tests total)
- All 4405 unit tests pass; typecheck clean

### Task 6 (orchestration task 6/10): Migration verification — db:reset + test:db — COMPLETED (GREEN)
- Commit: `3d110616` (already committed in Task 5 as "fix(toast): populate unified_sales.sold_at from openedDate")
- Ran `npm run db:reset` — migration `20260529130000_unified_sales_sold_at.sql` applied cleanly, no errors
- Ran `npm run test:db` — all 1372/1372 pgTAP tests PASS
  - `39_unified_sales_sold_at.sql`: all 12 tests GREEN (column exists, openedDate hour, closedDate fallback, regex guard, COALESCE preserve, backfill)
  - No regressions in any existing test file
- `sale_time`/`sale_date` unchanged; all prior toast accuracy tests pass

### Task 5 (orchestration task 5/10): Migration — ADD COLUMN + extend sync overloads + backfill — COMPLETED (GREEN)
- Commit: `3d110616`
- Created `supabase/migrations/20260529130000_unified_sales_sold_at.sql`
- ADD COLUMN sold_at timestamptz (nullable, no index, with COMMENT)
- Both sync_toast_to_unified_sales overloads extended at 4 INSERT sites each (REVENUE/DISCOUNT/VOID/TAX)
  - sold_at in SELECT = COALESCE(openedDate regex-guarded, closedDate regex-guarded)
  - ON CONFLICT DO UPDATE: sold_at = COALESCE(unified_sales.sold_at, EXCLUDED.sold_at) — preserves prior openedDate value when re-sync lacks openedDate
  - TIP/REFUND inserts: sold_at stays NULL (no column added)
- Bounded backfill DO block: updates sold_at IS NULL rows within 90 days, excludes tip/refund, regex guard
- Updated COMMENT ON FUNCTION for both overloads
- Key fix: COALESCE order is (existing, incoming) to protect prior openedDate from being overwritten by closedDate fallback on re-sync
- All 12 pgTAP tests GREEN; 1372/1372 pgTAP + 4404 unit tests pass

### Task 4 (orchestration task 4/10): pgTAP test for sold_at — COMPLETED (RED)
- Commit: `2e6c3811`
- Created `supabase/tests/39_unified_sales_sold_at.sql` with 12 tests
- Tests cover: column existence (timestamptz), sync populates from openedDate, closedDate fallback, malformed openedDate no-throw (regex guard), ON CONFLICT COALESCE preserves prior sold_at, bounded backfill populates NULL rows
- All tests FAIL (RED) until migration `20260529130000_unified_sales_sold_at.sql` is applied
- Key verified behaviors tested:
  - openedDate `2026-05-30T01:30:00+0000` → local hour 20 in America/Chicago (CDT), NOT 23 from closedDate
  - closedDate fallback when openedDate absent
  - malformed openedDate `"NOT-A-DATE"` → regex guard skips it, falls back to closedDate
  - re-sync with missing openedDate → sold_at preserved (not nulled out)

### Task 3 (orchestration task 3/10): Migration timestamp check — COMPLETED
- Result: `20260529130000_unified_sales_sold_at.sql` is the non-colliding filename to use
- Highest existing May 2026 migration: `20260529120000_fix_open_shifts_capacity_one.sql`
- `20260529130000` is strictly greater → no collision
- No commit needed (discovery step only)

### Task 1 (workflow task 1) / Task 2 (orchestration task 2/10): aggregateHourlySales — hourInTz + optional timeZone — COMPLETED
- Commit: `738e033b`
- Added `sold_at?: string | null` to `RawSale` interface
- Added `timeZone: string = 'America/Chicago'` param to `aggregateHourlySales`
- Added `hourInTz(iso, tz)` helper using `Intl.DateTimeFormat` with `hourCycle:'h23'`
- Loop now prefers `sold_at` (tz-aware) over `sale_time` (legacy local parse)
- 5 new tests in `tests/unit/useHourlySalesPattern.test.ts` (all 10 tests pass)
  - tz-aware bucketing from sold_at
  - legacy sale_time fallback when sold_at is null
  - DST-boundary correctness (Mar 8 2026 spring-forward)
  - mixed rows (sold_at + null sold_at)
  - backward compat: no timeZone arg still works
- TypeScript: clean (tsc --noEmit)
