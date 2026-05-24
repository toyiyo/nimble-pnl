# Plan: AI Schedule LLM Date-Map Fix (Bug H)

Design doc: `docs/superpowers/specs/2026-05-23-ai-schedule-llm-date-map-design.md`

## Tasks

Each task is 2–5 minutes of focused work. RED → GREEN → REFACTOR → COMMIT
unless noted otherwise.

### T1 — Write failing tests for Target Week date-map (RED)

File: `tests/unit/schedule-prompt-builder.test.ts`

Add a new `describe` block (`buildSchedulePrompt — Target Week date map`)
with:

1. **All-seven exact pairs** — given `weekStart: "2026-06-08"`, assert
   the user prompt contains the literal strings
   `Monday    2026-06-08`, `Tuesday   2026-06-09`, `Wednesday 2026-06-10`,
   `Thursday  2026-06-11`, `Friday    2026-06-12`, `Saturday  2026-06-13`,
   `Sunday    2026-06-14` (Monday-first ordering, two-space gutter
   between the longest day name and the date — alignment is the visual
   anchor that helps the LLM read this as a map, not prose).
2. **No bare anchor** — assert the prompt does NOT contain the regex
   `/^Week starting: \d{4}-\d{2}-\d{2}$/m` (the failure mode form).
3. **Header line present** — assert the prompt contains the explicit
   "do not compute dates yourself" instruction so the LLM is told what
   the map is for.

Confirm the tests fail against current `schedule-prompt-builder.ts`.
Commit message: `test(scheduler): RED — assert Target Week date-map and no bare anchor`

### T2 — Implement Target Week date map (GREEN)

File: `supabase/functions/_shared/schedule-prompt-builder.ts`

1. Add a small helper inside the file (not exported):
   ```ts
   function buildWeekDateMap(weekStart: string): string {
     // Parse as UTC midnight and add ms in UTC so output is TZ-portable.
     // weekStart MUST be a YYYY-MM-DD Monday in restaurant-local terms.
     // DO NOT compose with schedule-validator.ts's getDayOfWeek — see
     // design doc "Helper-composition invariant" section.
     const base = new Date(`${weekStart}T00:00:00Z`);
     const rows: string[] = [];
     // Monday-first display order. weekStart is a Monday, so dayOffset
     // 0..6 maps to Mon..Sun.
     const labels = ['Monday   ', 'Tuesday  ', 'Wednesday', 'Thursday ',
                     'Friday   ', 'Saturday ', 'Sunday   '];
     for (let i = 0; i < 7; i++) {
       const d = new Date(base.getTime() + i * 86_400_000);
       const y = d.getUTCFullYear();
       const m = String(d.getUTCMonth() + 1).padStart(2, '0');
       const day = String(d.getUTCDate()).padStart(2, '0');
       rows.push(`  ${labels[i]} ${y}-${m}-${day}`);
     }
     return rows.join('\n');
   }
   ```

2. Replace the existing line:
   ```ts
   sections.push(`## Target Week\nWeek starting: ${ctx.weekStart}`);
   ```
   with:
   ```ts
   const dateMap = buildWeekDateMap(ctx.weekStart);
   sections.push(
     `## Target Week\nEach day of the week maps to this exact date. Use these dates verbatim in every shift you emit — do not compute dates yourself.\n${dateMap}`
   );
   ```

Run the T1 tests — they should now pass. Commit message:
`fix(scheduler): emit explicit day-name → date map in Target Week (Bug H)`

### T3 — Write failing test for inline dates in Required Headcount Per Slot (RED)

File: `tests/unit/schedule-prompt-builder.test.ts`

Extend the existing `Required Headcount Per Slot` test, OR add a new
`it` block, asserting that with `weekStart = "2026-06-08"` and a
`requiredStaff` Map containing template `tpl-1` with `{ 1: 2, 2: 2 }`,
the prompt contains:
- `Monday 2026-06-08: 2`
- `Tuesday 2026-06-09: 2`

(Day name + space + date + colon + count, no Tab/extra punctuation —
keeps the line scannable and the test brittle to formatting drift.)

Confirm the test fails against current code. Commit message:
`test(scheduler): RED — assert Required Headcount lines carry dates`

### T4 — Implement inline dates in Required Headcount Per Slot (GREEN)

File: `supabase/functions/_shared/schedule-prompt-builder.ts`

In the existing `## Required Headcount Per Slot` section builder
(roughly lines 195–214), change:
```ts
dayParts.push(`${DAY_NAMES[day] ?? `Day ${day}`}: ${count}`);
```
to use a small inline date computation derived from the same week
anchor. Reuse the helper from T2 — refactor it to also expose the
indexed date by day-of-week (0=Sun..6=Sat) so the call site here can do
`${DAY_NAMES[day]} ${dateForDayOfWeek(day)}: ${count}`.

Refactored helper signature:
```ts
function buildWeekDates(weekStart: string): {
  rows: string;          // Monday-first 7-row map used by Target Week
  byDayOfWeek: string[]; // 7-entry array indexed 0=Sun..6=Sat → YYYY-MM-DD
}
```

`buildWeekDates` parses `weekStart` once and returns both pieces, so the
Target Week section and the Required Headcount section share one
arithmetic path — no duplicate Date math drift risk.

Run the T1 + T3 tests — both pass. Commit message:
`fix(scheduler): inline calendar dates in Required Headcount lines (Bug H)`

### T5 — Refactor: lift `buildWeekDates` out of the user-prompt closure if needed

File: `supabase/functions/_shared/schedule-prompt-builder.ts`

If T4 left `buildWeekDates` called from two places inside
`buildUserPrompt`, lift it to a top-level helper (still not exported)
above `buildUserPrompt`. Keep all tests green. Skip this task if T4's
shape already had it as a top-level helper. Commit message (only if
non-empty): `refactor(scheduler): top-level buildWeekDates helper`

### T6 — Document helper-composition invariant

File: `supabase/functions/_shared/schedule-validator.ts`

Add a one-line JSDoc comment above `getDayOfWeek` (around line 71-73 per
design doc) pointing back to the prompt-builder helper:
```ts
/**
 * Day-of-week from a YYYY-MM-DD string emitted by the LLM. Uses local-
 * time `new Date(year, month-1, day)` so the calendar day named in the
 * string is the day measured. Do NOT compose with
 * `_shared/schedule-prompt-builder.ts::buildWeekDates`, which is
 * UTC-anchored on a caller-supplied weekStart — different inputs,
 * different anchor convention.
 */
```

No code change in `schedule-validator.ts`. All tests still pass.
Commit message: `docs(scheduler): document day-of-week helper-composition invariant`

## Dependencies

- T1 must run RED before T2.
- T3 must run RED before T4.
- T5 only fires if T4 left duplicated logic.
- T6 is independent and can land last.

## Out of scope (do not touch in this PR)

- `generate-schedule/index.ts:109-116` calendar-window math
  (pre-existing footgun).
- Validator code (`schedule-validator.ts` body — only a JSDoc comment
  changes per T6).
- Response schema in `schedule-prompt-builder.ts`'s `RESPONSE_FORMAT`.
- `useGenerateSchedule.ts` insert payload.
- Planner read path.
- Hourly sales / prior schedule patterns prompt sections.

## Acceptance

- `npm run test -- tests/unit/schedule-prompt-builder.test.ts` passes.
- `npm run typecheck` clean.
- `npm run lint` clean.
- `npm run build` clean.
- All other unit tests still pass (no regression).
- Lint/build/Supabase preview/Database tests (pgTAP) all green in CI.
