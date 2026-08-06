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

### Bug 2 — the ledger announces "0 shifts move" when three are one tick away

The user's words were *"I don't even see the option."* The panel **is** rendered — it is
gated at `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx:270` on
`isEdit && hoursChanged && template`, which has no dependency on how many shifts would move.
Nothing is unreachable. What is wrong is what the manager is told.

The panel renders **collapsed** (`TemplateHoursImpact.tsx:56`, `expanded = false`), so the
only thing on screen is the one-line summary at `:99-101`. That summary is built at
`src/lib/scheduling/hoursChangeCopy.ts:235-238` from `totalAffected`, which is
`movingCount + selectedDriftCount` (`:168`) — and a drifted shift contributes zero until its
checkbox is ticked. In the reported state (3 drifted, none picked) the manager reads:

> Low impact. 1h later · same length. **0 shifts move.**

Meanwhile the primary button says "Save changes" and the "Template only" button is absent,
because `showCascadeChoice` is correctly false (`useTemplateHoursLedger.ts:118`) — saving
right now genuinely would only change the template.

So every control is telling the truth about *this instant*, and the composite is still a lie
about *the situation*: three shifts are one checkbox away from moving, and the single line the
manager actually reads says the opposite. Having been told there is nothing to do, they do
not expand the panel — and the checkboxes sit behind that first disclosure plus a second,
nested one that is also closed by default (`TemplateHoursImpact.tsx:57`, `:151-164`).

This is independent of Bug 1 in the sense that it fires for any all-drifted template — a
manager who hand-edited every linked shift hits the same wall. Bug 1 is simply what put a
manager who had hand-edited *nothing* into that state.

