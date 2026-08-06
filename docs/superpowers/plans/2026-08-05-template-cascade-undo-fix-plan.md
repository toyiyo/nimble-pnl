# Template-Hours Cascade Undo Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Undo restore the template's hours alongside its shifts, and stop the impact ledger from announcing "0 shifts move" when the manager is one checkbox away from moving three.

**Architecture:** A new batch-header table records what a cascade did to the template itself, so `undo_template_hours_cascade` can reverse it in the same transaction as the shift revert, guarded by the same "unchanged since" check the shifts already use. On the client, one pure copy builder gains a clause and one component's nested disclosure gains a conditional default — no structural changes.

**Tech Stack:** Postgres 15 (Supabase), plpgsql `SECURITY DEFINER` RPCs, pgTAP, React 18 + TypeScript, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-05-template-cascade-undo-fix-design.md`

## Global Constraints

- Scope is **hours only** (`start_time`/`end_time`). Do not cascade or restore `days[]`, `capacity`, `area`, `position`, `name`, or `break_duration`.
- **Never edit `supabase/migrations/20260804130000_template_hours_cascade.sql`.** It is applied in production. All SQL changes ship as the new migration `20260805160000_template_cascade_undo_restores_template.sql`, which supersedes the two functions via `CREATE OR REPLACE FUNCTION`.
- The migration filename prefix `20260805160000` is fixed. `20260805120000` and `20260805130000` are claimed by sibling branches; the prefix is the PK of `supabase_migrations.schema_migrations` and a collision fails only on `pull_request` CI. `tests/unit/migrationVersionUniqueness.test.ts` guards this.
- **No production writes.** The migration must not contain `UPDATE`/`INSERT`/`DELETE` against tenant data. Repairing the three already-desynced rows on Home is a separate, explicitly approved step outside this branch.
- `showCascadeChoice` (`src/hooks/useTemplateHoursLedger.ts:118`) and its four call sites in `TemplateFormDialog.tsx` are **not** changed. `buildSaveButtonLabel` is **not** changed. The panel's render guard at `TemplateFormDialog.tsx:270` is **not** changed.
- CLAUDE.md conventions: semantic tokens only (no `bg-white`/`text-black`), the Apple/Notion typography scale, `aria-label` on unlabelled controls, React Query with `staleTime` ≤ 60s and no manual caching.
- Every RPC statement that touches a tenant table filters on `restaurant_id = p_restaurant_id`. Both functions stay `SECURITY DEFINER` with `SET search_path = public, pg_temp`.
- `npm run db:reset` is mandatory before `npm run test:db` when a migration changes. Local Supabase is shared with ~25 sibling worktrees — run the DB suite deliberately, not casually.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql` | create | Batch-header table + both RPCs replaced |
| `supabase/tests/template_hours_cascade.test.sql` | modify | pgTAP for the template restore |
| `src/integrations/supabase/types.ts` | regenerate | New table in the generated schema |
| `src/hooks/useShiftTemplates.tsx` | modify (`:182-208`) | RPC result type + Undo toast |
| `src/lib/scheduling/hoursChangeCopy.ts` | modify (`:234-238`) | Summary pick clause |
| `tests/unit/hoursChangeCopy.test.ts` | modify | Pick-clause coverage |
| `src/components/scheduling/ShiftPlanner/TemplateHoursImpact.tsx` | modify (`:57`, `:152`) | Drift disclosure default |
| `tests/unit/templateHoursImpact.test.tsx` | create | Disclosure-default coverage |
| `tests/e2e/template-hours-cascade.spec.ts` | modify | Both regression scenarios |

---

### Task 1: Batch header + template restore (SQL)

