# Design: Include capacity-1 templates in the open-shift pool

**Date:** 2026-05-29
**Branch:** `fix/open-shifts-capacity-one`
**Type:** Bug fix (SQL + pgTAP regression test)

## Problem

`get_open_shifts` filters templates with `AND st.capacity > 1` (line 77 of
`supabase/migrations/20260413001912_fix_shift_claim_timezone.sql`, and
identically in the two earlier migrations that defined the function). This
silently excludes any `shift_template` with `capacity = 1` from the
claimable open-shift pool.

The AI scheduler routinely produces single-person crew allocations (e.g.
"1 Server"). These are written to `shift_templates` with `capacity = 1`,
and the user sees an "open shifts created" toast — but those shifts never
appear in `get_open_shifts`, so no employee can ever claim them. The UI
promise and the data contract diverge.

## Root cause

The `> 1` guard was almost certainly intended as a no-op optimization
(skip templates that can hold nobody), but the correct boundary is "can
hold **at least one** person," i.e. `capacity > 0`. `> 1` accidentally
drops the most common case the scheduler emits.

## Fix

Add a new migration that `CREATE OR REPLACE`s `get_open_shifts` with the
single guard changed:

```diff
-          AND st.capacity > 1
+          AND st.capacity > 0
```

`> 0` (equivalent to `>= 1` for the INT column) is chosen over `>= 1`
because it also defends against any 0/negative capacity rows without
relying on a CHECK constraint. The final `open_spots > 0` WHERE clause
already filters out fully-claimed shifts, so a capacity-0 template would
produce no rows anyway — `> 0` just makes the intent explicit.

Migrations are immutable once applied; the historical migration is left
untouched and the fix ships as a new `CREATE OR REPLACE` migration. The
function body is otherwise copied verbatim from the latest definition
(timezone-aware `AT TIME ZONE` comparisons preserved).

## `claim_open_shift` — no change needed

`claim_open_shift`'s capacity guard is:

```sql
IF (v_assigned_count + v_pending_count) >= v_template.capacity THEN
    RETURN ... 'No open spots available';
```

For `capacity = 1` this is already correct: the first claim sees
`0 >= 1` → false (allowed), the second sees `1 >= 1` → true (blocked).
There is **no** parallel `> 1` exclusion bug here. We add a regression
test to pin this behavior rather than changing code.

## Tests (pgTAP)

New file `supabase/tests/open_shifts_capacity_one.test.sql`:

1. A `capacity = 1` template on a published future date appears in
   `get_open_shifts` with `open_spots = 1`. **(fails before the fix)**
2. After one instant `claim_open_shift`, the capacity-1 template
   disappears from `get_open_shifts` (0 open spots, filtered out).
3. A second `claim_open_shift` on the now-full capacity-1 template
   returns `success = false` / "No open spots available" — pins the
   `claim_open_shift` guard.

Dates use the `CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int)`
next-Sunday pattern (per the 2026-04-21 lesson: never hardcode future
dates in pgTAP). Fixtures follow the deterministic pattern: RLS off,
delete-before-insert / `ON CONFLICT DO UPDATE`, all inside
`BEGIN … ROLLBACK`.

## Scope

SQL migration + pgTAP test only. No UI, no TypeScript, no edge-function
changes.