**`showCascadeChoice` is not the defect and is not being changed.** Its four uses in the
dialog (`:185`, `:410`, `:418`→ the "Template only" button at `:410`'s guard, `:439`) are
consistent with each other and with its name: a cascade choice is on offer exactly when
something would move. An earlier draft of this design proposed splitting it; that was based
on a misreading of `:410` as the panel's render guard, and is dropped.

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

Both new flags are declared with an explicit default:

```sql
v_template_restored      BOOLEAN := false;
v_template_changed_since BOOLEAN := false;
```

Not left to plpgsql's `NULL` default. The legacy-batch path and the early
`p_batch_id IS NULL` return at `:360-365` both fall through without assigning them, and a
`null` in the returned JSONB would diverge from the `false` this design and the client's
TypeScript both assume.

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
- **The "unchanged since" guard.** Mirrors the shift-level guard at `:424-425`: a row is
  restored only if it still holds precisely what the cascade wrote. If someone edited the
  template's hours after the cascade, that is a newer deliberate decision and Undo declines
  rather than destroying it. Plain `=` rather than the shift guard's
  `IS NOT DISTINCT FROM`, because `shift_templates.start_time`/`end_time` are `TIME NOT NULL`
  (`supabase/migrations/20251114100000_create_scheduling_tables.sql:39-40`) while
  `shifts.start_time`/`end_time` are not — the operators are equivalent here and `=` says so.
  A second Undo click on the same batch lands in the `changed_since` branch, because the
  first Undo already moved the template off the cascade's after-hours. Mechanically right,
  and it matches how a second click already behaves for the shifts (`:438-441`).
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

## Fix 2 — say what the manager can do, and put the control in front of them

Two changes, both small, both aimed at the one line the manager actually reads and the one
click that stands between them and the checkboxes.

### 2a. The summary names the shifts they can pick

`buildHoursChangeLedger` (`src/lib/scheduling/hoursChangeCopy.ts:234-238`) gains a clause
for the case where nothing would move but something *could*:

```ts
const unpickedDrift = driftedCount - selectedDriftCount;   // already computed at :226
const pickClause = totalAffected === 0 && unpickedDrift > 0
  ? ` ${unpickedDrift} hand-edited ${pluralize(unpickedDrift, 'shift', 'shifts')} you can pick.`
  : '';
```

appended to both branches of `summary`. The reported state now reads:

> Low impact. 1h later · same length. 0 shifts move. **3 hand-edited shifts you can pick.**

Scoped to `totalAffected === 0` deliberately. Once anything is moving, the panel's chips and
the "Save & update N shifts" button already say so, and this line is truncated
(`TemplateHoursImpact.tsx:99`, `truncate`) — spending its remaining width on a second
call to action would push the count off screen.

`severity` is untouched: `deriveHoursChangeSeverity` keys on `publishedCount` (`:56-58`),
which counts only shifts that would actually move, so an all-drifted state stays "Low
impact". That is correct — saving right now moves nothing.

### 2b. The drift disclosure opens by default when it is the only thing to do

`TemplateHoursImpact.tsx:57` initialises `driftOpen` to `false` unconditionally. It becomes
a nullable override over a derived default, so the default can depend on `ledger` (which is
`null` on the first render while the impact query is in flight, and so cannot be read by a
`useState` initialiser that runs exactly once):

```ts
const [driftOpen, setDriftOpen] = useState<boolean | null>(null);
// ... after the `if (!ledger) return null` bail-out at :77
const driftDefaultOpen = drifted.length > 0 && ledger.totalAffected === 0;
```

used as `<Collapsible open={driftOpen ?? driftDefaultOpen} onOpenChange={setDriftOpen}>`.
Once the manager touches the disclosure, their choice sticks for the rest of the dialog.

The outer panel stays collapsed by default. Keeping the form calm was a deliberate choice in
PR #700, and with 2a the collapsed line now carries the signal that earns the click.

### What is explicitly NOT changing

- `showCascadeChoice` and its four call sites — see the Bug 2 section above.
- `buildSaveButtonLabel` (`:144-157`). "Save changes" is the right label when nothing would
  move, and "Save & update N shifts" appears the moment a checkbox is ticked. It is already
  correct in every reachable state.
- The panel's render guard at `TemplateFormDialog.tsx:270`. It already renders in every
  state that has something to say.

### Accessibility and styling

No new components and no new controls. The drift checkboxes are already correctly labelled
(`TemplateHoursImpact.tsx:172-179`, `Checkbox id` + `Label htmlFor`). The `aria-live="polite"`
region is scoped to the summary line (`:99`) — 2a changes the text that region announces but
not when it announces, so a manager on a screen reader hears the pick clause on the same
settled-keystroke cadence as today. 2b opens a `Collapsible` whose trigger already carries
its own state; no ARIA changes are needed. Existing semantic tokens and the Apple/Notion
scale carry over untouched.

### Known limitation (pre-existing, unchanged)

Re-syncing drifted shifts *without* editing the hours stays impossible: `hoursChanged`
(`useTemplateHoursLedger.ts:115-116`) gates the panel at `TemplateFormDialog.tsx:270`, so a
manager who wants to pull
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
LEFT JOIN public.shifts s ON s.id = l.shift_id
LEFT JOIN public.shift_templates t ON t.id = s.shift_template_id
WHERE l.reason = 'Undo template hours cascade'
GROUP BY 1, 2, 3, 4, 5;
```

`LEFT JOIN`, not inner: `schedule_change_logs.shift_id` is deliberately not a foreign key
(`supabase/migrations/20260617120000_fix_schedule_change_logs_delete_fk.sql:38-44`), so an
inner join would silently drop any batch whose shift was deleted afterwards and understate
the damage.

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
7. **Template restored when no shift is** — cascade, then lock every moved shift, then undo:
   assert `restored_count = 0` and `template_restored = true`. This is the one combination
   the "Restored independently of `restored_count`" decision above rests on, and none of
   tests 1–3 constructs it.
8. **Superseded batch** — cascade X, then cascade Y on the same template, then Undo(X):
   assert Y's shifts are not disturbed (they fail X's `after_data` guard and count as
   `changed_since`) and the template is not restored (`template_changed_since = true`, since
   it now holds Y's hours, not X's). The safety here comes from two independently written
   guards happening to compose; given this migration exists because of exactly that class of
   interaction, it gets a test rather than a paragraph.

### Vitest

`tests/unit/hoursChangeCopy.test.ts`:
- `buildHoursChangeLedger` summary ends with "3 hand-edited shifts you can pick." when
  `movingCount = 0`, `driftedCount = 3`, `selectedDriftCount = 0`. **Fails today** — today's
  summary stops at "0 shifts move."
- Singular form at `driftedCount = 1`.
- No pick clause once `selectedDriftCount > 0` (something is moving, so the button carries it).
- No pick clause when `movingCount > 0` and drift is unpicked.
- No pick clause when `driftedCount = 0` — the past/locked-only state is unchanged.

`tests/unit/templateHoursImpact.test.tsx` (new; the repo lists component tests as optional,
but 2b is a render-state behaviour no pure-function test can reach):
- Drift disclosure is open on first render when `drifted.length > 0` and
  `ledger.totalAffected === 0`, and the checkboxes are in the accessibility tree.
- Closed on first render when something is already moving.
- A manual toggle wins over the default and survives a ledger re-render.

### Playwright — `tests/e2e/template-hours-cascade.spec.ts` (extend)

Two scenarios, one per bug — the first would pass today and the second would not, so both
are needed.

1. **Bug 1 round trip.** Create a template with linked future shifts, change the hours and
   cascade, click Undo, then change the hours again and assert the shifts move. Today the
   second edit finds them drifted and moves nothing.
2. **Bug 2 opt-in path.** On a template whose linked shifts are all hand-edited, change the
   hours and assert (a) the collapsed summary names the pickable shifts, (b) expanding the
   panel shows the drift checkboxes without a further click, (c) ticking one relabels the
   primary button to "Save & update 1 shift" and reveals "Template only", and (d) saving
   sends that shift id with `cascade: true` and the shift actually moves.

## Migration

New file `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql`.
`20260805120000` and `20260805130000` are already claimed by sibling worktrees
(`page_areas`, `self_scope_employee_reads`); the 14-digit prefix is the PK of
`supabase_migrations.schema_migrations`, so a collision fails only on `pull_request` CI.
`tests/unit/migrationVersionUniqueness.test.ts` guards this.

The existing `20260804130000` migration is **not** edited — it is already applied in
production, and `CREATE OR REPLACE FUNCTION` in a new file supersedes it cleanly on a fresh
reset as long as the new file sorts later, which it does.