**Files:**
- Create: `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql`
- Test: `supabase/tests/template_hours_cascade.test.sql` (extend; currently `SELECT plan(34)`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `undo_template_hours_cascade(UUID, UUID)` returns JSONB with two new keys, `template_restored BOOLEAN` and `template_changed_since BOOLEAN`, alongside the existing `restored_count`, `changed_since_count`, `deleted_count`, `protected_count`. Task 2 consumes this shape.

- [ ] **Step 1: Write the failing pgTAP tests**

Append to `supabase/tests/template_hours_cascade.test.sql`, before `SELECT * FROM finish();`. Bump `SELECT plan(34)` at the top to `SELECT plan(46)`.

Follow the file's existing fixture conventions exactly: no hardcoded calendar dates (anchor to the next Monday after `CURRENT_DATE`), and build instants as `'<local timestamp>'::timestamp AT TIME ZONE '<iana>'`.

```sql
-- ============================================
-- Undo restores the template's hours (Bug 1)
-- ============================================

-- Fresh template + 2 future unlocked shifts matching it exactly.
INSERT INTO shift_templates (id, restaurant_id, name, position, days, start_time, end_time, break_duration, capacity)
VALUES ('e1000000-0000-4000-8000-000000000001', v_restaurant_a, 'Undo case', 'Server', ARRAY[1,2], '10:00', '16:30', 0, 1);

INSERT INTO shifts (id, restaurant_id, employee_id, shift_template_id, start_time, end_time, position, locked, is_published)
VALUES
  ('e1000000-0000-4000-8000-000000000011', v_restaurant_a, v_employee_a, 'e1000000-0000-4000-8000-000000000001',
   (v_next_monday || ' 10:00')::timestamp AT TIME ZONE 'America/Chicago',
   (v_next_monday || ' 16:30')::timestamp AT TIME ZONE 'America/Chicago', 'Server', false, false),
  ('e1000000-0000-4000-8000-000000000012', v_restaurant_a, v_employee_a, 'e1000000-0000-4000-8000-000000000001',
   ((v_next_monday::date + 1) || ' 10:00')::timestamp AT TIME ZONE 'America/Chicago',
   ((v_next_monday::date + 1) || ' 16:30')::timestamp AT TIME ZONE 'America/Chicago', 'Server', false, false);

-- Cascade: end 16:30 -> 17:30
SELECT update_shift_template_with_cascade(
  'e1000000-0000-4000-8000-000000000001', v_restaurant_a, 'Undo case', 'Server', NULL,
  ARRAY[1,2], 0, 1, '10:00'::time, '17:30'::time, true, ARRAY[]::uuid[]
) AS r \gset undo_cascade_

-- Test 35: a header row was written for this batch
SELECT is(
  (SELECT count(*)::int FROM template_hours_cascade_batches
   WHERE id = (:'undo_cascade_r'::jsonb->>'batch_id')::uuid),
  1,
  'cascade writes one batch header row'
);

-- Test 36: the header records the template hours from BEFORE the edit
SELECT results_eq(
  format($q$SELECT before_start_time, before_end_time, after_start_time, after_end_time
            FROM template_hours_cascade_batches WHERE id = %L$q$,
         (:'undo_cascade_r'::jsonb->>'batch_id')::uuid),
  $q$VALUES ('10:00'::time, '16:30'::time, '10:00'::time, '17:30'::time)$q$,
  'header records before and after template hours'
);

SELECT undo_template_hours_cascade(
  (:'undo_cascade_r'::jsonb->>'batch_id')::uuid, v_restaurant_a
) AS r \gset undo_result_

-- Test 37: the template is back to its pre-cascade hours
SELECT results_eq(
  $q$SELECT start_time, end_time FROM shift_templates
     WHERE id = 'e1000000-0000-4000-8000-000000000001'$q$,
  $q$VALUES ('10:00'::time, '16:30'::time)$q$,
  'undo restores the template hours'
);

-- Test 38: and says so
SELECT is((:'undo_result_r'::jsonb->>'template_restored')::boolean, true,
          'undo reports template_restored');
SELECT is((:'undo_result_r'::jsonb->>'template_changed_since')::boolean, false,
          'undo reports template_changed_since false on the happy path');

-- Test 40: THE REPORTED BUG. A second cascade after the undo must move the shifts.
SELECT update_shift_template_with_cascade(
  'e1000000-0000-4000-8000-000000000001', v_restaurant_a, 'Undo case', 'Server', NULL,
  ARRAY[1,2], 0, 1, '11:00'::time, '18:30'::time, true, ARRAY[]::uuid[]
) AS r \gset recascade_

SELECT is((:'recascade_r'::jsonb->>'updated_count')::int, 2,
          'a cascade after an undo still moves the shifts (the reported bug)');

-- Test 41: and the shifts really hold the new local hours
SELECT is(
  (SELECT count(*)::int FROM shifts
   WHERE shift_template_id = 'e1000000-0000-4000-8000-000000000001'
     AND (start_time AT TIME ZONE 'America/Chicago')::time = '11:00'
     AND (end_time   AT TIME ZONE 'America/Chicago')::time = '18:30'),
  2,
  'both shifts sit at the re-cascaded hours'
);
```

Then, in the same style, add:

- **Test 42** — *template changed since*: cascade a fresh template, then
  `UPDATE shift_templates SET start_time = '09:00' WHERE id = …`, then undo. Assert the
  template still reads `09:00`, `template_restored` is `false`, `template_changed_since` is
  `true`.
- **Test 43** — *restored when no shift is*: cascade a fresh template, then
  `UPDATE shifts SET locked = true WHERE shift_template_id = …`, then undo. Assert
  `restored_count = 0` **and** `template_restored = true` — the template comes back even when
  every shift is protected.
- **Test 44** — *no header when nothing moved*: call the cascade with `p_cascade = true` on a
  template whose only linked shift is locked. Assert `batch_id` is `NULL` and
  `SELECT count(*) FROM template_hours_cascade_batches` is unchanged.
- **Test 45** — *tenant isolation*: call `undo_template_hours_cascade(batch_of_A, v_restaurant_b)`.
  Assert restaurant A's template is untouched and `template_restored` is `false`.
- **Test 46** — *superseded batch*: cascade X (10:00→11:00), then cascade Y (11:00→12:00) on
  the same template, then `undo_template_hours_cascade(X)`. Assert the template still reads
  `12:00` (Y's value), `template_changed_since` is `true`, and `changed_since_count` equals
  the number of shifts Y re-touched.
- **Test 39** — *legacy batch*: `INSERT` a `schedule_change_logs` row with a
  `cascade_batch_id` that has no header row, then undo it. Assert no error, and both new
  flags are `false`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/template-cascade-undo-fix && npm run db:reset && npm run test:db
```

Expected: the new tests fail. Tests 35/36/44 fail with `relation "template_hours_cascade_batches" does not exist`; 37/38 fail because the template keeps `17:30`; 40/41 fail with `updated_count = 0` — that failure **is** the reported bug reproduced locally.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql`. It has three parts.

**Part A — the batch-header table:**

```sql
-- Why a table and not columns on shift_templates: one row per historical batch is
-- exactly what Undo needs, and columns could only ever hold the latest one.
-- Why not a shift_id-less row in schedule_change_logs: the "deleted since" probe in
-- undo_template_hours_cascade is a NOT EXISTS against shifts, so a shift-less row
-- would be miscounted as a deleted shift.
CREATE TABLE IF NOT EXISTS public.template_hours_cascade_batches (
  id                UUID PRIMARY KEY,
  restaurant_id     UUID NOT NULL REFERENCES public.restaurants(id)     ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE CASCADE,
  before_start_time TIME NOT NULL,
  before_end_time   TIME NOT NULL,
  after_start_time  TIME NOT NULL,
  after_end_time    TIME NOT NULL,
  changed_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.template_hours_cascade_batches IS
  'One row per update_shift_template_with_cascade call that actually moved shifts, '
  'keyed by the same batch id that tags the run''s schedule_change_logs rows. Records '
  'the template''s own before/after hours so undo_template_hours_cascade can restore '
  'them alongside the shifts. Written and read only by those two SECURITY DEFINER '
  'functions; no client has any privilege on it.';

-- No policies. Both writers are SECURITY DEFINER and bypass RLS; every other caller
-- gets zero rows. The REVOKE is belt and braces and keeps the table off PostgREST.
ALTER TABLE public.template_hours_cascade_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.template_hours_cascade_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.template_hours_cascade_batches TO service_role;
```

`id` is the PK and is supplied by the caller, so the Undo lookup needs no extra index.

**Part B — `CREATE OR REPLACE FUNCTION public.update_shift_template_with_cascade(...)`:** copy the entire body from `20260804130000_template_hours_cascade.sql:57-308` verbatim, including every comment, and make exactly one change — insert this immediately after the `SELECT count(*)::int, COALESCE(...) INTO v_updated_count, v_published_shifts FROM updated;` statement (`:284-297`) and before the `END IF;` at `:298`:

```sql
    -- Only when shifts actually moved: that is precisely when the RETURN below
    -- hands back a non-NULL batch_id and the client offers Undo. A header for a
    -- batch that moved nothing would be an unreachable row.
    IF v_updated_count > 0 THEN
      INSERT INTO public.template_hours_cascade_batches (
        id, restaurant_id, shift_template_id,
        before_start_time, before_end_time, after_start_time, after_end_time, changed_by
      )
      VALUES (
        v_batch_id, p_restaurant_id, p_template_id,
        -- v_old_start/v_old_end were captured at the FOR UPDATE read above, before
        -- this function's own UPDATE overwrote the template row.
        v_old_start, v_old_end, p_start_time, p_end_time, auth.uid()
      );
    END IF;
```

Re-emit the trailing `REVOKE`/`GRANT`/`COMMENT` for the function unchanged.

**Part C — `CREATE OR REPLACE FUNCTION public.undo_template_hours_cascade(p_batch_id UUID, p_restaurant_id UUID)`:** copy the body from `:327-460` verbatim and make three changes.

1. Add to `DECLARE`:

```sql
  v_template_id            UUID;
  v_before_start           TIME;
  v_before_end             TIME;
  v_after_start            TIME;
  v_after_end              TIME;
  v_cur_start              TIME;
  v_cur_end                TIME;
  -- Explicitly false, not plpgsql's NULL default: the legacy-batch path and the
  -- p_batch_id IS NULL early return both fall through without assigning these,
  -- and a null in the returned JSONB would diverge from what the client types.
  v_template_restored      BOOLEAN := false;
  v_template_changed_since BOOLEAN := false;
```

Add both keys to the early-return object so its shape matches the main return:

```sql
    RETURN jsonb_build_object(
      'restored_count', 0, 'changed_since_count', 0, 'deleted_count', 0,
      'protected_count', 0, 'template_restored', false,
      'template_changed_since', false
    );
```

2. Insert this block **before** the `WITH reverted AS (` statement at `:414`, after the
   `v_protected_count` SELECT:

```sql
  -- Restore the template's own hours. Without this the template keeps the hours
  -- the cascade wrote while its shifts go back to the old ones, and every later
  -- edit measures those shifts against a baseline they no longer share -- which
  -- classifies them as drifted forever. That desync is the bug this migration exists
  -- to fix.
  --
  -- Placed BEFORE the shifts UPDATE so this function acquires shift_templates then
  -- shifts, the same order update_shift_template_with_cascade uses (its FOR UPDATE
  -- on the template precedes the `target` CTE's FOR UPDATE on the shifts). Consistent
  -- lock ordering is what keeps a concurrent cascade and undo from deadlocking.
  SELECT b.shift_template_id, b.before_start_time, b.before_end_time,
         b.after_start_time,  b.after_end_time
    INTO v_template_id, v_before_start, v_before_end, v_after_start, v_after_end
  FROM public.template_hours_cascade_batches b
  WHERE b.id = p_batch_id
    AND b.restaurant_id = p_restaurant_id;

  -- No header: a batch from before this migration. Revert the shifts as before and
  -- leave both flags false. Not an error.
  IF FOUND THEN
    SELECT t.start_time, t.end_time
      INTO v_cur_start, v_cur_end
    FROM public.shift_templates t
    WHERE t.id = v_template_id
      AND t.restaurant_id = p_restaurant_id
    FOR UPDATE;

    IF FOUND THEN
      -- The same "still holds exactly what the cascade wrote" guard the shift revert
      -- applies below. Plain `=` rather than IS NOT DISTINCT FROM because
      -- shift_templates.start_time/end_time are TIME NOT NULL, unlike the shift
      -- columns. If a manager edited the template's hours after the cascade, that is
      -- a newer deliberate decision and Undo declines rather than destroying it.
      IF v_cur_start = v_after_start AND v_cur_end = v_after_end THEN
        UPDATE public.shift_templates
        SET start_time = v_before_start,
            end_time   = v_before_end,
            updated_at = now()
        WHERE id = v_template_id
          AND restaurant_id = p_restaurant_id;
        v_template_restored := true;
      ELSE
        v_template_changed_since := true;
      END IF;
    END IF;
  END IF;
```

Note the template is restored regardless of `v_restored_count`. Even when every shift is
locked or has started, the manager clicked Undo to reverse *their template edit*; leaving the
template on the new hours would be the same desync in a rarer shape.

3. Add both keys to the final `RETURN jsonb_build_object(...)` and update the
   `COMMENT ON FUNCTION` to mention the template restore.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/template-cascade-undo-fix && npm run db:reset && npm run test:db
```

Expected: all 46 tests pass, including the 34 pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260805160000_template_cascade_undo_restores_template.sql supabase/tests/template_hours_cascade.test.sql
git commit -m "fix(scheduling): undo restores the template's hours, not just its shifts"
```

---

### Task 2: Client types and the Undo toast

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated, do not hand-edit)
- Modify: `src/hooks/useShiftTemplates.tsx:182-208`

**Interfaces:**
- Consumes: `undo_template_hours_cascade`'s JSONB from Task 1 — `{ restored_count, changed_since_count, deleted_count, protected_count, template_restored, template_changed_since }`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Regenerate the Supabase types**

With local Supabase running and Task 1's migration applied:

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/template-cascade-undo-fix && npx supabase gen types typescript --local > src/integrations/supabase/types.ts
```

Expected: the diff adds a `template_hours_cascade_batches` entry under `Tables` and changes nothing else. If unrelated tables churn, the local DB is out of sync — `npm run db:reset` and regenerate.

- [ ] **Step 2: Widen the RPC result type**

In `src/hooks/useShiftTemplates.tsx`, the `undoMutation` `mutationFn` cast at `:182-187`:

```ts
      return data as {
        restored_count: number;
        changed_since_count: number;
        deleted_count: number;
        protected_count: number;
        template_restored: boolean;
        template_changed_since: boolean;
      };
```

- [ ] **Step 3: Add the one narrated exception to the toast**

In the same file, extend the `skippedReasons` array at `:198-202` with a fourth entry:

```ts
      const skippedReasons = [
        result.changed_since_count > 0 ? `${result.changed_since_count} changed since` : null,
        result.deleted_count > 0 ? `${result.deleted_count} deleted` : null,
        result.protected_count > 0 ? `${result.protected_count} now locked or started` : null,
        // Restoring the template is the expected case and is not narrated -- saying so
        // on every Undo would be noise. This is the case where the manager's mental
        // model and the data disagree, so it gets said out loud.
        result.template_changed_since ? 'template hours changed since' : null,
      ].filter(Boolean);
```

No other change: `invalidateCascadeQueries()` at `:190` already invalidates
`['shift_templates', restaurantId]` (`:144-148`), so a restored template refreshes on screen
without further work.

- [ ] **Step 4: Verify**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/template-cascade-undo-fix && npm run typecheck && npx vitest run tests/unit/useShiftTemplates.test.ts --reporter=verbose
```

Expected: typecheck clean. If no `useShiftTemplates` test file exists, skip the second command and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/supabase/types.ts src/hooks/useShiftTemplates.tsx
git commit -m "fix(scheduling): surface template restore state from the undo RPC"
```

---

### Task 3: The summary names the shifts they can pick

**Files:**
- Modify: `src/lib/scheduling/hoursChangeCopy.ts:226-238`
- Test: `tests/unit/hoursChangeCopy.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildHoursChangeLedger`'s `summary` string gains a trailing clause in one state. No signature change.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/hoursChangeCopy.test.ts`, following the file's existing `describe`/`it`
structure and its helper for building a `HoursChangeInput` (reuse it; do not hand-roll a
second fixture builder).

```ts
describe('buildHoursChangeLedger summary — pickable drift', () => {
  it('names the pickable shifts when nothing would move', () => {
    const ledger = buildHoursChangeLedger(input({
      movingCount: 0, driftedCount: 3, selectedDriftCount: 0, publishedCount: 0,
    }));
    expect(ledger.summary).toContain('0 shifts move.');
    expect(ledger.summary).toContain('3 hand-edited shifts you can pick.');
  });

  it('uses the singular for one pickable shift', () => {
    const ledger = buildHoursChangeLedger(input({
      movingCount: 0, driftedCount: 1, selectedDriftCount: 0,
    }));
    expect(ledger.summary).toContain('1 hand-edited shift you can pick.');
  });

  it('drops the clause once something is moving', () => {
    const ledger = buildHoursChangeLedger(input({
      movingCount: 0, driftedCount: 3, selectedDriftCount: 1,
    }));
    expect(ledger.summary).not.toContain('you can pick');
  });

  it('drops the clause when shifts already move on their own', () => {
    const ledger = buildHoursChangeLedger(input({
      movingCount: 2, driftedCount: 3, selectedDriftCount: 0,
    }));
    expect(ledger.summary).not.toContain('you can pick');
  });

  it('leaves the past/locked-only summary alone', () => {
    const ledger = buildHoursChangeLedger(input({
      movingCount: 0, driftedCount: 0, pastCount: 2, lockedCount: 1,
    }));
    expect(ledger.summary).not.toContain('you can pick');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/template-cascade-undo-fix && npx vitest run tests/unit/hoursChangeCopy.test.ts --reporter=verbose
```

Expected: the first two fail (`summary` stops at "0 shifts move."); the last three already pass.

- [ ] **Step 3: Add the clause**

In `src/lib/scheduling/hoursChangeCopy.ts`, `unpickedDrift` is already computed at `:226`
for the untouched line. Move nothing; add below the existing `movingClause` at `:235`:

```ts
  // Scoped to totalAffected === 0 deliberately. Once anything is moving, the chips
  // and the "Save & update N shifts" button already say so, and this line is
  // truncated on screen -- a second call to action would push the count off.
  const pickClause = totalAffected === 0 && unpickedDrift > 0
    ? ` ${unpickedDrift} hand-edited ${pluralize(unpickedDrift, 'shift', 'shifts')} you can pick.`
    : '';
```

and append `${pickClause}` to both branches of `summary` at `:236-238`:

```ts
  const summary = publishedCount > 0
    ? `${severityLabel}. ${deltaBadge}. ${movingClause}, ${publishedCount} already posted.${pickClause}`
    : `${severityLabel}. ${deltaBadge}. ${movingClause}.${pickClause}`;
```

`unpickedDrift` is declared at `:226`, above this point, so no reordering is needed. Verify
that before editing — if it is declared below, hoist the `const` rather than duplicating it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/template-cascade-undo-fix && npx vitest run tests/unit/hoursChangeCopy.test.ts --reporter=verbose
```

Expected: all pass, including every pre-existing assertion in the file. If a pre-existing
summary assertion breaks, it is asserting on an exact full string — update it to the new
expected text rather than weakening the fix.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduling/hoursChangeCopy.ts tests/unit/hoursChangeCopy.test.ts
git commit -m "fix(scheduling): ledger summary names the drifted shifts a manager can pick"
```

---

### Task 4: The drift disclosure opens when it is the only thing to do

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/TemplateHoursImpact.tsx:57`, `:152`
- Test: `tests/unit/templateHoursImpact.test.tsx` (create)

**Interfaces:**
- Consumes: `HoursChangeLedger.totalAffected` (unchanged shape).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/templateHoursImpact.test.tsx`. Check an existing component test in
`tests/unit/` first for the repo's render helper and jsdom setup, and follow it; if none
exists, use `@testing-library/react`'s `render` and `screen` directly.

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TemplateHoursImpact } from '@/components/scheduling/ShiftPlanner/TemplateHoursImpact';
import { buildHoursChangeLedger } from '@/lib/scheduling/hoursChangeCopy';

