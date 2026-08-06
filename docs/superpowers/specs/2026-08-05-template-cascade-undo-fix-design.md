# Template-Hours Cascade: Undo Desync + Unreachable Drift Opt-In — Design

**Date:** 2026-08-05
**Branch:** `fix/template-cascade-undo`
**Fixes defects in:** PR #700 (merged `d4a50c9f`), spec `docs/superpowers/specs/2026-08-03-template-hours-cascade-design.md`

## Problem

Two defects, both reproduced against production data on the Home test restaurant
(`0a1812a5-33f8-4861-a9d1-801048712875`, template `a71b4223-5a39-460b-bb12-83f0937ab4d9`
"Opening - weekend", `America/Chicago`).

### Bug 1 — Undo reverts the shifts but not the template

`undo_template_hours_cascade`'s only write to a domain table is the `UPDATE public.shifts`
at `supabase/migrations/20260804130000_template_hours_cascade.sql:415-435`. There is no
`UPDATE public.shift_templates` anywhere in the function (`:327-460`). So after Undo the
template holds the NEW hours while its shifts hold the OLD ones.

That desync is not cosmetic, because the cascade's match predicate compares each shift's
restaurant-local time-of-day against the template's *current* hours
(`:200-206`, repeated verbatim at `:256-260`):

```sql
(    (s.start_time AT TIME ZONE v_tz)::time = v_old_start
 AND (s.end_time   AT TIME ZONE v_tz)::time = v_old_end)
OR s.id = ANY(v_drift_ids)
```

`v_old_start`/`v_old_end` are read from the template row at `:108-113`. Once Undo has left
the template pointing somewhere the shifts are not, every later edit measures the shifts
against the wrong baseline, they fail the match, and they are classified **drifted** —
permanently.

Production timeline (UTC):

| Time | Event | Template | Shifts (Aug 7/8/9) |
|---|---|---|---|
| 02:35:16 | 3 shifts created | 10:00–16:30 | 10:00–16:30 |
| 02:35:28 | end → 17:30, cascade batch `4e6854bb` | 10:00–**17:30** | 10:00–**17:30** |
| 02:35:35 | **Undo** | 10:00–17:30 ⚠️ | 10:00–**16:30** |
| 02:36:20 | start → 11:00 | **11:00–18:30** | 10:00–16:30 (untouched) |

At 02:36:20 the shifts' start matched the stale `v_old_start` (10:00) but their end did not
match the stale `v_old_end` (17:30). The predicate is a conjunction, so all three fell to
drifted. Current prod state: template 11:00–18:30, all three shifts still 10:00–16:30.

### Bug 2 — the drift opt-in checkboxes are unreachable

`src/hooks/useTemplateHoursLedger.ts:118`:

```ts
const showCascadeChoice = hoursChanged && affectedCount > 0 && !impact.isLoading && !impact.error;
```

`affectedCount` is `ledger.totalAffected`, which is
`movingCount + selectedDriftCount` (`src/lib/scheduling/hoursChangeCopy.ts:168`). A drifted
shift contributes zero until the manager ticks its checkbox — and those checkboxes render
inside `<TemplateHoursImpact>`, which the dialog gates on the very same flag
(`src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx:410`). When every linked
shift is drifted, `movingCount = 0`, `selectedDriftCount = 0`, `affectedCount = 0`, the panel
never renders, and the only control that could raise the count is hidden behind the gate.

This is independent of Bug 1 — Bug 1 is simply the most common way to reach the deadlock.
It also fires whenever a manager hand-edits every linked shift, which is exactly what the
"Your call" bucket exists for.

The same flag is overloaded across four call sites in the dialog: the panel guard
(`:410`), the "Template only" button (`:418`), the primary button's label
(`:439`, via `buildSaveButtonLabel`), and the implicit-submit path (`:185`,
`await submitWith(showCascadeChoice)`).

---

## Fix 1 — record the template's own before/after, restore it on Undo

### Mechanism: a batch-header table

New table `public.template_hours_cascade_batches`, one row per cascade that actually moved
shifts, keyed by the batch id the cascade already mints:

```sql
CREATE TABLE public.template_hours_cascade_batches (
  id                UUID PRIMARY KEY,              -- = schedule_change_logs.cascade_batch_id
  restaurant_id     UUID NOT NULL REFERENCES public.restaurants(id)     ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE CASCADE,
  before_start_time TIME NOT NULL,
  before_end_time   TIME NOT NULL,
  after_start_time  TIME NOT NULL,
  after_end_time    TIME NOT NULL,
  changed_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`id` is the PK and is supplied by the caller (`v_batch_id`), so no separate index is needed
for the Undo lookup. `restaurant_id` is carried on the row so Undo can scope with the same
tenant filter every other statement in these functions uses, without a join.

**Rejected alternatives:**

- *Reconstruct the old template hours from a shift's `before_data`.* Wrong for drifted
  opt-in rows: a drifted shift's `before_data` holds hand-edited hours that never equalled
  the template's, and a batch can legitimately contain **only** drifted rows.
- *One extra `schedule_change_logs` row with `shift_id = NULL`.* The "deleted since" probe
  at `:372-380` is a `NOT EXISTS` against `shifts`, so a shift-less row would be counted as
  a deleted shift. Suppressing that needs `AND l.shift_id IS NOT NULL` bolted onto four
  separate queries, and it overloads a table whose every column is shift-scoped
  (`supabase/migrations/20251123000000_schedule_publishing.sql:23-35`).

### Write side

Inside `update_shift_template_with_cascade`, immediately after the `SELECT … INTO
v_updated_count, v_published_shifts` block (`:284-297`) and still inside `IF p_cascade`:

```sql
IF v_updated_count > 0 THEN
  INSERT INTO public.template_hours_cascade_batches (
    id, restaurant_id, shift_template_id,
    before_start_time, before_end_time, after_start_time, after_end_time, changed_by
  )
  VALUES (
    v_batch_id, p_restaurant_id, p_template_id,
    v_old_start, v_old_end, p_start_time, p_end_time, auth.uid()
  );
END IF;
```

`v_updated_count > 0` is exactly the condition under which the function returns a non-NULL
`batch_id` (`:302`) and therefore the only condition under which the client offers Undo. A
header written for a batch that moved nothing would be an unreachable row.

### Read side

`undo_template_hours_cascade` gains, before the shift revert:

```sql
SELECT b.shift_template_id, b.before_start_time, b.before_end_time,
       b.after_start_time,  b.after_end_time
  INTO v_template_id, v_before_start, v_before_end, v_after_start, v_after_end
FROM public.template_hours_cascade_batches b
WHERE b.id = p_batch_id
  AND b.restaurant_id = p_restaurant_id;
```

Then, when a header was found, lock and conditionally restore:

```sql
IF FOUND THEN
  SELECT t.start_time, t.end_time INTO v_cur_start, v_cur_end
  FROM public.shift_templates t
  WHERE t.id = v_template_id AND t.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF FOUND AND v_cur_start = v_after_start AND v_cur_end = v_after_end THEN
    UPDATE public.shift_templates
    SET start_time = v_before_start, end_time = v_before_end, updated_at = now()
    WHERE id = v_template_id AND restaurant_id = p_restaurant_id;
    v_template_restored := true;
  ELSIF FOUND THEN
    v_template_changed_since := true;
  END IF;
