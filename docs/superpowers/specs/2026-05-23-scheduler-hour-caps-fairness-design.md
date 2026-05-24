# Scheduler Hour Caps & Fairness (Bug I)

**Status:** Reviewed (supabase + sound-logic findings folded)
**Date:** 2026-05-23
**Branch:** `fix/scheduler-hour-caps-fairness`

## Summary

The AI schedule generator now lands shifts on the correct dates (Bug H,
PR #516), but distributes hours badly: full-time and part-time employees
are stacked to ~45–48h on 7 consecutive days while ~14 other available
employees get zero hours. There is no hard ceiling for weekly hours,
no consecutive-days rule, and no concept of "minor" anywhere in the
schedule pipeline.

This change pushes those constraints into all three layers that already
exist for templates and positions:

1. **Prompt** — promote workload distribution from a soft preference
   (Rule 11) to HARD rules with a pre-computed per-employee hour-budget
   table the LLM does not have to compute itself.
2. **Schema/edge function** — extend `ScheduleEmployee` with
   `is_minor` and `max_weekly_hours` derived from existing
   `employees.date_of_birth`; pipe them through `generate-schedule`.
3. **Validator** — add three new drop reasons
   (`HOURS_EXCEED_WEEKLY_CAP`, `CONSECUTIVE_DAYS_EXCEEDED`,
   `MINOR_HOURS_EXCEEDED`) as a deterministic backstop so an LLM lapse
   never reaches `shifts` insert.

## Background

### Observed symptom (one real run, week of 2026-06-08)

Across 9 employees the LLM emitted 6.5–7.5h shifts every single day of
the week:

| Employee | Type | Total | Days |
|---|---|---|---|
| Ivy Benavides | FT | 45.5h | 7 |
| Emmalynn Hoover | FT | 45.5h | 7 |
| Natalie Garza | FT | 45.5h | 7 |
| Colin Kuehn | FT | 45.5h | 7 |
| Reba Navarro | FT | 48.5h | 7 |
| Aubrey Large | FT | 48.5h | 7 |
| Nicole Crosson | FT | 48.5h | 7 |
| Termora Johnson | **PT** | 48.5h | 7 |
| Lynnette Lewis | **PT** | 48.5h | 7 |

One full-time employee (Noah Santillano) and thirteen part-time
employees received zero shifts. Only two PT employees landed in the
~22h target band. The LLM did obey availability and template rules —
it just stacked the same 9 people because nothing told it not to.

### Why the LLM does this

The current prompt (`_shared/schedule-prompt-builder.ts:154-166`) has:

- Rule 11 (soft preference): "Full-time employees should be scheduled
  for more shifts, targeting 35-40 hours per week. Part-time employees
  should be scheduled for fewer shifts, targeting 15-25 hours per week."
- Rule 12 (HARD): "Fill every required slot."

Rule 12 is HARD; Rule 11 is soft. The LLM honors hard constraints and
treats soft ones as advisory — that's correct behavior, and the
output proves it. No HARD rule exists for any of:

- Maximum hours per employee per week.
- "No overtime" (≤40h, regardless of preference targets).
- Maximum consecutive days per employee.
- Minor hour limits.

The prompt also asks the LLM to *track* each employee's running hours
across slots in order to apply the soft preference. LLMs are bad at
arithmetic over many items (Bug H established the same lesson for
calendar math). Anything we ask the model to compute, it will drift on.

### Root causes (the four problems behind the symptom)

1. **Soft preference instead of HARD constraint** for ≤40h/wk and
   zero overtime.
2. **No consecutive-day rule** anywhere in prompt or validator.
3. **No minor concept in the schedule path.** `employees.date_of_birth`
   exists (migration `20260413100000_add_employee_employment_type_dob`)
   and is on `EmployeeWithAvailability`, but never crosses into
   `ScheduleEmployee` or the prompt.
4. **LLM-computed running totals.** The prompt forces the model to sum
   each employee's hours across slots — pre-computing and emitting the
   budget as a literal table is the same fix that landed Bug H.

### Why a validator backstop is required (not just a prompt fix)

PR #511 (Bug E) and PR #513 (Bug G) demonstrated that the validator is
the layer that actually stops bad shifts from persisting — prompt rules
are the LLM's *goal*, not the system's guarantee. Bug H landed Rule 12
in the prompt AND added the `DAY_NOT_IN_TEMPLATE` validator. Shipping
hour caps as prompt-only would leave us exposed the next time a model
under-performs (different vendor, busier hour of day, prompt length
crossing a cache boundary). The validator is what makes "no overtime"
a *guarantee* rather than a *request*.

## Goals

- No employee assigned more than `max_weekly_hours` in the generated
  schedule. Adults (`is_minor = false`): 40h. Minors under 16:
  18h (FLSA school-week limit applied year-round as the conservative
  default). Minors 16-17: 40h (federal FLSA allows it; state laws may
  be stricter but match the user-stated "16+ use a 40 hour max").
- No employee scheduled more than 5 consecutive calendar days within
  the generation week.
- Idle available employees preferred over stacking hours on already-busy
  employees, so the model uses the full roster.
- LLM never computes a running hour total — the prompt hands it a
  per-employee budget table refreshed at prompt-build time.
- Validator catches and drops shifts that violate any of these rules,
  with diagnostic-summary mappings so the UI displays the reason.

## Non-goals (deferred)

- **Daily hour caps for minors under 16** (FLSA 3h on school days, 8h
  on non-school days). Requires a per-restaurant school-calendar source
  we do not have. Captured as a follow-up issue.
- **State-specific child-labor rules.** Federal FLSA only for v1.
  Per-state overrides would need a `restaurant.state_code` lookup.
- **Cross-week hour tracking.** "Hours so far this week" is computed
  from the generation window only. Prior weeks' shifts are not counted.
- **Cross-week consecutive-day counting.** The 5-day streak is
  measured only within the 7 calendar days starting at `weekStart`.
  An employee who worked Saturday last week and Mon-Fri this week
  appears as a 5-day streak to the validator, not 6. Cross-week
  enforcement would require a wider `existingShifts` window and is
  deferred.
- **Per-employee custom `max_weekly_hours` override column.** Today's
  cap is derived from `date_of_birth` + `employment_type`. A manual
  override (e.g. a senior staffer who explicitly wants 36h) is a
  follow-up.
- **UI for entering `date_of_birth`.** The field already exists on the
  employees table and the onboarding form. Bug I assumes it's
  populated; missing-DOB rows are treated as adult (40h cap) and
  documented in the read-site guard.
- **Re-prompting on validator drop.** Today the validator surfaces
  drops in the diagnostic summary; the manager can re-run if too many
  slots come back unfilled. A retry-with-feedback loop is a separate
  feature.

## Approach

### Layer 1 — Prompt (schedule-prompt-builder.ts)

Replace Rule 11 with two HARD rules and insert a new section.

#### New HARD Rules

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
```

Renumber the existing Rule 12 (fill every slot) to Rule 13 and add a
new tie-breaker as Rule 14:

```text
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

#### New "Employee Hour Budgets" section

Inserted between "Employees" and "Templates":

```text
## Employee Hour Budgets

Each row lists the maximum hours each employee may be scheduled for
this week. Do not compute these yourself — use the value here.

  Ivy Benavides        | adult  | max 40h
  Termora Johnson      | adult  | max 40h
  Aleah Holderread     | minor  | max 18h
  ...
```

Same right-padded column technique as `DATE_MAP_LABELS` from PR #516 —
the LLM reads it as a table, not prose.

### Layer 2 — Schema → context pipeline (`ScheduleEmployee` + `generate-schedule`)

Add two fields to `ScheduleEmployee`:

```typescript
export interface ScheduleEmployee {
  id: string;
  name: string;
  position: string;
  area: string | null;
  hourly_rate: number;
  employment_type: 'full_time' | 'part_time';
  /** Computed in the edge function from `employees.date_of_birth`
   *  relative to weekStart. Null DOB → treated as adult. */
  is_minor: boolean;
  /** Hard ceiling for weekly hours. Adults: 40. Minors under 16: 18
   *  (FLSA school-week limit). Minors 16-17: 40. */
  max_weekly_hours: number;
}
```

In `generate-schedule/index.ts` (lines 134, 248-255):

- Add `date_of_birth` to the existing SELECT.
- Compute `is_minor` and `max_weekly_hours` in a pure helper
  `computeHourBudget(dob: string | null, weekStart: string)` placed
  in `supabase/functions/_shared/schedule-prompt-builder.ts` next to
  `buildWeekDates` and the `ScheduleEmployee` interface — one file,
  no new module. The helper has no Deno-specific imports and is
  testable from Vitest without any shim.

**Auth posture (review correction).** The edge function authenticates
the caller with `SUPABASE_ANON_KEY` + the user's `Authorization`
header (`index.ts:68-72`), NOT the service role. The new
`date_of_birth` field is therefore read through the existing
`employees` SELECT policy `"Users can view employees for their
restaurants"` (`20260120100100_update_rls_for_collaborators.sql:426`)
which gates on `user_has_capability(restaurant_id, 'view:employees')`.
Owner and manager callers — the only roles that can invoke
`generate-schedule` — pass that capability check today, so no RLS,
policy, or migration change is required. Adding `date_of_birth` to
the projection is a zero-RLS, zero-migration, zero-lock change.

#### `computeHourBudget` rules

| `date_of_birth` | Age on `weekStart` | `is_minor` | `max_weekly_hours` |
|---|---|---|---|
| null / undefined / unparseable | n/a | `false` | `40` |
| valid, age ≥ 18 | adult | `false` | `40` |
| valid, age 16-17 | minor 16+ | `true` | `40` |
| valid, age < 16 | minor under 16 | `true` | `18` |
| valid, age in future (DOB > weekStart) | n/a (data error) | `false` | `40` |

**UTC-anchored age math.** Both `weekStart` and `date_of_birth` MUST
be parsed as UTC midnight using the same form as `buildWeekDates`:
`new Date(\`${s}T00:00:00Z\`)`. Computation MUST use UTC accessors
(`getUTCFullYear`, `getUTCMonth`, `getUTCDate`). Using the
local-time `new Date(year, monthIdx, day)` constructor for either
side introduces a host-TZ offset (e.g. UTC-6 in `America/Chicago`)
that can flip the age computation by one year when a DOB lands on
the same day as `weekStart`. The unit tests pin this — see "DST and
TZ" cases in the test plan.

Age computed in calendar years, anchored on `weekStart` (the first day
of the schedule week). A minor who turns 16 mid-week is treated by
their age on Monday — this is the most predictable rule and matches
how managers think about the week as a unit. Documented in JSDoc on
`computeHourBudget`.

**Birthday equals `weekStart` boundary (inclusive).** If an
employee's 16th birthday IS the `weekStart` Monday, they are
evaluated as 16 (≥ 16 → adult 40h cap). The birthday is inclusive:
on the day of N's birthday the employee has *already turned N*. The
boundary rule: `age = (weekStart - DOB)` in full UTC years; if
`(DOB.month, DOB.day) <= (weekStart.month, weekStart.day)` the
employee has had their birthday this year. Documented in JSDoc with
a worked example for the boundary day.

Defensive guards (lesson [2026-05-22]: a new schema field is only
useful if every consumer reads it correctly, and pre-existing rows
can poison the runtime):

- DOB malformed (not YYYY-MM-DD or `Date.parse` fails) → treat as
  null → adult.
- DOB in the future → treat as adult; do not throw. A `date_of_birth`
  in the future is a data-entry error, not a schedule-blocking event.

### Layer 3 — Validator (`schedule-validator.ts`)

Add three drop codes and a single new validation step that runs
stateful-per-employee.

#### Drop codes

```typescript
export type DropCode =
  | "EXCLUDED"
  | "UNKNOWN_EMPLOYEE"
  | "UNKNOWN_TEMPLATE"
  | "DAY_NOT_IN_TEMPLATE"
  | "POSITION_MISMATCH"
  | "UNAVAILABLE_DAY"
  | "OUTSIDE_WINDOW"
  | "DOUBLE_BOOKING"
  | "HOURS_EXCEED_WEEKLY_CAP"
  | "CONSECUTIVE_DAYS_EXCEEDED"
  | "MINOR_HOURS_EXCEEDED";
```

**Dispatch rule (review correction).** `MINOR_HOURS_EXCEEDED` fires
**only when `max_weekly_hours === 18`** — i.e. minors under 16. A
17-year-old minor with the same 40h cap as an adult who exceeds it
gets `HOURS_EXCEED_WEEKLY_CAP`, not `MINOR_HOURS_EXCEEDED`. This
keeps the diagnostic label "Minor over 18h cap" factually accurate
in every case it fires, and gives managers a distinct signal to
audit DOB data quality only when an under-16 cap is in play. The
`is_minor` flag is informational (for the prompt budget table); it
is NOT the dispatch predicate for the drop code.

#### Validator context extension

Promote `employeeIds: Set<string>` to a Map carrying the budget
(lesson [2026-05-22] "Set vs Map for richer per-id data"):

```typescript
export interface ValidationContext {
  /** Promoted from Set<string>. Contains hour budget + minor status
   *  required for HOURS_EXCEED_WEEKLY_CAP, MINOR_HOURS_EXCEEDED, and
   *  CONSECUTIVE_DAYS_EXCEEDED checks. Existence checks (was
   *  `employeeIds.has(id)`) become `employees.has(id)`. */
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

`employeePositions` collapses into the new `employees` Map's
`position` field — one structure, one lookup, no drift risk.

#### New validation step (runs after current step 8 DOUBLE_BOOKING)

Stateful pass — maintains a running `Map<employeeId, { minutesScheduled,
daysScheduled: Set<dayString> }>` seeded from `existingShifts` and
updated for each shift that passes the prior checks. For each
candidate shift:

1. Compute `shiftMinutes = timeToMinutes(end_time) -
   timeToMinutes(start_time) + (overnight ? 1440 : 0)` where
   `overnight = timeToMinutes(end_time) <= timeToMinutes(start_time)`.
   Same formula already used inside `shiftsOverlap` /
   `shiftsConflict` in `schedule-validator.ts:86-89` — do NOT
   introduce a new helper. (Earlier draft referenced a phantom
   `projectMinutes`; corrected per supabase reviewer.)
2. Compute `proposedMinutes = current.minutesScheduled + shiftMinutes`.
   If `proposedMinutes > employees.get(id).max_weekly_hours * 60`,
   dispatch the drop code on the **cap value**:
   - `max_weekly_hours === 18` → `MINOR_HOURS_EXCEEDED`
   - `max_weekly_hours === 40` → `HOURS_EXCEED_WEEKLY_CAP` (regardless
     of `is_minor`)
3. Compute `proposedDays = new Set([...current.daysScheduled,
   shift.day])`. If `longestConsecutiveRun(proposedDays) > 5`, drop
   with `CONSECUTIVE_DAYS_EXCEEDED`.
4. Otherwise commit: update the running state and accept.

**Processing order.** Sort candidates by `day ASC, start_time ASC,
employee_id ASC, template_id ASC` so the "first 5 wins" outcome is
deterministic regardless of LLM emission order. The
`employee_id, template_id` secondary keys protect against the case
where two candidates share `(day, start_time)` — without them the
tie-break would be implementation-defined and the validator output
would change run-to-run on identical inputs.

**Step ordering constraint.** This new step MUST run after step 8
(`DOUBLE_BOOKING`). The running counter is seeded from
`existingShifts` once, so if the LLM emits a duplicate of a locked
shift, `DOUBLE_BOOKING` drops it before the counter would
double-count those hours. Document this invariant on the validator
function so a future refactor cannot silently reorder steps and
re-introduce the cap leak.

#### Consecutive-day calculation

For a set of YYYY-MM-DD strings within a single schedule week:

```typescript
/**
 * Longest consecutive-day run within the input set.
 * @param days Iterable of YYYY-MM-DD strings. Defensive dedup is
 *   applied even if a Set is passed, so a future caller that
 *   accidentally hands in an array does not silently undercount
 *   the run (sound-logic review #1).
 * @remarks Lexicographic sort agrees with chronological order only
 *   within a single ISO month (e.g. "09" sorts after "10"). This
 *   helper is correct for a single 7-day schedule week. Callers
 *   reusing it for multi-month inputs MUST sort by parsed Date
 *   instead.
 */
function longestConsecutiveRun(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 0) return 0;
  let max = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = Date.UTC(...parseYMD(sorted[i-1]));
    const cur  = Date.UTC(...parseYMD(sorted[i]));
    if (cur - prev === 86_400_000) run++;
    else { max = Math.max(max, run); run = 1; }
  }
  return Math.max(max, run);
}
```

UTC-anchored math (lesson [2026-05-18]) so DST and local-TZ midnight
shifts cannot create a false gap on the spring-forward day. Defensive
dedup at the top means a duplicate day (e.g. an open + a close on the
same Monday seeded from `existingShifts`) cannot collapse the streak
math by treating the duplicate as a zero-diff "gap."

#### Diagnostic summary mapping

The `droppedReasons` switch at `generate-schedule/index.ts:644-664`
has a `default` branch that emits `"Unknown drop reason on
<date>"` for any unrecognized code. Adding the three new validator
codes WITHOUT updating this switch in the same commit creates a
silent UI regression: `drop_reason_summary` (which maps the code
string correctly via the validator) and `dropped_reasons` (which
falls into `default`) would disagree. The switch MUST be updated
in the same PR:

- `HOURS_EXCEED_WEEKLY_CAP` → `"Weekly hour cap exceeded on ${day}"`
- `CONSECUTIVE_DAYS_EXCEEDED` → `"More than 5 consecutive days on ${day}"`
- `MINOR_HOURS_EXCEEDED` → `"Minor over 18h cap on ${day}"`

The implementation plan calls out the switch + validator union as a
coupled change. The `default` branch is retained as a safety net for
any future code added to the union without a switch update.

## Data flow walkthrough (end-to-end audit per lesson [2026-05-22])

| Layer | Reads `date_of_birth` / `is_minor` / `max_weekly_hours` | File |
|---|---|---|
| DB | `employees.date_of_birth DATE NULL` (added by migration `20260413100000_add_employee_employment_type_dob.sql`) | `supabase/migrations/` |
| RLS | gated by existing `"Users can view employees for their restaurants"` policy via `user_has_capability(restaurant_id, 'view:employees')` — owner/manager pass; no policy change needed | `supabase/migrations/20260120100100_update_rls_for_collaborators.sql:426` |
| Edge SELECT | adds `date_of_birth` to active-employee projection. **Auth: anon key + user `Authorization` header**, NOT service role (`index.ts:68-72`). RLS evaluates as the calling user. | `generate-schedule/index.ts:134` |
| Mapper | calls `computeHourBudget(e.date_of_birth, weekStart)` → populates `is_minor` and `max_weekly_hours` on the `ScheduleEmployee` | `generate-schedule/index.ts:247-255` |
| Prompt | renders "Employee Hour Budgets" table from `ctx.employees` | `_shared/schedule-prompt-builder.ts` (new section after `## Employees`) |
| LLM input | sees the table directly; never asked to compute it | — |
| LLM output | `shift.employee_id` only — minor status not in response schema | — |
| Validator context build | `buildValidationContext` populates new `employees` Map from same `ScheduleEmployee[]` | `generate-schedule/index.ts` |
| Validator | new step enforces caps as backstop | `_shared/schedule-validator.ts` |
| Diagnostic UI | three new drop reasons added to the `droppedReasons` switch at `generate-schedule/index.ts:644-664`. Coupled change — validator union + switch updated together. | `generate-schedule/index.ts` + `useGenerateSchedule.ts` |
| Persistence | `shift_template_id`, `employee_id`, etc. — DOB itself is NOT persisted into `shifts` (the employee→shift FK + DOB lookup at read time is sufficient). PR #511's `shift_template_id` wiring is untouched. | unchanged |