const drifted = [
  { shiftId: 's1', employeeName: 'Ada', localDate: 'Mon Aug 10', currentStart: '11:00', currentEnd: '19:00', isPublished: false, hoursDelta: 0 },
];

function renderPanel(overrides: { movingCount: number; selectedDriftCount: number }) {
  const ledger = buildHoursChangeLedger({
    oldStart: '10:00', oldEnd: '16:30', newStart: '11:00', newEnd: '17:30',
    publishedCount: 0, pastCount: 0, lockedCount: 0, driftedCount: 1, hoursDelta: 0,
    ...overrides,
  });
  return render(
    <TemplateHoursImpact
      ledger={ledger} drifted={drifted} selectedDriftIds={new Set()}
      onToggleDrift={() => {}} publishedCount={0} notify={false} onNotifyChange={() => {}}
      isLoading={false} error={null}
      oldStart="10:00" oldEnd="16:30" newStart="11:00" newEnd="17:30"
    />
  );
}

it('opens the drift disclosure when nothing else would move', async () => {
  const user = userEvent.setup();
  renderPanel({ movingCount: 0, selectedDriftCount: 0 });
  // The outer panel is collapsed by design; open it.
  await user.click(screen.getByRole('button', { name: /shifts? move/i }));
  expect(screen.getByRole('checkbox', { name: /Ada/ })).toBeInTheDocument();
});