END IF;
```

Three properties, each deliberate:

- **`FOR UPDATE` before the comparison.** Same reasoning as the cascade's own lock at
  `:102-113`: without it a concurrent template edit can be read stale and stomped. Taking
  the template lock *before* the shift revert also fixes the lock order for the pair, so
  Undo and a concurrent cascade acquire template-then-shifts in the same sequence and cannot
  deadlock against each other.
- **The "unchanged since" guard.** Mirrors the shift-level guard at `:424-425` exactly: a
  row is restored only if it still holds precisely what the cascade wrote. If someone edited
  the template's hours after the cascade, that is a newer deliberate decision and Undo
  declines rather than destroying it.
- **Restored independently of `restored_count`.** Even when every shift is skipped, the
  manager clicked Undo to reverse *their template edit*; leaving the template on the new
  hours would be the same desync in a rarer shape. The header is the record of what the
  template edit was, so it is restorable on its own terms.

The return object gains two booleans:

```sql
'template_restored',      v_template_restored,
'template_changed_since', v_template_changed_since
```

Old batches (rows already in `schedule_change_logs` from before this migration) have no
header. The `SELECT … INTO` finds nothing, both flags stay `false`, and Undo behaves exactly
as it does today — no error, no partial write.

### Tenant scoping and grants

RLS enabled with **no policies**, so no client can read or write the table directly; both
RPCs are `SECURITY DEFINER` and bypass it. Additionally `REVOKE ALL ON TABLE … FROM PUBLIC,
anon, authenticated` — belt and braces, and it keeps the table off the PostgREST surface.
Every statement touching it filters on `restaurant_id = p_restaurant_id`, matching the
pattern the cascade function documents at `:96-101`.

### Client surface

`src/hooks/useShiftTemplates.tsx:182-187` types the RPC result; it gains
`template_restored: boolean` and `template_changed_since: boolean`. The success toast
(`:203-208`) already invalidates `['shift_templates', restaurantId]` via
`invalidateCascadeQueries()` (`:144-148`), so a restored template refreshes without further
work. The toast's `skippedReasons` list (`:198-202`) gains one more entry, kept in the same
"say why, don't summarise" style the existing three use:

```ts
result.template_changed_since ? 'template hours changed since' : null,
```

Restoration of the template is the expected case and is not narrated — reporting "restored
the template" on every Undo would be noise. The exception is narrated because it is the case
where the manager's mental model and the data disagree.

---

## Fix 2 — split the overloaded flag

`useTemplateHoursLedger` returns two flags where it returned one:

```ts
// Anything worth showing the manager: linked shifts exist in some bucket.
const linkedShiftCount =
  (buckets ? buckets.moving.length + buckets.locked.length + buckets.drifted.length + buckets.past.length : 0)
  + impact.pastCount;
const showImpactPanel = hoursChanged && linkedShiftCount > 0 && !impact.isLoading && !impact.error;

// A cascade is actually on offer: something would move if they saved now.
const cascadeOnOffer = showImpactPanel && affectedCount > 0;
```

`showCascadeChoice` is removed rather than kept as an alias — leaving both names in place is
how the overload happened.

Call-site mapping in `TemplateFormDialog.tsx`:

| Site | Today | After |
|---|---|---|
| `:410` panel render guard | `showCascadeChoice` | `showImpactPanel` |
| `:418` "Template only" button | `showCascadeChoice` | `cascadeOnOffer` |
| `:439` `buildSaveButtonLabel` | `showCascadeChoice` | `cascadeOnOffer` |
| `:185` `submitWith(...)` | `showCascadeChoice` | `cascadeOnOffer` |

`buildSaveButtonLabel`'s parameter is renamed `cascadeOnOffer` to match, and the function
gains a defensive floor so it can never emit "Save & update 0 shifts"
(`src/lib/scheduling/hoursChangeCopy.ts:144-157`):

```ts
if (cascadeOnOffer && affectedCount > 0) {
  return `Save & update ${affectedCount} ${pluralize(affectedCount, 'shift', 'shifts')}`;
}
```

The resulting states a manager can now reach:

| Buckets | Panel | Primary button | Behaviour |
|---|---|---|---|
| 3 moving | shown | "Save & update 3 shifts" | unchanged from today |
| 3 drifted, 0 ticked | **shown** (was hidden) | "Save changes" | template-only save; checkboxes reachable |
| 3 drifted, 2 ticked | shown | "Save & update 2 shifts" | cascade the two |
| only past/locked | **shown** (was hidden) | "Save changes" | explains why nothing moves |
| no linked shifts | hidden | "Save changes" | unchanged from today |

The ledger copy already handles every one of these without change: the "0 shifts move" chip
is emitted unconditionally and deliberately (`hoursChangeCopy.ts:178-184`), and the untouched
lines for past, locked, and unpicked drift are each independently conditional
(`:213-232`). The panel is honest at `movingCount = 0` as written.

### Accessibility and styling

No new components. The drift checkboxes, the disclosure, and the aria-live summary are the
ones shipped in PR #700 and are unchanged — this fix only makes them reachable. The panel's
existing semantic tokens and Apple/Notion styling carry over untouched.

### Known limitation (pre-existing, unchanged)

Re-syncing drifted shifts *without* editing the hours stays impossible: `hoursChanged`
(`useTemplateHoursLedger.ts:115-116`) gates the whole panel, so a manager who wants to pull
hand-edited shifts back onto the template's current hours must nudge the time and change it
back. That is the shipped design from PR #700, not a regression from these two bugs, and
fixing it is a separate feature (a "re-sync shifts" action on the template row). Recorded
here so it is not mistaken for an oversight.

---

## Production remediation

Three shifts on Home are desynced today. The repair is a **read-only diagnosis first**,
then a proposed statement with exact row counts, then the user's explicit approval before
any write — per CLAUDE.md's rule on prod writes.

Diagnosis query (read-only, safe to run without approval):

```sql
SELECT l.cascade_batch_id, l.restaurant_id, s.shift_template_id,
       t.start_time AS template_start, t.end_time AS template_end,
       count(*) AS reverted_shifts
