# Plan: Conflict-check perf (tz EXCEPTION fallback + Promise.all)

Design: `docs/superpowers/specs/2026-07-24-conflict-check-perf-design.md`

Two independent changes. Task 1 (SQL) and Task 2 (TS) have no dependency on each other and
could be built in parallel; sequenced here for a clean commit history.

## Task 1 — New migration: EXCEPTION-based tz fallback in `check_availability_conflict`

**Files:**
- NEW `supabase/migrations/20260724120000_availability_conflict_tz_exception_fallback.sql`
- EDIT `supabase/tests/availability_conflict_local_tz.sql` (add fixed-offset case; bump `plan()`)

**Steps (TDD-adapted — perf refactor, behaviour-preserving):**
1. **RED-ish:** Add a pgTAP case to `availability_conflict_local_tz.sql` asserting a
   `'+05:00'` restaurant timezone does not raise (`lives_ok`), and bump `SELECT plan(12)` →
   `plan(13)`. Confirm the existing CASE 4 (`'Not/AZone'` + recurring row) is present — it is
   the guard for the critical `v_tz` reassignment.
2. **GREEN:** Write the new migration as a plain `CREATE OR REPLACE FUNCTION
   check_availability_conflict(...)` with the **identical signature/return/volatility/
   search_path** as `20260712120000`. Copy that body verbatim EXCEPT:
   - Delete the `IF NOT EXISTS (SELECT 1 FROM pg_timezone_names …) THEN v_tz := 'UTC'; END IF;`
     block (lines 51–53).
   - Wrap the two top-level `AT TIME ZONE v_tz` casts (lines 56–57) in
     `BEGIN … EXCEPTION WHEN invalid_parameter_value THEN v_tz := 'UTC'; <recast both>; END;`.
   - Header comment explaining: why (perf, ~49 ms→~0.4 ms), that it mirrors
     `20260723180000_timeoff_conflict_local_tz.sql`, and the critical note that `v_tz` (not
     just the locals) is reassigned because of downstream casts.
3. **VERIFY:** `npm run db:reset && npm run test:db` — the availability suite (now 13) and the
   pre-existing timeoff suite both green.
4. **COMMIT:** `perf(scheduling): replace pg_timezone_names probe with EXCEPTION fallback in check_availability_conflict`

## Task 2 — `Promise.all` the two RPCs in `fetchConflicts`

**Files:**
- NEW `tests/unit/useConflictDetection.test.ts`
- EDIT `src/hooks/useConflictDetection.tsx`

**Steps (TDD):**
1. **RED:** Write `useConflictDetection.test.ts`, mocking `@/integrations/supabase/client`.
   - *Concurrency test:* `rpc` returns a manually-controlled pending promise per call and
     records call order; assert that while the first RPC's promise is still pending, the
     second RPC has already been invoked. Fails against the current sequential code.
   - *Merge/order test:* both RPCs resolve with fixtures; assert `conflicts[]` has the
     time-off conflict first, then availability, with mapped shapes; `hasConflicts === true`.
   - *Error tests:* `timeOffError` set → `fetchConflicts` rejects; `availError` set → rejects.
   Run → concurrency test RED.
2. **GREEN:** Refactor `fetchConflicts` to `const [timeOffResult, availabilityResult] =
   await Promise.all([...])`, then destructure `{ data, error }` from each and keep the
   existing push logic and ordering unchanged.
3. **REFACTOR:** Ensure the imperative `checkConflictsImperative` and reactive hook still route
   through `fetchConflicts` (no duplication).
4. **VERIFY:** `npm run test -- useConflictDetection` green; `npm run typecheck`.
5. **COMMIT:** `perf(scheduling): overlap timeoff + availability RPCs with Promise.all`

## Phase 8 global verify
`npm run test && npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run build` — all green.

## Risk / rollback
- Both changes are `CREATE OR REPLACE` / local refactor — reversible by another
  `CREATE OR REPLACE` and a git revert. No schema/table/RLS changes, no data migration.
