# Shift-Creation Timezone Implementation Plan

**Design:** [`2026-07-30-shift-create-tz-design.md`](../specs/2026-07-30-shift-create-tz-design.md)
**Branch:** `fix/shift-create-tz` (off `main` @ `2e00c57c`)
**Worktree:** `.claude/worktrees/shift-create-tz`

---

## Global Constraints

1. **Red before green, and by the right amount.** Task 1 lands failing tests only.
   The headline E2E must fail by **exactly +120 minutes** — the PostHog delta and
   the delta on all six wrong production rows. A different delta means the test
   reproduces something else; stop and fix the test, do not proceed.
2. **No test may depend on the host clock.** Every unit test runs under `TZ=UTC`,
   `TZ=America/Chicago` and `TZ=Asia/Tokyo`; every E2E pins `timezoneId` and sets
   `restaurants.timezone` explicitly. One full-suite `TZ=UTC` run before pushing
   (`memory/lessons.md:1297`).
3. **Re-derive, never re-pin.** When an existing assertion breaks, compute the
   correct value from first principles. Copying the newly-observed output is how a
   wrong fix gets locked in (`memory/lessons.md:1182`).
4. **Postgres is authoritative.** Every DST expectation is the value
   `(wall)::timestamp AT TIME ZONE tz` returns, not what the implementation emits.
5. **One surface per commit** after Task 2, so a bisect lands on a single surface.

## File Structure

```text
src/lib/restaurantClock.ts          NEW — copied verbatim from fix/restaurant-tz-display
src/lib/shiftInterval.ts            wallClockToInstant; create() gains required tz; endsOnNextDay(tz)
src/hooks/useValidatedShiftMutations.ts   optional tz on options
src/hooks/useShiftPlanner.ts        tz option → pipeline + validateAndUpdateTime
src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx   pass restaurantTimezone
src/components/ShiftDialog.tsx      read + write round trip together
src/hooks/useShifts.tsx             recurring children
src/lib/copyWeekShifts.ts           copy week
src/components/scheduling/useShiftCopyDnd.ts   drag-copy

tests/unit/restaurantClock.test.ts  NEW — copied verbatim
tests/unit/shiftInterval.test.ts    DST matrix + ~60 mechanical 'UTC' args
tests/e2e/shift-create-timezone.spec.ts   NEW — the reproduction
tests/e2e/copy-week-shifts.spec.ts  extended with a pinned timezoneId
supabase/tests/wall_clock_parity.sql      NEW — copied verbatim
supabase/tests/open_shift_claim_dst.test.sql   NEW — pins the two RPCs on DST dates
```

---

### Task 1 — Reproduce. Failing tests only, no source changes.

**This task is complete when the tests fail correctly, not when they pass.**

Create `tests/e2e/shift-create-timezone.spec.ts`:

```ts
// The Rush Bowls manager's Chrome OS clock. The restaurant is in Chicago.
test.use({ timezoneId: 'America/Los_Angeles' });
```

Per test: `signUpAndCreateRestaurant` → `exposeSupabaseHelpers` → **explicitly**
`UPDATE restaurants SET timezone = 'America/Chicago'` (the helper sets none; relying
on the column default leaves the premise implicit — `memory/lessons.md:1009`) →
seed a template `06:30`–`12:30` → assign an employee → read the row back and assert
`start_time === '<date>T11:30:00.000Z'`.

Cases, one per broken surface (§3):

| # | Case | Expected red |
|---|---|---|
| 1 | assign employee to template | `13:30Z`, off by **+120 min** |
| 3 | open an existing shift, save **without editing** | `start_time` changes; must be byte-identical |
| 4 | "Repeat" → children | children drift from the parent's restaurant-local wall clock |
| 6 | drag-copy a card | dropped shift's wall clock shifts |

Plus the control — same flow, `timezoneId: 'America/Chicago'` — which must be
**green now and green after**. It is what proves the fix re-anchors rather than
shifting everything by two hours.

Extend `tests/e2e/copy-week-shifts.spec.ts` for surface 5 with restaurant
`Asia/Tokyo` and browser `America/Los_Angeles`, asserting a `00:30` shift copies to
the **same day of week**. A host zone west of the restaurant is required: an
hour-only error and a day error are different bugs, and this case only catches the
latter.

**Gate:** run them. Record each observed delta in the commit message. Case 1 must
read exactly +120 min.

Commit: `test(schedule): reproduce the shift-creation timezone defect (red)`

---

### Task 2 — The converter.

