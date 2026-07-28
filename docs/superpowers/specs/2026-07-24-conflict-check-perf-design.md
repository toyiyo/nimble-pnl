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
  v_tz := 'UTC';                                   -- see note below
  v_start_local := p_start_time AT TIME ZONE v_tz;
  v_end_local   := p_end_time   AT TIME ZONE v_tz;
END;
```

**Important difference from the `check_timeoff_conflict` sibling.** The sibling has only the
two `AT TIME ZONE v_tz` casts in its whole body, so it can reassign just the two locals in the
handler. `check_availability_conflict` reuses `v_tz` in **many downstream casts** — the
exception-window branch (`20260712120000` lines 91–93), the recurring loop (127–129), and the
previous-day overnight carry-over (150–152). If the handler only fixed the two locals, those
later casts would still hit the invalid `v_tz` and raise (`time zone "…" not recognized`) —
breaking the very invalid-tz safety net below. So the handler **must reassign `v_tz := 'UTC'`
itself**; every downstream reference then resolves safely. (Caught in Phase 2.5 design review.)

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
timezone `'Not/AZone'`, with a recurring-availability row that routes through a downstream
`v_tz` cast, falls back to UTC without raising). Keep it — it is the behaviour-preservation
safety net and it directly exercises the critical fix above (the `v_tz := 'UTC'` reassignment;
without it CASE 4's `lives_ok` would raise in the recurring loop). Add a **new CASE** pinning
that a fixed-offset tz string (`'+05:00'`) does not raise, documenting the accepted trade-off.
The full suite must stay green against the new migration, confirming the local-frame semantics
are untouched. No behavioural RED is expected — this is a perf refactor preserving behaviour on
every real input; the invalid-tz cases are the guardrail.

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

- **Fixed-offset tz strings are now accepted instead of coerced to UTC.** The old
  `pg_timezone_names` probe rejected any string not in the IANA catalog — including
  fixed-offset forms like `'+05:00'`, `'UTC+5'`, `'GMT+25'` — and fell back to UTC. The
  EXCEPTION approach lets `AT TIME ZONE` *parse* those (they succeed as fixed offsets, no
  raise), so such a restaurant would get fixed-offset math rather than UTC. Accepted because:
  (1) it makes this function **consistent with the already-deployed sibling**
  `check_timeoff_conflict` (PR #647), which made the identical trade-off — diverging would be
  worse; (2) `restaurants.timezone` holds IANA names in practice (per `memory/lessons.md`,
  every prod restaurant is `America/Chicago|New_York|Denver|Los_Angeles|Bahia_Banderas`), so
  no prod row hits this class; (3) accepting a valid fixed offset is arguably *more* correct
  than silently forcing UTC. A pgTAP case pins that a `'+05:00'` tz does not raise. Truly
  unparsable garbage (`'Not/AZone'`) still falls back to UTC, covered by the kept CASE 4.
  (Raised as `major` in Phase 2.5 design review; resolved as a documented, sibling-consistent
  trade-off.)
- **No `RAISE WARNING` on the fallback path.** Suggested in review (`minor`) for prod
  observability. Skipped to mirror the deployed sibling exactly — neither conflict RPC logs on
  fallback, and divergent logging in one of a matched pair is itself a smell. Revisit only if
  the pair is unified later.
- On the time-off *error* path both RPCs now fire (previously the availability RPC was
  skipped). Accepted: error path is rare, the RPC is read-only, and the thrown error is
  unchanged. The success-path win (overlapped round-trips) is the point.

## Non-goals

- No change to `check_timeoff_conflict` (already fixed in PR #647).
- No change to the conflict-mapping logic, the React Query wiring, or the RPC signatures.
```