it('leaves the drift disclosure closed when shifts already move', async () => {
  const user = userEvent.setup();
  renderPanel({ movingCount: 2, selectedDriftCount: 0 });
  await user.click(screen.getByRole('button', { name: /shifts? move/i }));
  expect(screen.queryByRole('checkbox', { name: /Ada/ })).not.toBeInTheDocument();
});

it('lets a manual toggle win over the default', async () => {
  const user = userEvent.setup();
  renderPanel({ movingCount: 0, selectedDriftCount: 0 });
  await user.click(screen.getByRole('button', { name: /shifts? move/i }));
  await user.click(screen.getByRole('button', { name: /hand-edited/i }));
  expect(screen.queryByRole('checkbox', { name: /Ada/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/template-cascade-undo-fix && npx vitest run tests/unit/templateHoursImpact.test.tsx --reporter=verbose
```

Expected: the first test fails (the checkbox is behind a second, closed disclosure); the other two pass.

- [ ] **Step 3: Make the default conditional**

In `TemplateHoursImpact.tsx`, replace the `driftOpen` state at `:57`:

```tsx
  // null means "no manual choice yet", so the default below can depend on `ledger`
  // -- which is null on the first render while the impact query is in flight, and so
  // cannot be read by a useState initialiser that runs exactly once.
  const [driftOpen, setDriftOpen] = useState<boolean | null>(null);
```

After the `if (!ledger) return null;` bail-out at `:77`, add:

```tsx
  // When nothing would move on its own, these checkboxes are the only thing the
  // manager can act on -- so they are not hidden behind a third click.
  const driftDefaultOpen = drifted.length > 0 && ledger.totalAffected === 0;
```

And at `:152`:

```tsx
              <Collapsible open={driftOpen ?? driftDefaultOpen} onOpenChange={setDriftOpen}>
```

The `expanded` state at `:56` and the outer `Collapsible` at `:85` are **not** changed —
keeping the form calm on open was a deliberate choice in PR #700, and Task 3's summary now
carries the signal that earns the click.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/template-cascade-undo-fix && npx vitest run tests/unit/templateHoursImpact.test.tsx --reporter=verbose && npm run typecheck
```

Expected: all three pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/TemplateHoursImpact.tsx tests/unit/templateHoursImpact.test.tsx
git commit -m "fix(scheduling): open the drift opt-in when it is the only action available"
```

---

### Task 5: Playwright regression coverage

**Files:**
- Modify: `tests/e2e/template-hours-cascade.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing.

- [ ] **Step 1: Read the existing spec**

Read `tests/e2e/template-hours-cascade.spec.ts` in full before writing. Reuse its existing
fixture setup, its `generateTestUser()` usage, its helpers from `'../helpers/e2e-supabase'`,
and its accessible selectors (`getByRole`, `getByLabel`). Do not introduce a second setup path.

- [ ] **Step 2: Add the Bug 1 round trip**

```ts
test('a cascade after an undo still moves the shifts', async ({ page }) => {
  // 1. Template with two future linked shifts at its exact hours.
  // 2. Edit hours 10:00-16:30 -> 10:00-17:30, save with the cascade.
  // 3. Click Undo in the toast; assert the shifts read 16:30 again.
  // 4. Edit hours again, 10:00 -> 11:00.
  // 5. Assert the primary button offers "Save & update 2 shifts" -- before this fix
  //    it read "Save changes" because the desynced template had reclassified both
  //    shifts as hand-edited.
  // 6. Save; assert both shifts moved.
});
```

Fill in each step against the existing spec's helpers. The assertion at step 5 is the one
that fails without Task 1.

- [ ] **Step 3: Add the Bug 2 opt-in path**

```ts
test('a manager can pick hand-edited shifts into the cascade', async ({ page }) => {
  // 1. Template with two linked shifts, both hand-edited away from the template hours.
  // 2. Edit the template's hours.
  // 3. Assert the collapsed summary names them: /hand-edited shifts you can pick/.
  // 4. Expand the panel; assert the drift checkboxes are visible WITHOUT a further click.
  // 5. Tick one; assert the primary button reads "Save & update 1 shift" and
  //    "Template only" has appeared.
  // 6. Save; assert that shift moved and the unticked one did not.
});
```

Step 3 fails without Task 3; step 4 fails without Task 4.

- [ ] **Step 4: Run the suite**

```bash
cd /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/template-cascade-undo-fix && npx playwright test tests/e2e/template-hours-cascade.spec.ts --reporter=line
```

Bound this with the Bash tool's own `timeout` parameter — no hand-rolled poll loops, and no
`ps aux | grep` process counting. If a dev server is needed underneath, start it with
`npm run dev & pid=$!` and `trap 'kill $pid 2>/dev/null' EXIT` so it dies with the shell on
the failure path too.

Expected: both new tests pass alongside the existing ones.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/template-hours-cascade.spec.ts
git commit -m "test(e2e): cover the undo round trip and the drift opt-in path"
```

---

## Out of scope

- **Repairing the three desynced rows on Home.** Read-only diagnosis is in the spec; the
  `UPDATE` is proposed separately with exact row counts and applied only on explicit
  approval. It never enters a migration.
- **Re-syncing drifted shifts without editing the hours.** `hoursChanged` gates the panel at
  `TemplateFormDialog.tsx:270`, so this needs a separate "re-sync shifts" affordance. That is
  the shipped design from PR #700, not a regression, and it is a feature, not a fix.
- **Cascading `days[]` or `capacity`.** Hours only, per the shipped scope.
