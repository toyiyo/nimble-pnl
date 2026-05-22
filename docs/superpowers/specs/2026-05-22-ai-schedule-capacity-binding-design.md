# Design: AI schedule under-generation + template-binding fixes

**Status:** draft
**Author:** Claude (paired with @jdelgado)
**Date:** 2026-05-22
**Branch:** `fix/ai-schedule-capacity-binding`
**Follow-up to:** PR #506 (`feat(scheduling): AI generator …`)

## Problem

After PR #506 wired up AI schedule generation, a real restaurant
(`7c0c76e3-e770-401b-a2a9-c1edd407efed`, Cold Stone + Wetzel's,
America/Chicago, 25 servers + 2 managers, 8 active shift templates summing
to **69 required weekly slots**) generated a schedule with ~28 of 69 slots
filled and many shifts assigned to weekend-only templates on weekdays.

Symptoms in the UI:

- "Need 4" appearing as `0/4` on weekdays for several close-shift templates.
- Open-weekend templates ending up populated on Mondays.
- Cold Stone vs Wetzel's templates appearing to bind arbitrarily — same
  employee toggling between areas across renders.

## Evidence

From the production OpenRouter run (Gemini 2.5 Flash, `finish_reason=stop`,
2020 completion tokens — not truncated):

- The `Required Headcount Per Slot` section listed every (template, day)
  as **1** despite templates having capacities of 2/3/4.
- The model returned **28 shifts**. 24 were persisted to `shifts`. All
  persisted rows had `shift_template_id = NULL`.
- 4 shifts assigned a weekend-only template (`days = [0,5,6]`) to
  Monday Jun 1. Two of those four survived validation purely because the
  employees were independently available 10:00–16:30 on Monday.

Conclusion: at least three independent bugs combine to produce the
observed state.

## Root causes

### Bug A — `computeRequiredStaff` ignores `tpl.capacity`

`supabase/functions/_shared/staffing-requirements.ts:102` computes per-slot
demand as:

```ts
const base = fromMinCrew ?? fromPattern ?? 1;
```

