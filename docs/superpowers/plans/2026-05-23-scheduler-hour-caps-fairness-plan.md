# Plan: Scheduler Hour Caps & Fairness (Bug I)

Design doc: `docs/superpowers/specs/2026-05-23-scheduler-hour-caps-fairness-design.md`

## Tasks

Each task is 5–20 minutes of focused work. Strict TDD: RED → GREEN →
REFACTOR → COMMIT unless noted otherwise. The three layers in the spec
are built bottom-up (helper first, then validator, then prompt) so that
each layer's tests can rely on a stable contract from the layer below.

---

### T1 — RED: failing tests for `computeHourBudget` helper

File: `tests/unit/schedule-hour-budget.test.ts` (new)

Create a new test file. The helper does not exist yet — every test
fails on import.

```ts
import { describe, it, expect } from 'vitest';
import { computeHourBudget } from
  '../../supabase/functions/_shared/schedule-prompt-builder';
```

Cases (one `it` block each, per spec "Unit tests
(`tests/unit/schedule-hour-budget.test.ts`, new file)"):

1. Adult DOB → `{ is_minor: false, max_weekly_hours: 40 }`.
2. DOB 17.5 years before weekStart → `{ is_minor: true, max_weekly_hours: 40 }`.
3. DOB 14 years before weekStart → `{ is_minor: true, max_weekly_hours: 18 }`.
4. `null` DOB → adult 40.
5. `undefined` DOB → adult 40.
6. Malformed DOB (`"not-a-date"`, `"2010-13-40"`) → adult 40.
7. DOB in the future (one year after weekStart) → adult 40.
8. Invalid `weekStart` (`"not-a-date"`) → throws.
9. Birthday on the Friday of weekStart's week, employee turns 16 →
   still treated as 15 → `{ is_minor: true, max_weekly_hours: 18 }`.
10. **Birthday on Monday that IS weekStart, employee turns 16 →
    treated as 16** → `{ is_minor: true, max_weekly_hours: 40 }`.
    (Locks the inclusive-boundary rule from the spec.)
11. **TZ-portability case.** Sets `process.env.TZ = 'America/Chicago'`,
    asserts result. Resets `process.env.TZ = 'Pacific/Auckland'`,
    asserts identical result. Uses DOB `"2010-06-08"` and weekStart
    `"2026-06-08"` → both calls must return `{ is_minor: true,
    max_weekly_hours: 40 }` (turns 16 on Monday → 16yo minor, no 18h
    cap but still tagged minor). A local-time `new Date(year, monthIdx,
    day)` implementation will fail on at least one of the two TZs.

Run: `npm run test -- tests/unit/schedule-hour-budget.test.ts` —
expect import error / all-fail.

Commit: `test(scheduler): RED — assert computeHourBudget rules, DOB edge cases, TZ portability`

---

### T2 — GREEN: implement `computeHourBudget` + extend `ScheduleEmployee`

File: `supabase/functions/_shared/schedule-prompt-builder.ts`

1. Extend `ScheduleEmployee` interface (lines 9-16 per spec):

   ```ts
   export interface ScheduleEmployee {
     id: string;
     name: string;
     position: string;
     area: string | null;
     hourly_rate: number;
     employment_type: 'full_time' | 'part_time';
     /** Set by the edge function from employees.date_of_birth relative
      *  to weekStart. Null DOB → false (adult). */
     is_minor: boolean;
     /** Hard ceiling. Adults: 40. Under-16 minors: 18. 16-17yo: 40. */
     max_weekly_hours: number;
   }
   ```

2. Add `computeHourBudget` as an exported pure helper next to
   `buildWeekDates` (no new module):

   ```ts
   /**
    * Returns the weekly hour cap and minor flag for an employee.
    *
    * Both `dob` and `weekStart` are parsed as UTC midnight via
    * `new Date(\`${s}T00:00:00Z\`)` and compared with `.getUTC*()`
    * accessors so the result is identical across host TZs. Do NOT
    * use the local-time `new Date(year, monthIdx, day)` constructor —
    * see TZ-portability test in tests/unit/schedule-hour-budget.test.ts.
    *
    * Age is computed in full UTC years anchored on `weekStart` (the
    * first day of the schedule week). Birthday inclusive: an employee
    * who turns N on `weekStart` is age N.
    *
    * | DOB         | Age       | Result                            |
    * | ----------- | --------- | --------------------------------- |
    * | null/bad    | n/a       | { is_minor: false, max: 40 }      |
    * | future      | n/a       | { is_minor: false, max: 40 }      |
    * | ≥ 18        | adult     | { is_minor: false, max: 40 }      |
    * | 16-17       | minor 16+ | { is_minor: true,  max: 40 }      |
    * | < 16        | minor <16 | { is_minor: true,  max: 18 }      |
    *
    * @throws if weekStart is not a parseable YYYY-MM-DD string.
    */
   export function computeHourBudget(
     dob: string | null | undefined,
     weekStart: string,
   ): { is_minor: boolean; max_weekly_hours: number } {
     const weekDate = new Date(`${weekStart}T00:00:00Z`);
     if (Number.isNaN(weekDate.getTime())) {
       throw new Error(`Invalid weekStart: ${weekStart}`);
     }

     if (!dob) return { is_minor: false, max_weekly_hours: 40 };

     const dobDate = new Date(`${dob}T00:00:00Z`);
     if (Number.isNaN(dobDate.getTime())) {
       return { is_minor: false, max_weekly_hours: 40 };
     }

     // Future DOB → data error, treat as adult.
     if (dobDate.getTime() > weekDate.getTime()) {
       return { is_minor: false, max_weekly_hours: 40 };
     }

     // Age in full years, inclusive birthday.
     let age = weekDate.getUTCFullYear() - dobDate.getUTCFullYear();
     const beforeBirthday =
       weekDate.getUTCMonth() < dobDate.getUTCMonth() ||
       (weekDate.getUTCMonth() === dobDate.getUTCMonth() &&
        weekDate.getUTCDate() < dobDate.getUTCDate());
     if (beforeBirthday) age--;

     if (age < 16)  return { is_minor: true,  max_weekly_hours: 18 };
     if (age < 18)  return { is_minor: true,  max_weekly_hours: 40 };
     return            { is_minor: false, max_weekly_hours: 40 };
   }
   ```

3. Re-run T1 tests — all 11 pass. Run full suite `npm run test` —
   confirm no regression (the `ScheduleEmployee` shape change is
   additive; existing callers will fail to typecheck until T3, but
   nothing in Vitest's test path constructs a `ScheduleEmployee`
   literal directly — verify with `grep -rn "ScheduleEmployee" src
   tests supabase/functions`).

Commit: `feat(scheduler): computeHourBudget helper + ScheduleEmployee is_minor/max_weekly_hours`

---

### T3 — Wire `date_of_birth` into edge function pipeline

File: `supabase/functions/generate-schedule/index.ts`

1. **Line 134 (SELECT).** Add `date_of_birth` to the active-employee
   projection:

   ```ts
   .select('id, full_name, position, area, hourly_rate, employment_type, date_of_birth')
   ```

   (Adjust to match the existing column list — the spec confirms this
   is a zero-RLS, zero-migration change because the calling user
   already passes `user_has_capability(restaurant_id, 'view:employees')`.)

2. **Lines 247-255 (mapper).** Add `computeHourBudget` call:

   ```ts
   import {
     buildSchedulePrompt,
     buildWeekDates,
     computeHourBudget,           // NEW
     type ScheduleEmployee,
   } from '../_shared/schedule-prompt-builder.ts';

   // …inside the .map(e => …):
   const budget = computeHourBudget(e.date_of_birth, weekStartParam);
   return {
     id: e.id,
     name: e.full_name,
     position: e.position,
     area: e.area ?? null,
     hourly_rate: e.hourly_rate ?? 0,
     employment_type: e.employment_type ?? 'full_time',
     is_minor: budget.is_minor,
     max_weekly_hours: budget.max_weekly_hours,
   };
   ```

3. Typecheck: `npm run typecheck`. Expect clean. If the edge function
   has its own Deno-style import that the typecheck step skips, run
   `deno check supabase/functions/generate-schedule/index.ts` as a
   spot-check.

No tests in this task (the wiring is exercised by the integration
smoke at the end). Commit:
`feat(scheduler): pipe date_of_birth + computed hour budget into ScheduleEmployee`

---

### T4 — REFACTOR: promote `ValidationContext.employeeIds` to `employees: Map`

File: `supabase/functions/_shared/schedule-validator.ts` and
`tests/unit/schedule-validator.test.ts`

Mechanical shape change. Existing tests must stay green after this task.
No new behavior.

1. **Validator type change** (`schedule-validator.ts` lines ~24-38 per spec):

   ```ts
   export interface ValidationContext {
     /** Promoted from Set<string> + separate employeePositions Map.
      *  Existence check `employeeIds.has(id)` becomes `employees.has(id)`.
      *  Position check `employeePositions.get(id)` becomes
      *  `employees.get(id)?.position`. */
     employees: Map<string, {
       position: string;
       is_minor: boolean;
       max_weekly_hours: number;
     }>;
     templates: Map<string, { days: number[]; position: string }>;
     availability: Map<string, AvailabilitySlot>;
     excludedEmployeeIds: Set<string>;
     existingShifts: GeneratedShift[];
   }
   ```

   Delete the old `employeeIds: Set<string>` and `employeePositions:
   Map<string, string>` fields.

2. **Validator body** — replace every `ctx.employeeIds.has(id)` with
   `ctx.employees.has(id)`, every `ctx.employeePositions.get(id)` with
   `ctx.employees.get(id)?.position`. Confirm with
   `grep -n 'employeeIds\|employeePositions' supabase/functions/_shared/schedule-validator.ts`
   — must return zero hits after this task.

3. **Validator context build site** in `generate-schedule/index.ts`
   (look for where `buildValidationContext` or the inline context
   literal is constructed — search
   `grep -n 'employeeIds\|employeePositions\|ValidationContext' supabase/functions/generate-schedule/index.ts`).
   Replace the construction with the new `employees: Map` shape,
   populated from `ScheduleEmployee[]` so `is_minor` and
   `max_weekly_hours` flow through.

4. **Test factory** — `tests/unit/schedule-validator.test.ts:29-49`
   (`makeContext`). Replace the Set+Map construction with a single
   `employees: Map` builder. Add helper:

   ```ts
   function emp(id: string, position = 'Server',
                is_minor = false, max_weekly_hours = 40) {
     return [id, { position, is_minor, max_weekly_hours }] as const;
   }

   function makeContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
     return {
       employees: new Map([
         emp('emp-1'),
         emp('emp-2'),
         // …existing seed ids
       ]),
       templates: new Map([…]),
       availability: new Map([…]),
       excludedEmployeeIds: new Set(),
       existingShifts: [],
       ...overrides,
     };
   }
   ```

5. **Inline overrides** at lines 32-35, 136-137, 160-161, 200-201, 302,
   315, 328, 338, 351 (per spec's supabase-reviewer audit). Each site
   today builds something like `{ employeeIds: new Set([...]),
   employeePositions: new Map([...]) }` — replace with `{ employees:
   new Map([emp('emp-x', 'Cook'), …]) }`. Confirm with
   `grep -n 'employeeIds\|employeePositions' tests/unit/schedule-validator.test.ts`
   — must return zero hits.

6. Run `npm run test -- tests/unit/schedule-validator.test.ts` —
   ALL EXISTING tests pass. This is a pure refactor — no behavior
   change. Run `npm run typecheck` — clean.

Commit:
`refactor(scheduler): promote ValidationContext.employeeIds Set to employees Map`

---

### T5 — RED: failing tests for new validator step

File: `tests/unit/schedule-validator.test.ts`

Add a new `describe('validateShifts — hour caps and consecutive days', …)`
block. Every test fails because the new step does not exist yet.

Cases (per spec "Unit tests (`tests/unit/schedule-validator.test.ts`)"):

1. **`HOURS_EXCEED_WEEKLY_CAP` — adult 40h cap.** 6 × 6.5h shifts (39h)
   accept; 7th shift (+6.5h → 45.5h) drops with `HOURS_EXCEED_WEEKLY_CAP`.
2. **`MINOR_HOURS_EXCEEDED` — under-16 18h cap.** Employee with
   `max_weekly_hours: 18`: 3 × 6h shifts (18h) accept; 4th shift drops
   with `MINOR_HOURS_EXCEEDED`.
3. **Dispatch on cap value, NOT `is_minor`.** Employee with
   `is_minor: true, max_weekly_hours: 40` (a 16-17yo): 6 × 6.5h shifts
   accept; 7th shift drops with `HOURS_EXCEED_WEEKLY_CAP` (not
   `MINOR_HOURS_EXCEEDED`). Locks the dispatch rule.
4. **`CONSECUTIVE_DAYS_EXCEEDED`.** 5 shifts Mon–Fri accept; 6th shift
   on Sat drops with the code.
5. **Gap breaks the run.** Mon–Fri + Sun (no Sat): all 6 accept; no
   consecutive-days drop fires.
6. **Locked shifts seed the counter.** `existingShifts` puts employee
   at 35h already; candidate 7h shift drops with
   `HOURS_EXCEED_WEEKLY_CAP`.
7. **Locked shift already over cap.** Locked = 41h: locked shift stays
   in `valid`; new candidates for same employee drop. Validator does
   NOT retroactively drop locked shifts.
8. **Duplicate-day dedup.** Two locked shifts on the same Monday
   (open + close): `longestConsecutiveRun` counts Monday once.
   Subsequent Tue, Wed, Thu, Fri candidates all accept (5-day run not
   exceeded).
9. **Overnight shift counted correctly.** A 22:00→02:00 shift on Mon
   counts as 4h (one day's minutes), not 24h or two days.
10. **Order independence.** Same input shifts in random order produce
    the same valid set as chronological order. Locks the `(day,
    start_time, employee_id, template_id)` tiebreak.
11. **DST spring-forward.** With weekStart `"2026-03-02"` (Mon) and
    shifts Mon–Sun, the consecutive-day run is 7 (no false gap on
    DST day March 8). Anchors UTC-math correctness.

Run: `npm run test -- tests/unit/schedule-validator.test.ts` —
expect the 11 new tests to fail; existing tests still pass.

Commit:
`test(scheduler): RED — hour caps, consecutive days, dedup, order independence, DST`

---

### T6 — GREEN part 1: add DropCodes + `longestConsecutiveRun` helper

File: `supabase/functions/_shared/schedule-validator.ts`

1. Extend `DropCode` union:

   ```ts
   export type DropCode =
     | "EXCLUDED"
     | "UNKNOWN_EMPLOYEE"
     | "UNKNOWN_TEMPLATE"
     | "DAY_NOT_IN_TEMPLATE"
     | "POSITION_MISMATCH"
     | "UNAVAILABLE_DAY"
     | "OUTSIDE_WINDOW"
     | "DOUBLE_BOOKING"
     | "HOURS_EXCEED_WEEKLY_CAP"     // NEW
     | "CONSECUTIVE_DAYS_EXCEEDED"   // NEW
     | "MINOR_HOURS_EXCEEDED";       // NEW
   ```

2. Add `longestConsecutiveRun` helper (private, not exported):

   ```ts
   /**
    * Longest consecutive-day run within the input.
    * @param days Iterable of YYYY-MM-DD strings. Defensive dedup is
    *   applied even if a Set is passed — a duplicate day must not
    *   collapse the streak math into a zero-diff "gap."
    * @remarks Correct only for inputs spanning at most one ISO month;
    *   callers with multi-month inputs MUST sort by parsed Date.
    *   See design doc for the reasoning.
    */
   function longestConsecutiveRun(days: Iterable<string>): number {
     const sorted = [...new Set(days)].sort();
     if (sorted.length === 0) return 0;
     let max = 1, run = 1;
     for (let i = 1; i < sorted.length; i++) {
       const prev = Date.parse(`${sorted[i-1]}T00:00:00Z`);
       const cur  = Date.parse(`${sorted[i]}T00:00:00Z`);
       if (cur - prev === 86_400_000) run++;
       else { max = Math.max(max, run); run = 1; }
     }
     return Math.max(max, run);
   }
   ```

   Re-uses existing UTC parsing pattern; no new dependency.

3. Update the existing `getDayOfWeek` JSDoc to note that the new
   `longestConsecutiveRun` helper is the SAME-FILE counterpart for
   day-set math, but uses UTC anchoring — the two MUST NOT be
   composed.

Run `npm run typecheck` — clean (no test changes yet; T5 tests still
fail because the new validation step doesn't exist).

Commit (T6 + T7 in one commit OR T6 alone if running tight):
`feat(scheduler): add hour-cap DropCodes + longestConsecutiveRun helper`

---

### T7 — GREEN part 2: implement stateful validation step

File: `supabase/functions/_shared/schedule-validator.ts`

After the existing step 8 (`DOUBLE_BOOKING`), add a new stateful pass.
Per the spec's step-ordering invariant, this MUST run after
DOUBLE_BOOKING so duplicate-of-locked shifts get dropped before the
counter would double-count them.

1. Sort candidates (those that survived steps 1-8) by
   `day ASC, start_time ASC, employee_id ASC, template_id ASC`.
   Use `localeCompare` or string compare — all four fields are
   already strings on the validated shift.

2. Build the running state, seeded from `ctx.existingShifts`:

   ```ts
   type RunState = { minutesScheduled: number; daysScheduled: Set<string> };
   const state = new Map<string, RunState>();

   for (const locked of ctx.existingShifts) {
     const entry = state.get(locked.employee_id)
       ?? { minutesScheduled: 0, daysScheduled: new Set<string>() };
     const overnight =
       timeToMinutes(locked.end_time) <= timeToMinutes(locked.start_time);
     const mins =
       timeToMinutes(locked.end_time) - timeToMinutes(locked.start_time)
       + (overnight ? 1440 : 0);
     entry.minutesScheduled += mins;
     entry.daysScheduled.add(locked.day);
     state.set(locked.employee_id, entry);
   }
   ```

   Use `timeToMinutes` already defined at `schedule-validator.ts:86-89`
   — do NOT introduce a new helper.

3. Iterate sorted candidates:

   ```ts
   for (const s of sortedCandidates) {
     const meta = ctx.employees.get(s.employee_id)!;  // guaranteed by step 2
     const entry = state.get(s.employee_id)
       ?? { minutesScheduled: 0, daysScheduled: new Set<string>() };

     const overnight =
       timeToMinutes(s.end_time) <= timeToMinutes(s.start_time);
     const shiftMinutes =
       timeToMinutes(s.end_time) - timeToMinutes(s.start_time)
       + (overnight ? 1440 : 0);

     const proposedMinutes = entry.minutesScheduled + shiftMinutes;
     if (proposedMinutes > meta.max_weekly_hours * 60) {
       const code: DropCode = meta.max_weekly_hours === 18
         ? "MINOR_HOURS_EXCEEDED"
         : "HOURS_EXCEED_WEEKLY_CAP";
       dropped.push({ shift: s, code });
       continue;
     }

     const proposedDays = new Set(entry.daysScheduled).add(s.day);
     if (longestConsecutiveRun(proposedDays) > 5) {
       dropped.push({ shift: s, code: "CONSECUTIVE_DAYS_EXCEEDED" });
       continue;
     }

     // Commit.
     entry.minutesScheduled = proposedMinutes;
     entry.daysScheduled = proposedDays;
     state.set(s.employee_id, entry);
     valid.push(s);
   }
   ```

4. Document the step-ordering invariant directly above the new pass
   so a future refactor cannot silently reorder:

   ```ts
   // INVARIANT: This pass MUST run after DOUBLE_BOOKING. The counter is
   // seeded from existingShifts once; if a candidate is a duplicate of
   // a locked shift, DOUBLE_BOOKING drops it before its minutes would
   // be double-counted. Reordering this above DOUBLE_BOOKING is a
   // silent cap-leak bug.
   ```

5. Re-run all validator tests: `npm run test -- tests/unit/schedule-validator.test.ts` —
   all 11 new tests pass, all pre-existing tests still pass.

Commit:
`feat(scheduler): stateful hour-cap + consecutive-day validator step`

---

### T8 — COUPLED: extend `droppedReasons` switch in edge function

File: `supabase/functions/generate-schedule/index.ts`

Per the spec's "Diagnostic summary mapping" section, the validator
DropCode union and the `droppedReasons` switch at lines 644-664 are a
coupled change. Without this task, the three new codes fall into the
`default` branch and the UI shows `"Unknown drop reason on <date>"`.

1. Add three new `case` clauses to the switch:

   ```ts
   case "HOURS_EXCEED_WEEKLY_CAP":
     return `Weekly hour cap exceeded on ${day}`;
   case "CONSECUTIVE_DAYS_EXCEEDED":
     return `More than 5 consecutive days on ${day}`;
   case "MINOR_HOURS_EXCEEDED":
     return `Minor over 18h cap on ${day}`;
   ```

2. Keep the `default` branch as the safety net.

3. Confirm `drop_reason_summary` (validator-side string) and the
   `droppedReasons` array (built by this switch) now agree for the
   three new codes. Spot-check by searching
   `grep -n 'drop_reason_summary\|droppedReasons' supabase/functions/generate-schedule/index.ts`.

No test changes (the switch is plain string-mapping; covered by the
manual smoke at T11).

Commit:
`fix(scheduler): map new DropCodes to diagnostic strings (coupled with validator)`

---

### T9 — RED: failing tests for prompt rules + Employee Hour Budgets section

File: `tests/unit/schedule-prompt-builder.test.ts`

Extend the existing file.

1. **HARD Rules 11, 12 present in source text** (positive assertion):
   - `"11. (HARD) No employee may be scheduled for more total weekly hours"`
   - `"12. (HARD) No employee may work more than 5 consecutive calendar days"`
   - `"14. When multiple eligible-and-available employees can fill the same slot, prefer the employee with the most remaining hours"`
2. **Old soft Rule 11 absent** (negative assertion):
   - `"Full-time employees should be scheduled for more shifts, targeting 35-40 hours per week"`
   should NOT appear.
3. **Rule 13 carve-out language**:
   - `"OR if every remaining eligible employee would violate Rules 11 or 12"`
4. **"Employee Hour Budgets" section renders** with one adult row and
   one minor row given an `employees` array containing both:
   - The exact line `"  Aleah Holderread     | minor  | max 18h"` (or
     similar — name/padding shape per spec) MUST appear.
   - The exact line `"  Ivy Benavides        | adult  | max 40h"` MUST
     appear.
5. **Section header present**:
   - `"## Employee Hour Budgets"`
   - `"Each row lists the maximum hours each employee may be scheduled for"`

Run: `npm run test -- tests/unit/schedule-prompt-builder.test.ts` —
expect the 5 new test cases to fail; existing tests still pass.

Commit: `test(scheduler): RED — assert HARD Rules 11/12/14, hour-budget table, Rule 13 carve-out`

---

### T10 — GREEN: implement prompt changes

File: `supabase/functions/_shared/schedule-prompt-builder.ts`

1. **SYSTEM_PROMPT RULES** (lines 154-166 per spec). Replace the
   current Rule 11 (soft) with the two new HARD rules (11 + 12),
   renumber the existing HARD "Fill every required slot" to Rule 13
   with the new carve-out clause, and add Rule 14:

   ```text
   11. (HARD) No employee may be scheduled for more total weekly hours
       than their "Max Hours This Week" value in the Employee Hour
       Budgets section below. This is a hard ceiling — never assign a
       shift that would push an employee over their max, even if it
       leaves a slot under-filled. Refer back to the budget table for
       each assignment.
   12. (HARD) No employee may work more than 5 consecutive calendar
       days within this week. If an employee is assigned shifts on
       Monday through Friday, they may not also be assigned Saturday
       or Sunday.
   13. (HARD) Fill every required slot: for every (template, day) listed
       in "Required Headcount Per Slot", you MUST assign the required
       number of eligible-and-available employees. A slot may only be
       left below required headcount if there is NO eligible-and-available
       employee for it OR if every remaining eligible employee would
       violate Rules 11 or 12 by accepting the shift.
   14. When multiple eligible-and-available employees can fill the same
       slot, prefer the employee with the most remaining hours in their
       weekly budget. Break ties alphabetically by employee name (then
       by employee id if names also tie) so re-running generation for
       the same inputs yields the same assignment, not a random one.
       This spreads hours across the full roster and keeps employees
       off the brink of their cap.
   ```

2. **New "Employee Hour Budgets" section** rendered in
   `buildUserPrompt` between the existing `## Employees` and
   `## Templates` sections:

   ```ts
   function buildEmployeeHourBudgets(employees: ScheduleEmployee[]): string {
     if (employees.length === 0) return '';
     // Pad employee name to the longest name + 2 for visual alignment.
     const nameWidth = Math.max(...employees.map(e => e.name.length)) + 2;
     const rows = employees.map(e => {
       const namePadded = e.name.padEnd(nameWidth);
       const minorTag = e.is_minor ? 'minor ' : 'adult ';
       return `  ${namePadded}| ${minorTag} | max ${e.max_weekly_hours}h`;
     });
     return [
       '## Employee Hour Budgets',
       'Each row lists the maximum hours each employee may be scheduled for this week. Do not compute these yourself — use the value here.',
       '',
       ...rows,
     ].join('\n');
   }
   ```

   Inject into the `sections.push(...)` chain between Employees and
   Templates.

3. Re-run T9 tests — all 5 pass. Run full prompt-builder suite
   (`npm run test -- tests/unit/schedule-prompt-builder.test.ts`) —
   pre-existing tests still pass.

Commit: `feat(scheduler): HARD hour-cap rules + Employee Hour Budgets prompt section`

---

### T11 — Full verification gate

Run sequentially:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

All must be clean. If lint flags the new helper (e.g. unused-param,
prefer-const), fix inline — no separate commit unless the fix is
non-trivial.

Commit only if any fix is needed; otherwise this is a no-op gate.

---

### T12 — Manual smoke (UI + diagnostic)

1. `npm run dev:full`
2. Open the scheduler at a restaurant with the AI generator enabled
   (per the spec: ideally one with both FT and PT staff, and ideally
   one minor on roster — but smoke is still meaningful without).
3. Trigger `Generate Schedule` for any week.
4. Confirm in the planner UI:
   - No employee is shown with >40h total for the week.
   - No employee is shown with shifts on 6+ consecutive days.
   - Previously idle PT employees now appear in the output (compare
     against the symptom table in the spec).
5. If any shifts were dropped by the new validator step, confirm the
   diagnostic toast shows the new reason strings (NOT
   `"Unknown drop reason on <date>"`).
6. If the restaurant has at least one minor with a populated DOB,
   confirm their total hours are within their cap (18h or 40h
   depending on age).

Per CLAUDE.md "if you can't test the UI, say so explicitly rather
than claiming success." Document the smoke result in `progress.md`.

---

## Dependencies

```text
T1 → T2 → T3
              ↘
T4 → T5 → T6 → T7 → T8 ──→ T9 → T10 → T11 → T12
```

- T1-T2 are the helper foundation; T3 wires it through. None of T4-T10
  can be merged without T2 because they all depend on the
  `ScheduleEmployee.is_minor` and `max_weekly_hours` fields.
- T4 is a pure refactor with no behavior change — must keep existing
  tests green before any new test is written.
- T5 → T6 → T7 are the validator RED → GREEN sequence.
- T8 is a coupled change that MUST land in the same PR as T6-T7 (the
  spec calls this out explicitly).
- T9 → T10 are the prompt RED → GREEN sequence; they depend on T2
  for the new `ScheduleEmployee` fields.

## Out of scope (do NOT touch in this PR)

- Daily hour caps for minors under 16 (FLSA 3h school day / 8h
  non-school day) — requires school-calendar source.
- State-specific child labor rules — federal FLSA only for v1.
- Cross-week hour tracking.
- Cross-week consecutive-day counting.
- Per-employee custom `max_weekly_hours` override column or UI.
- UI for entering `date_of_birth` (already exists on onboarding form).
- Re-prompting on validator drop.
- "Minor" badge in the planner UI.
- Any RLS or migration change (auth posture analysis confirmed none
  needed — see spec's "Auth posture (review correction)" paragraph).

## Acceptance

- `npm run typecheck` clean.
- `npm run lint` clean.
- `npm run test` all pass (including the 5 new prompt-builder tests,
  the 11 new validator tests, and the 11 new hour-budget tests).
- `npm run build` clean.
- `npm run test:db` (pgTAP) still green — no DB changes in this PR.
- Lint/build/Supabase preview/Database tests all green in CI.
- Manual smoke (T12) confirms the symptom from the spec is resolved
  on at least one real restaurant.
- `drop_reason_summary` and `droppedReasons` agree for all three new
  codes (no `"Unknown drop reason"` fallback fires for them).