Copy **verbatim** from `fix/restaurant-tz-display` (see design §4 — this is a
deliberate cross-branch coordination point):

- `src/lib/restaurantClock.ts` (201 lines, sole import `date-fns-tz`, already a
  dependency on `main` via `shiftTimeMath.ts`)
- `tests/unit/restaurantClock.test.ts`
- `supabase/tests/wall_clock_parity.sql`

Do not edit the copied functions. Divergence between the two copies is the whole
risk being managed.

Then add `wallClockToInstant(dateStr, timeHHMM, tz): Date` to `shiftInterval.ts` as
a thin adapter. **It must validate before delegating** (design §5.1):

- `tz` non-empty **and** accepted by `Intl.DateTimeFormat`, else
  `TypeError('INVALID_DATE')`. `parseWallClock` opens with `safeTz()`, which maps an
  empty zone to `America/Chicago` *silently* — delegating without this check
  relocates the bug rather than fixing it.
- `dateStr` / `timeHHMM` regex-gated, else `TypeError('INVALID_DATE')`.
  `parseWallClock` routes bad input through `reject()`, which throws in DEV/test but
  **logs and returns a fallback in production**; `ShiftInterval`'s contract is a
  throw in all environments, pinned by `shiftInterval.test.ts:64,68,72`.
- `parseWallClock` returns an ISO string; this returns a `Date`.

Tests — the DST table, every value from Postgres, asserted under all three host TZs:

| input | expected |
|---|---|
| `('2026-03-08','02:30','America/Chicago')` nonexistent | `2026-03-08T08:30:00.000Z` |
| `('2026-11-01','01:30','America/Chicago')` repeated | `2026-11-01T07:30:00.000Z` |
| `('2026-03-29','01:30','Europe/Dublin')` nonexistent | `2026-03-29T01:30:00.000Z` |
| `('2026-10-25','01:30','Europe/Dublin')` repeated | `2026-10-25T01:30:00.000Z` |
| `('2026-10-04','02:15','Australia/Lord_Howe')` nonexistent | `2026-10-03T15:45:00.000Z` |
| `('2026-04-05','01:45','Australia/Lord_Howe')` repeated | `2026-04-04T15:15:00.000Z` |

Dublin is not optional: it is the only case distinguishing "smaller numeric offset"
from "the non-DST offset", so dropping it lets a plausible-but-wrong tiebreak ship
green. Lord Howe covers a 30-minute DST shift. Empty-string `tz` gets its own case
— it is the one input that fails open to a host-local instant instead of
`Invalid Date`.

Commit: `feat(clock): Postgres-parity wall-clock converter for shift creation`

---

### Task 3 — `ShiftInterval.create` takes a required `tz`.

`create(businessDate, startTime, endTime, tz)` — required and positional, so the
compiler enumerates every construction site. Route all four naive parses (`:36`,
`:41`, `:44`, `:46`) through `wallClockToInstant`. Roll the midnight-crossing date
with UTC field arithmetic (the `minutesToIso` pattern at `shiftTimeMath.ts:17-38`),
never `setDate` on a host-local `Date`.

`endsOnNextDay` getter → `endsOnNextDay(tz)` method. No production callers (only
`shiftInterval.test.ts:213-232`), so this is safe and closes a live trap.

Mechanical: ~60 call sites across **four** test files take an explicit `'UTC'`.
`useShiftPlanner.delegation.test.tsx` is *not* among them — its two `ShiftInterval`
mentions are a test name and a comment — but it exercises the path indirectly via
`validateAndUpdateTime`, so its fixture needs the hook's `tz`.
`useShiftPlanner.test.ts:211` reasons "in CST" in a comment, so it takes
`'America/Chicago'` and its pinned instant is **re-derived**.

Preserve exactly: `INVALID_DURATION`, `TOO_SHORT` (<15 min), `MAX_ENDURANCE` (>16 h).

Commit: `fix(shifts): anchor ShiftInterval.create in the restaurant timezone`

---

### Task 4 — Thread `tz` to the Planner. (Surfaces 1 & 2)

`tz` as an **optional** field on `UseValidatedShiftMutationsOptions`;
`validateAndCreate`/`forceCreate` throw `INVALID_DATE` if absent at call time.
Optional here is deliberate and does not contradict Task 3: `ShiftTimelineTab.tsx:392`
is a second consumer using only `fromTimestamps`-based members and provably cannot
hit this bug, so requiring it would trade a real compile error for no safety. The
invariant lives at the primitive, where it is total.