`tpl.capacity` (the manager's stated headcount per template) is never
consulted. For brand-new restaurants — no `staffing_settings` row, no
prior schedule patterns — every (template, day) collapses to base = 1.
The LLM is asked to fill 1 each and dutifully complies. The UI's "Need N"
column is rendered from `shift_templates.capacity`, so the gap
(`X/N` where X < N) is structural, not a model failure.

### Bug B — `shift_template_id` stripped on persist

`src/hooks/useGenerateSchedule.ts:104-126` maps LLM output into
`shifts` rows but does **not** include `shift_template_id`. The LLM
returns a correct `template_id` on every shift; the hook drops it.

Downstream consequence in `src/hooks/useShiftPlanner.ts:142-160`: the
planner can no longer bucket a shift by its template id, so it falls back
to a (start_time, end_time, position, day_of_week) match. When Cold Stone
and Wetzel's have identical time slots for the same position, the match
is non-deterministic — the same shift can appear under either area
depending on template fetch order.

### Bug C — Validator does not check the template's active days

`supabase/functions/_shared/schedule-validator.ts:220-319` validates
position, availability, time window, and double-booking, but never
checks that the shift's day-of-week is in `template.days`. In the prod
run this allowed weekend-only templates to land on Monday; only the
incidental availability/window checks dropped two of the four —
the other two persisted and rendered correctly under the wrong template.

### Bug D — Prompt Rule 1 does not constrain templates to their active days

`SYSTEM_PROMPT` Rule 1 in `schedule-prompt-builder.ts`:

> ONLY use the provided shift templates as shift blocks — do not invent
> custom time ranges.

This tells the LLM to use templates but is silent on which days each
template covers. The "active days" line is rendered later in the user
prompt, but absent an explicit rule the model treats it as advisory.
Bug D and Bug C are twins: the prompt is the soft contract, the
validator is the hard one. Tightening both shuts the loophole on both
sides.

## Non-causes (ruled out)

- **Area handling**: Rule 3 (soft area preference) is honored. Colin →
  Wetzel's, Ivy → Cold Stone, etc. The "wrong area" symptom is entirely
  Bug B downstream — once `shift_template_id` is persisted, the planner
  buckets by id and area is implicit. No prompt or validator change is
  needed for area.
- **Model finish-reason / truncation**: `finish_reason=stop`, ample
  remaining tokens. Not a generation-limit issue.
- **Availability data corruption**: PR #509 + PR #510 already fixed the
  prior local→UTC bug. Spot-checked the relevant rows post-cleanup.

## Fix plan — single PR, four commits

Each commit is independently revertable; all four ship together.

### Commit 1 — Capacity-based required-staff floor (Bug A)

**Files:**
- `supabase/functions/_shared/schedule-prompt-builder.ts` — add
  `capacity: number` to `ScheduleTemplate`.
- `supabase/functions/_shared/staffing-requirements.ts` — change the
  fallback chain to `fromMinCrew ?? fromPattern ?? tpl.capacity ?? 1`.
  Existing `Math.max(base + peakBoost, floor)` is preserved; only the
  base default is widened.
- `supabase/functions/generate-schedule/index.ts:138` — add `capacity`
  to the `shift_templates` select.
- `supabase/functions/generate-schedule/index.ts:257-265` — carry
  `capacity: t.capacity ?? 1` into the mapper.

**Semantic guarantee:** restaurants with `min_crew` or prior patterns
are unaffected (those branches still win). Only the "no settings yet"
case changes, and the change is in the correct direction (toward the
manager's stated capacity).

**Tests:**
- `tests/unit/staffing-requirements.test.ts` — add cases:
  - No settings + template capacity 4 → required = 4 per active day.
  - Capacity 4 + peak boost on that hour → 5 (`base + peakBoost`).
  - `min_crew = 5` + capacity = 2 → 5 (override still wins).
  - Pattern = 3 + capacity = 4 → 3 (pattern still wins per existing
    semantics; documented in test name).

### Commit 2 — `DAY_NOT_IN_TEMPLATE` validator (Bug C)

**Files:**
- `supabase/functions/_shared/schedule-validator.ts`:
  - Add `DAY_NOT_IN_TEMPLATE` to the `DropCode` union.
  - Replace `templateIds: Set<string>` in `ValidationContext` with
    `templates: Map<string, { days: number[] }>`. `templateIds` is a
    derivation of `templates.keys()` so the existing UNKNOWN_TEMPLATE
    check stays correct.
  - Insert the new check between step 3 (UNKNOWN_TEMPLATE) and step 4
    (POSITION_MISMATCH): if the template's `days` doesn't include
    `getDayOfWeek(shift.day)`, drop with `DAY_NOT_IN_TEMPLATE`.
- `supabase/functions/generate-schedule/index.ts`:
  - Build the new `templates` map and feed it into `validationCtx`.
  - Add `case "DAY_NOT_IN_TEMPLATE":` to the `droppedReasons` switch.

**Why replace `templateIds` instead of adding a sibling field:** the
context already requires the validator to know the template exists; now
it needs to know its days. The set is a strict subset of the map's
information, so deriving the existence check from `templates.has(id)`
keeps the API surface minimal. Cost is mechanical updates to existing
validator tests (`templateIds: new Set(['t1'])` →
`templates: new Map([['t1', { days: [...] }]])`).

**Tests:**
- New: a Monday shift whose `template.days = [0,5,6]` is dropped with
  code `DAY_NOT_IN_TEMPLATE`.
- New: a Monday shift whose `template.days = [1,2,3,4,5]` passes the
  check (continues into POSITION_MISMATCH territory in the existing
  test cases).
- Existing tests updated to the new `templates` shape.

### Commit 3 — Tighten SYSTEM_PROMPT Rule 1 (Bug D)

**Files:**
- `supabase/functions/_shared/schedule-prompt-builder.ts` — rewrite
  Rule 1 to: "ONLY use the provided shift templates as shift blocks —
  do not invent custom time ranges, AND only on the days listed in
  that template's 'active days' (Shift Templates section)."

**Tests:**
- Snapshot test on `buildSchedulePrompt`'s system message containing
  the new clause. (Not a brittle full-prompt snapshot — a substring
  assertion against the system message.)

### Commit 4 — Persist `shift_template_id` (Bug B)

**Files:**
- `src/hooks/useGenerateSchedule.ts`:
  - Widen `GeneratedShift.template_id` from `string` to
    `string | null | undefined` so the type matches runtime reality
    (the LLM sometimes emits empty strings; the schema accepts NULL).
  - Add `shift_template_id: shift.template_id?.trim() || null` to the
    insert payload. The `?.trim() || null` idiom collapses `undefined`,
    `""`, and whitespace-only strings to NULL while preserving any
    real UUID. Plain `|| null` would also work here (UUIDs are never
    falsy strings), but the trim variant is explicit about the empty-
    string case the design is guarding against, and is safe if
    `template_id` ever widens to non-string types in future.
- `src/hooks/useShiftPlanner.ts:142-160`: keep the legacy fallback
  match path (manually-created shifts and the 24 in-flight AI rows
  from the debug session still rely on it). Add a one-line comment
  documenting why it stays.

**Tests:**
- `tests/unit/useGenerateSchedule.test.tsx` — strengthen the existing
  `insertMock` to capture call arguments, and assert:
  - With a real `template_id` on the LLM response, the inserted row
    carries that value in `shift_template_id`.
  - With an empty string `template_id`, the inserted row has
    `shift_template_id: null`.
  - The other fields (start/end UTC conversion, status, source) are
    unchanged.

## Risk + rollback

- **Schema:** no *new* migration. Both
  `shift_templates.capacity` (added in
  `20260411221543_add_capacity_to_shift_templates.sql`, with
  `DEFAULT 1` and `CHECK (capacity >= 1)`) and `shifts.shift_template_id`
  (added in `20260416000000_add_shift_template_id.sql`, nullable with a
  partial index) already exist in production. The mapper's
  `?? 1` fallback for capacity is defensive against client-side test
  fixtures that omit the field; the DB constraint guarantees the floor
  in real data.
- **Backward compat for the validator API:** the `ValidationContext`
  shape changes (`templateIds` → `templates`). This is a *shared
  internal type* — only `generate-schedule/index.ts` and the
  validator's own tests construct one. Search confirms zero external
  callers. Safe to rename.
- **Backward compat for the prompt:** prompt change is purely additive
  wording. Older deployments without it still produce valid shifts;
  the validator (Bug C) backs it up regardless.
- **Backward compat for the hook:** older clients with the bundle that
  predates this PR will still insert rows with NULL
  `shift_template_id`, which the planner handles. No DB migration
  needed to repair existing NULL rows — they remain bucketable by the
  fallback path and will be replaced on the next AI regen.
- **Rollback:** revert the PR. No data shape changes to undo.

## Test plan

- Unit: `staffing-requirements.test.ts`, `schedule-validator.test.ts`,
  `schedule-prompt-builder.test.ts`, `useGenerateSchedule.test.tsx`.
- Edge function: `generate-schedule` is exercised indirectly by the
  hook test (mocked invoke) and by manual end-to-end on the affected
  restaurant.
- Manual verification (post-merge, optional follow-up): regenerate the
  schedule for the affected restaurant and confirm the grid fills to
  N/N per template.

## Out of scope

- Reworking `min_crew` semantics (currently an override, not a floor).
  Two managers have asked about this; tracked separately.
- Capacity-floor for restaurants that DO have `min_crew` set below
  their template capacity. Today `min_crew = 1` + `capacity = 4`
  resolves to 1; arguably should be 4. Defer until we have data on
  whether anyone actually relies on `min_crew` as a cap.
- Surfacing `DAY_NOT_IN_TEMPLATE` as a distinct toast (it folds into
  the existing "X suggestions filtered out" message).
- Migration to backfill `shift_template_id` on the 24 in-flight AI
  rows from the prod debug session. Those rows are visible (planner
  fallback works) and will be overwritten on next regen.
