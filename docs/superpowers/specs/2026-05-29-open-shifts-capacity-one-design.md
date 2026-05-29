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

`> 0` is the clean semantic equivalent of `>= 1` for this INT column —
"the template must allow at least one person." It is **not** extra
defense against 0/negative rows: `20260411221543_add_capacity_to_shift_templates.sql`
already enforces `CHECK (capacity >= 1)` (default 1), so sub-1 capacities
cannot exist. `> 0` is chosen purely for readability; `>= 1` would be
equally correct. The final `open_spots > 0` WHERE clause independently
filters fully-claimed shifts.

Migrations are immutable once applied; the historical migration is left
untouched and the fix ships as a new `CREATE OR REPLACE` migration,
filename timestamped `20260529…` (must sort after the current last
migration `20260524120200`). The function body is otherwise copied
verbatim from the latest definition (timezone-aware `AT TIME ZONE`
comparisons preserved), with two opportunistic hardening tweaks since
the whole body is being rewritten:

- Add `SET search_path = public` to the `SECURITY DEFINER` function
  (closes a pre-existing search-path-shadowing gap on this function).
- Declare the function `STABLE` (it is read-only — more honest than the
  default `VOLATILE` and lets the planner call it fewer times).

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

New file `supabase/tests/open_shifts_capacity_one.test.sql`, `SELECT plan(3)`:

1. A `capacity = 1` template on a published future date appears in
   `get_open_shifts` with `open_spots = 1`. **(fails before the fix —
   no row returned)**
2. After one instant `claim_open_shift`, the capacity-1 template no
   longer appears in `get_open_shifts` — asserted via
   `COUNT(*) = 0`/`NOT EXISTS`. A code comment notes *why* it drops out:
   the instant-claim path inserts an `open_shift_claims` row with
   `status = 'approved'` (not `'pending_approval'`), so `pending_claims`
   stays 0; the slot count is driven to 0 by `assigned_count` (the
   `shifts` join), then the final `open_spots > 0` WHERE filters the row.
3. A second `claim_open_shift` on the now-full capacity-1 template
   returns `success = false` / "No open spots available" — pins the
   `claim_open_shift` guard for `capacity = 1`.

**Required fixtures** (mirroring `open_shift_claim_timezone.test.sql`):
`restaurants`, `shift_templates` (capacity 1), `employees`,
`staffing_settings` with `open_shifts_enabled = true` +
`require_shift_claim_approval = false` (instant claim), and a
`schedule_publications` row covering the target week. Omitting
`staffing_settings`/`schedule_publications` would make `get_open_shifts`
early-return / return no rows and surface as a confusing
"planned 3, ran 0" rather than a clear assertion failure.

Dates use the `CURRENT_DATE + (7 - EXTRACT(DOW FROM CURRENT_DATE)::int)`
next-Sunday pattern (per the 2026-04-21 lesson: never hardcode future
dates in pgTAP). Fixtures follow the deterministic pattern: RLS off,
delete-before-insert / `ON CONFLICT DO UPDATE`, all inside
`BEGIN … ROLLBACK`.

## Scope

SQL migration + pgTAP test only. No UI, no TypeScript, no edge-function
changes.
