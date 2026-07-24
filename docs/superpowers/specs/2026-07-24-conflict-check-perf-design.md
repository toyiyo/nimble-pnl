# Design: Two perf fixes on the scheduling conflict-check path

**Date:** 2026-07-24
**Branch:** `claude/interesting-diffie-f4e9c5`
**Author:** Claude (dev workflow)

## Problem

Two measured, pre-existing performance issues sit on the **once-per-shift-assignment
interactive path** (`useConflictDetection.fetchConflicts` → `check_timeoff_conflict` +
`check_availability_conflict`). Both wins compound because they fire on the same user action.

### 1. `check_availability_conflict` validates the timezone via `pg_timezone_names`

Migration `20260712120000_availability_conflict_local_tz.sql` guards a garbage
`restaurants.timezone` with:

```sql
IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
  v_tz := 'UTC';
END IF;
```

`pg_timezone_names` is a set-returning catalog function that materializes ~1,200 rows
via a sequential filter scan — **measured ~49 ms/call locally** vs **~0.4 ms** for the
`AT TIME ZONE v_tz` cast the function performs anyway (~100× cheaper). This is exactly
the hidden `O(rows × catalog)` blowup called out in `memory/lessons.md` (lines ~1358,
~1514). The sibling `check_timeoff_conflict` was already fixed this way in migration
`20260723180000_timeoff_conflict_local_tz.sql` (PR #647).

### 2. `fetchConflicts` awaits the two RPCs sequentially

`src/hooks/useConflictDetection.tsx` awaits `check_timeoff_conflict` to completion, then
starts `check_availability_conflict`. The two calls are **independent** — neither's result
feeds the other — so their network round-trips serialize needlessly. On a mid-latency
connection this roughly doubles the wall-clock of the conflict check the scheduler blocks on.

## Approach

### Fix 1 — Replace catalog probe with an EXCEPTION fallback (NEW migration)

Mirror the pattern already deployed in `check_timeoff_conflict`. Wrap the two
`AT TIME ZONE v_tz` casts in a subtransaction that catches `invalid_parameter_value`
and degrades to UTC (the old behaviour), and delete the `pg_timezone_names` `IF NOT EXISTS`
block:

```sql
BEGIN
  v_start_local := p_start_time AT TIME ZONE v_tz;
  v_end_local   := p_end_time   AT TIME ZONE v_tz;
EXCEPTION WHEN invalid_parameter_value THEN
  v_start_local := p_start_time AT TIME ZONE 'UTC';
  v_end_local   := p_end_time   AT TIME ZONE 'UTC';
END;
```

- The happy path (valid tz) pays only the plain cast (~0.4 ms). Only a truly invalid zone
  pays for the subtransaction — and that path is unreachable in practice.
- **NEW migration** doing a plain `CREATE OR REPLACE FUNCTION` with the **same signature and
  return shape** — the old `20260712120000` migration is already deployed, so it must not be
  edited. No `DROP` needed. Function stays `STABLE`, `SET search_path = public, pg_catalog`.
- **Behaviour is preserved exactly:** both the old catalog probe and the new EXCEPTION block
  resolve an invalid tz to UTC. The rest of the function body (the local-frame walk) is
  copied verbatim from `20260712120000` so no other semantics change.

New migration filename: `20260724120000_availability_conflict_tz_exception_fallback.sql`
(timestamp after the deployed timeoff fix `20260723180000`).

### Fix 2 — Overlap the two RPCs with `Promise.all`

```typescript
const [timeOffResult, availabilityResult] = await Promise.all([
  supabase.rpc('check_timeoff_conflict', { ... }),
  supabase.rpc('check_availability_conflict', { ... }),
]);
const { data: timeOffConflicts, error: timeOffError } = timeOffResult;
if (timeOffError) throw timeOffError;
// push time-off conflicts (unchanged)
const { data: availabilityConflicts, error: availError } = availabilityResult;
if (availError) throw availError;
// push availability conflicts (unchanged)
```

- **Result ordering is preserved:** time-off conflicts are still pushed before availability
  conflicts, so the returned `conflicts[]` order is identical.
- **Error semantics:** `supabase.rpc()` resolves with `{ data, error }` on an RPC-level error
  (it does not reject), so `Promise.all` does not short-circuit on those — both RPCs run, then
  `timeOffError` is checked first and thrown, exactly as before. The only observable change:
  on a time-off error we now *also* fire the availability RPC (previously skipped). That is a
  rare error path, harmless (read-only RPC), and the thrown error is unchanged. If `rpc()`
  itself rejects (network failure), `Promise.all` rejects with the same error the sequential
  `await` would have thrown.

## Tests

### pgTAP (Fix 1)

`supabase/tests/availability_conflict_local_tz.sql` already contains **CASE 4** (invalid
timezone `'Not/AZone'` falls back to UTC without raising). Keep it — it is the behaviour-
preservation safety net proving the EXCEPTION block matches the old catalog probe. The full
suite (12 assertions) must stay green against the new migration, confirming the local-frame
semantics are untouched. No pgTAP RED is expected because this is a pure perf refactor with
identical behaviour; the invalid-tz case is the guardrail.

### Vitest (Fix 2)

Add `tests/unit/useConflictDetection.test.ts`:

- **Concurrency (RED→GREEN):** mock `supabase.rpc` so each call returns a controllable
  pending promise and records invocation order. Assert that when the first RPC's promise is
  still pending, the **second RPC has already been invoked** — true only under `Promise.all`,
  false under the sequential version.
- **Merge/order:** both RPCs resolve with fixtures; assert the returned `conflicts[]` contains
  the time-off conflict first, then the availability conflict, with the mapped shapes.
- **Error propagation:** a `timeOffError` still throws; an `availError` still throws.

## Decided trade-offs

- On the time-off *error* path both RPCs now fire (previously the availability RPC was
  skipped). Accepted: error path is rare, the RPC is read-only, and the thrown error is
  unchanged. The success-path win (overlapped round-trips) is the point.

## Non-goals

- No change to `check_timeoff_conflict` (already fixed in PR #647).
- No change to the conflict-mapping logic, the React Query wiring, or the RPC signatures.
```