FROM public.schedule_change_logs l
JOIN public.shifts s ON s.id = l.shift_id
JOIN public.shift_templates t ON t.id = s.shift_template_id
WHERE l.reason = 'Undo template hours cascade'
GROUP BY 1, 2, 3, 4, 5;
```

This finds every batch an Undo touched; the desynced ones are those whose template hours
still differ from the restored shifts' local hours. The repair is a targeted
`UPDATE public.shift_templates SET start_time = …, end_time = …` per affected template —
never a bulk statement, and never applied from this branch's migration. The migration ships
the code fix only; historical data is repaired separately and explicitly, because a
migration that rewrites tenant data based on inferred intent is exactly the kind of thing
that cannot be undone.

For Home specifically the expected repair is one row: template
`a71b4223-5a39-460b-bb12-83f0937ab4d9` back to `10:00`/`16:30`, matching the three shifts
that Undo restored. Counts will be confirmed against live data and stated before asking.

---

## Testing

### pgTAP — `supabase/tests/template_hours_cascade.test.sql` (extend)

1. Undo restores the template's hours: cascade 10:00–16:30 → 10:00–17:30, undo, assert
   template is 10:00–16:30 again and `template_restored` is `true`.
2. **The reported bug, end to end**: cascade → undo → cascade again with new hours, assert
   the shifts move (this fails today: they are classified drifted and nothing moves).
3. Undo declines when the template changed since: cascade, hand-edit the template's hours,
   undo, assert the template keeps the hand-edit, `template_restored` false,
   `template_changed_since` true.
4. A batch header row is written when shifts moved, and is **not** written when
   `p_cascade` was true but zero shifts qualified.
5. Tenant isolation: an Undo naming another restaurant's batch id restores nothing and
   leaves both templates untouched.
6. Legacy batch: an Undo for a `cascade_batch_id` with no header row reverts shifts and
   returns both flags false.

### Vitest

`tests/unit/useTemplateHoursLedger.test.ts`:
- `showImpactPanel` true when `driftedCount > 0` and `movingCount === 0`.
- `showImpactPanel` true when only past/locked shifts are linked.
- `showImpactPanel` false when no linked shifts exist at all.
- `cascadeOnOffer` false at `affectedCount === 0`, true once a drift id is selected.

`tests/unit/hoursChangeCopy.test.ts`:
- `buildSaveButtonLabel` returns "Save changes" when `cascadeOnOffer` is false.
- Returns "Save changes" (not "Save & update 0 shifts") if `cascadeOnOffer` is true but
  `affectedCount` is 0.
- Still returns "Save & update 1 shift" / "…2 shifts" for the normal cases.

### Playwright — `tests/e2e/template-hours-cascade.spec.ts` (extend)

One scenario covering the user's report: create a template with linked future shifts,
change the hours and cascade, click Undo, then change the hours again and assert the impact
panel appears with the shifts in the moving bucket. This is the regression that no unit test
can cover, because it spans the RPC round trip.

## Migration

New file `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql`.
`20260805120000` and `20260805130000` are already claimed by sibling worktrees
(`page_areas`, `self_scope_employee_reads`); the 14-digit prefix is the PK of
`supabase_migrations.schema_migrations`, so a collision fails only on `pull_request` CI.
`tests/unit/migrationVersionUniqueness.test.ts` guards this.

The existing `20260804130000` migration is **not** edited — it is already applied in
production, and `CREATE OR REPLACE FUNCTION` in a new file supersedes it cleanly on a fresh
reset as long as the new file sorts later, which it does.