`useShiftPlanner` gains a `tz` option → forwarded at `:542`, read by
`validateAndUpdateTime` at `:603`. `ShiftPlannerTab` passes `restaurantTimezone`
(declared `:117`, above the `useShiftPlanner` call at `:137` — no TDZ hazard,
verified, per `memory/lessons.md:1298`).

**Gate:** E2E case 1 goes green — at `11:30:00Z`, not merely "different". Control
case still green.

Commit: `fix(planner): create shifts in the restaurant's timezone`

---

### Task 5 — `ShiftDialog`, read and write together. (Surface 3)

Both halves in one commit; splitting them shows the user a correct value in a field
that then saves wrong, or the reverse.

- Prefill (`:101-108`): `format(start,'yyyy-MM-dd')` / `format(start,'HH:mm')` →
  `formatLocalDateInTz` / `formatLocalTimeInTz`.
- Conflict memo (`:83-84`) and submit (`:160-161`): naive `new Date` →
  `wallClockToInstant(..., timezone)`.
- `try/catch` around both, per design §7.

**Gate:** E2E case 3 — open and save an unedited shift, `start_time` byte-identical.
This is the assertion a write-only fix fails.

Commit: `fix(shift-dialog): read and write the restaurant's wall clock`

---

### Task 6 — Recurring shifts. (Surface 4)

`useShifts.tsx:172` — replace `setHours(startDate.getHours(), …)` with: derive the
parent's restaurant-local wall clock via `formatLocalTimeInTz`, advance the
**calendar date** in restaurant-local terms, then `wallClockToInstant`. Each child
keeps the parent's wall clock, so a weekly series spanning a DST transition stays at
the same local time — which is what a manager means by "every Monday at 9".

**Gate:** E2E case 4.

Commit: `fix(shifts): keep recurring children on the restaurant's wall clock`

---

### Task 7 — Copy Week. (Surface 5)

`copyWeekShifts.ts` — `offsetPreservingLocalTime` and the `dayOffset` computation at
`:30-37` both go. Compute `dayOffset` from **restaurant-local calendar-day strings**,
not host-local midnight `Date`s; rebuild each instant with `wallClockToInstant`.
Correct the doc comment: it currently claims "DST-safe", which is host-local-safe —
a materially weaker and misleading property.

**Gate:** the extended `copy-week-shifts.spec.ts` — a Tokyo restaurant's `00:30`
shift copied from an LA browser lands on the same **day of week**.

Commit: `fix(copy-week): bucket copied shifts by the restaurant's calendar day`

---

### Task 8 — Drag-copy. (Surface 6)

`useShiftCopyDnd.ts:57-65` — same treatment as Task 7, smaller blast radius.

**Gate:** E2E case 6.

Commit: `fix(schedule): keep drag-copied shifts on the restaurant's wall clock`

---

### Task 9 — Cross-surface agreement.

The test that would have caught the superseded design. Create a shift by assigning a
template *and* via `claim_open_shift` for the same template and date, on `2026-03-08`
and `2026-11-01`; assert the two `start_time` values are **equal**. Every
single-surface test passes under a `fromZonedTime` client while these two sit an hour
apart.

Add `supabase/tests/open_shift_claim_dst.test.sql` pinning
`claim_open_shift`/`approve_open_shift_claim` to the 2026 transition dates with exact
UTC instants. `open_shift_claim_timezone.test.sql` explicitly punts on DST today
("UTC equivalent depends on DST at target date").

Commit: `test(schedule): assert the assign and claim paths agree on DST dates`

---

## Final verification

- [ ] `npm run typecheck`, `npm run lint`
- [ ] `npm run test` under `TZ=UTC`, `TZ=America/Chicago`, `TZ=Asia/Tokyo` — identical results
- [ ] `npm run test:db` — including both new pgTAP files
- [ ] `npm run test:e2e` — all cases green, **control still green**
- [ ] Re-run Task 1's specs against `git stash` of the source changes: they must go
      red again. A reproduction that cannot be made to fail again is not a
      reproduction.
- [ ] Every re-pinned assertion re-derived, not copied from output

## Deliberately not in scope

- `timezoneUtils.ts::localToUTC` (CSV import) — correct in production; its optional
  `timezone?` is a latent footgun, recorded in design §4, not a live defect.
- Repairing the six wrong production rows — a prod write needing explicit
  confirmation with row counts; **open question with the user**.
- Template edits not back-propagating to already-created shifts (separate defect).
- The PostHog URL token-scrubbing rule for the OAuth fragment leak.