Every layer either reads the field or is documented as "not applicable."

## Edge cases

- **Locked shifts already over cap.** `existingShifts` seeds the
  per-employee minutes counter. If a locked shift already pushes
  someone over 40h, new shifts for that employee get
  `HOURS_EXCEED_WEEKLY_CAP`; the locked shift itself is unaffected
  (validator does not retroactively drop locked shifts). Documented.
- **Locked shifts already over consecutive-days.** Same — the counter
  is seeded from locked, no retroactive drop, new shifts get
  `CONSECUTIVE_DAYS_EXCEEDED`.
- **Overnight shifts** (start 22:00, end 02:00). Counted as ONE day
  (the `day` field's value), not two. Hours computed via
  `projectMinutes` to handle midnight crossing correctly.
- **Employee with no DOB and no `employment_type`.** Defaults: adult
  + 40h cap + `employment_type === 'full_time'` (existing fallback at
  `index.ts:255`). Both fall back independently.
- **`weekStart` invalid.** `buildWeekDates` already throws (PR #516).
  `computeHourBudget` follows the same pattern — throws on invalid
  `weekStart`, treats invalid DOB as null.
- **Birthday on Friday of the schedule week.** Age computed as-of
  Monday (weekStart). A 15-year-old who turns 16 on Friday is treated
  as 15 for the whole week → 18h cap. Documented in JSDoc.
- **Empty employees Map.** Validator gracefully returns all shifts as
  `UNKNOWN_EMPLOYEE` (existing behavior; no special case).
- **No minors on staff.** No prompt change visible (every row shows
  `adult | max 40h`) but the table still renders — the LLM gets used
  to seeing the structure so future minor additions don't require a
  prompt-shape change.

## Test plan

### Unit tests (`tests/unit/schedule-prompt-builder.test.ts`)

Extend the existing file:

- New "Employee Hour Budgets" section renders with adult + minor rows.
- Empty employees → section still renders with header only (or is
  omitted — decide in implementation; either is acceptable as long
  as the prompt doesn't break).
- HARD Rules 11, 12, 14 present in the system prompt source text
  (negative assertion that old Rule 11 soft text is gone).
- Rule 13 (fill every slot) language now mentions Rules 11/12 exception
  ("OR if every remaining eligible employee would violate Rules 11 or
  12").

### Unit tests (`tests/unit/schedule-hour-budget.test.ts`, new file)

Cover `computeHourBudget`:

- Adult DOB → `{ is_minor: false, max_weekly_hours: 40 }`.
- DOB 17.5 years before weekStart → `{ is_minor: true, max: 40 }`.
- DOB 14 years before weekStart → `{ is_minor: true, max: 18 }`.
- Null DOB → adult 40.
- Malformed DOB string → adult 40.
- DOB in the future → adult 40.
- Invalid `weekStart` → throws (note: `buildWeekDates` is the
  primary error boundary in the real call path, but
  `computeHourBudget` validates independently as defense-in-depth).
- Birthday on the Friday of weekStart's week, employee turns 16 →
  still treated as 15 (minor under 16, 18h cap).
- **Birthday on the Monday that IS weekStart, employee turns 16 →
  treated as 16 (adult 40h cap).** Locks the inclusive boundary.
- **TZ-portability case.** Run with `process.env.TZ = 'America/Chicago'`
  (UTC-6) and `'Pacific/Auckland'` (UTC+12). For DOB = `"2010-06-08"`
  and weekStart = `"2026-06-08"`, the helper must return age 16
  regardless of host TZ. A local-time `new Date(year, monthIdx, day)`
  implementation will fail this on at least one of the two TZs.

### Unit tests (`tests/unit/schedule-validator.test.ts`)

Extend the existing file. Note that the `ValidationContext` shape
change (`employeeIds: Set` + `employeePositions: Map` → unified
`employees: Map`) requires updating the `makeContext()` factory at
`tests/unit/schedule-validator.test.ts:29-49` AND ~11 inline
overrides at lines 32-35, 136-137, 160-161, 200-201, 302, 315, 328,
338, 351 (per supabase reviewer's audit). Implementation plan calls
this out as a single mechanical pass with a grep-confirmation step.

New behavior tests:

- `HOURS_EXCEED_WEEKLY_CAP`: 6 × 6.5h shifts (39h) accept; 7th shift
  (+6.5h → 45.5h) drops with code.
- **`MINOR_HOURS_EXCEEDED` dispatch on cap value, not `is_minor`:**
  - Minor with `max_weekly_hours: 18` (under-16): 3 × 6h shifts (18h)
    accept; 4th shift drops with `MINOR_HOURS_EXCEEDED`.
  - Minor with `max_weekly_hours: 40` (16-17yo): 6 × 6.5h shifts
    accept; 7th shift drops with `HOURS_EXCEED_WEEKLY_CAP` (NOT
    `MINOR_HOURS_EXCEEDED` — locks the dispatch rule).
- `CONSECUTIVE_DAYS_EXCEEDED`: 5 shifts Mon–Fri accept; 6th shift Sat
  drops with code. Shift on Sun without Sat accepts (gap breaks the run).
- Locked shifts seed the counter: existingShifts puts employee at 35h
  already, candidate 7h shift drops.
- Locked shift already over cap (locked = 41h): locked shift stays
  in `valid`; new candidates for same employee drop. Documents that
  the validator never retroactively drops locked shifts.
- Two locked shifts on the same calendar day (open + close): the
  `longestConsecutiveRun` dedup means that Monday counts once, not
  twice as zero-diff "gap." Locks the dedup behavior.
- Overnight shift: 22:00-02:00 counts as one day's worth of minutes
  (4h), not two days.
- Order independence: shifts emitted in random order produce the same
  valid set as the same shifts emitted in chronological order. Locks
  the `(day, start_time, employee_id, template_id)` tiebreak.
- DST spring-forward day (March 8 2026 in US/Central): consecutive-day
  math does not lose a day.

### Integration / regression

- Existing schedule-validator and schedule-prompt-builder tests pass
  unchanged after the `employeeIds → employees` Map promotion (rename
  the symbol everywhere a test references it).

### Manual smoke

- Generate one schedule on a real restaurant with a mix of FT/PT and
  (if available) one minor. Confirm:
  - No employee exceeds their cap.
  - No employee is scheduled 6+ consecutive days.
  - Previously idle PT employees now appear in the output.
  - Diagnostic toast shows new drop reasons if any shifts are dropped.

## Risk & rollback

- **Risk:** Hard caps may cause more partial-fill schedules
  (under-staffed slots) in cases where a restaurant genuinely lacks
  enough labor to cover the week within the cap. Mitigation: this is
  exactly what the diagnostic toast (PR #506) is designed for — surface
  the under-fill clearly. A manager seeing "20 of 30 slots filled
  (employees over 40h cap)" can make an informed call to raise caps
  or hire.
- **Risk:** DOB data quality. Many restaurants will have null DOB on
  most employees. The default (adult 40h) is safe — they get treated
  the same as before for the cap, and the new fairness rule still
  applies. The only behavior change for null-DOB rosters is that no
  employee gets stacked >40h.
- **Rollback:** Single-PR change, easy to revert. The schema migration
  for DOB is already in production; nothing new is added at the DB
  level. Reverting just removes the prompt rules + validator step +
  ScheduleEmployee field expansion.

## Out of scope (future work)

- Daily hour caps for minors under 16 (needs school calendar source).
- State-specific child labor rule lookup.
- Cross-week hour tracking.
- Per-employee custom `max_weekly_hours` override column + UI.
- Re-prompting with feedback when too many shifts are dropped.
- "Minor" badge in the planner UI.
