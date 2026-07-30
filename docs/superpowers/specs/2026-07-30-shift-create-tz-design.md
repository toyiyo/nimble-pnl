# Design — Anchor shift **creation** in the restaurant's timezone

**Date:** 2026-07-30
**Branch:** `fix/shift-create-tz` (off `main` @ `2e00c57c`)
**Topic:** `shift-create-tz`

---

## 1. The bug, as the customer sees it

Rush Bowls Kallison Ranch (`America/Chicago`) assigns an employee to a shift template
in the Planner. The template says **6:30 AM – 12:30 PM**. The shift that gets created
is **8:30 AM – 2:30 PM** — exactly **+2 hours**.

Confirmed in production against `shifts ⋈ shift_templates` for restaurant
`ae87f51e-e2c0-44f4-b6bb-3953d5bbdbff`:

| created (UTC) | template | template wall clock | stored, rendered in `America/Chicago` | Δ |
|---|---|---|---|---|
| 12:59:18 | Shift 1 (Main Opening) | 06:30–12:30 | 2026-07-30 08:30–14:30 | +120 min |
| 13:12:57 | Shift 4 (Mid-Shift 1) | 12:00–16:00 | 2026-07-28 14:00–18:00 | +120 min |
| 13:14:28 | Sunday Mid-Shift Support | 13:30–19:30 | 2026-08-02 15:30–21:30 | +120 min |
| 13:14:57 | Sunday Afternoon Support | 14:00–19:30 | 2026-08-02 16:00–21:30 | +120 min |
| 13:55:20 | Shift 1 (Main Opening) | 06:30–12:30 | 2026-07-28 08:30–14:30 | +120 min |

PostHog identifies the actor as a single manager on a **Chrome OS device whose OS
timezone was `America/Los_Angeles`** (`$timezone_offset = 420`) while physically in
San Antonio (`$geoip_time_zone = America/Chicago`). Later the same day the same
person switched to iOS Safari with `$timezone = America/Chicago` (`offset = 300`)
and the shifts they created **landed correctly**.

**420 − 300 = 120 minutes.** The delta is exactly the browser-vs-restaurant offset.
The bug is not Rush Bowls-specific and not Chrome OS-specific — it fires for *any*
manager whose browser timezone differs from the restaurant's, which is the normal
case for multi-location owners, travelling managers, and offshore support staff.

---

## 2. Root cause

`shift_templates.start_time` / `end_time` are Postgres `time without time zone` —
a **restaurant-local wall clock**. `shifts.start_time` / `end_time` are
`timestamptz` — an **absolute instant**. Converting between the two requires the
restaurant's IANA timezone. Nothing on the creation path supplies it.

### The write path, end to end

1. [`ShiftPlannerTab.tsx:442-443`](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx#L442)
   slices the template's wall clock into `HH:MM` strings:
   ```ts
   const startHHMM = template.start_time.split(':').slice(0, 2).join(':');
   const endHHMM   = template.end_time.split(':').slice(0, 2).join(':');
   ```
2. They go into a `ShiftCreateInput`
   ([`ShiftPlannerTab.tsx:445-453`](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx#L445))
   and reach
   [`useValidatedShiftMutations.ts:209`](../../../src/hooks/useValidatedShiftMutations.ts#L209)
   (and `forceCreate` at
   [`:247`](../../../src/hooks/useValidatedShiftMutations.ts#L247)).
3. **The defect** —
   [`shiftInterval.ts:36`](../../../src/lib/shiftInterval.ts#L36):
   ```ts
   const startAt = new Date(`${businessDate}T${startTime}:00`);
   ```
   A `YYYY-MM-DDTHH:mm:ss` string with **no offset suffix** is parsed by ECMAScript
   in the **host's** timezone. On a `UTC-7` browser, `2026-07-30T06:30:00` becomes
   the instant `13:30Z`. The restaurant meant `11:30Z`.
   The midnight-crossing branch at
   [`:41-46`](../../../src/lib/shiftInterval.ts#L41) has the same flaw three more times.
4. [`useShiftPlanner.ts:324`](../../../src/hooks/useShiftPlanner.ts#L324) serializes
   that host-anchored instant straight to the DB:
   ```ts
   start_time: interval.startAt.toISOString(),
   ```

The stored row is a *valid instant* — just the wrong one, off by
`hostOffset − restaurantOffset`.

### The correct primitive is already in the repo

[`shiftTimeMath.ts:17-38`](../../../src/lib/shiftTimeMath.ts#L17) —
`minutesToIso(dateStr, minutes, tz)` — does exactly this conversion with
`fromZonedTime` from `date-fns-tz`, and its doc comment explicitly documents
rolling the calendar day forward **before** DST is applied so an overnight shift
spanning a transition converts correctly. The Timeline drag/resize surface has
used it since it shipped, which is why **the Timeline creates correct shifts today
and the Planner does not**.

### Why the display layer already agrees with the fix

`buildTemplateGridData` takes a `tz` and buckets calendar days, time-of-day matching
and day-of-week in restaurant-local time
([`useShiftPlanner.ts:127-138`](../../../src/hooks/useShiftPlanner.ts#L127)), using
`formatLocalDateInTz` / `formatLocalTimeInTz`
([`shiftInterval.ts:157`](../../../src/lib/shiftInterval.ts#L157),
[`:170`](../../../src/lib/shiftInterval.ts#L170)). So once the write stores the
right instant, the grid matches the shift to its template exactly. The fix closes
the loop rather than opening a new mismatch.

---

## 3. The three shift-write surfaces

| # | Surface | Site | Status |
|---|---|---|---|
| 1 | Planner — assign employee to template | [`shiftInterval.ts:36,41,44,46`](../../../src/lib/shiftInterval.ts#L36) via [`useValidatedShiftMutations.ts:209,247`](../../../src/hooks/useValidatedShiftMutations.ts#L209) | **Broken** — host-local |
| 2 | Planner — drag a shift to a new time | [`useShiftPlanner.ts:603`](../../../src/hooks/useShiftPlanner.ts#L603) | **Broken** — host-local, same `ShiftInterval.create` |
| 3 | "Add / Edit Shift" dialog | [`ShiftDialog.tsx:83-84`](../../../src/components/ShiftDialog.tsx#L83) (conflict pre-check) and [`:160-161`](../../../src/components/ShiftDialog.tsx#L160) (the insert) | **Broken** — host-local |
| 4 | Timeline drag / resize / create | [`shiftTimeMath.ts:37`](../../../src/lib/shiftTimeMath.ts#L37) | ✅ correct — `fromZonedTime(…, tz)` |

Surface 2 is doubly ironic: the file that performs it carries a header comment
warning against precisely this construct
([`useValidatedShiftMutations.ts:12-14`](../../../src/hooks/useValidatedShiftMutations.ts#L12)):

> `validateAndUpdateTime` builds its interval via `ShiftInterval.fromTimestamps` —
> never the host-TZ `split('T')` + `ShiftInterval.create()` reconstruction, which
> would silently re-anchor the wall-clock time in the host's timezone instead of
> the restaurant's.

…and [`useShiftPlanner.ts:600-603`](../../../src/hooks/useShiftPlanner.ts#L600) does
the reconstruction anyway, with a comment calling it "preserving this hook's
existing host-local create semantics."

---

## 4. Relationship to the in-flight `fix/restaurant-tz-display` branch

That branch is a **read/display** program. Its own spec states the root cause as
"confined to the client presentation and client-side day-bucketing layer." Its four
declared defect sites are `TimePunchesManager`, `laborCalculations`,
`payrollCalculations` and `EmployeeTimecard`; the only write path in it is the
punch-edit round trip.

Verified it does **not** cover this defect:

- `src/lib/shiftInterval.ts`, `src/hooks/useValidatedShiftMutations.ts` and
  `src/hooks/useShiftPlanner.ts` are absent from its changed-file list;
  `git show HEAD:src/lib/shiftInterval.ts` on that branch still has the host-local
  `new Date()` at line 36.
- Its only scheduling edits are two one-line `|| 'UTC'` → `safeTz(...)` swaps.
- Its "Scope boundary" section lists deliberate exclusions; the shift-creation
  write path is on **neither** the in-scope nor the excluded list — a blind spot,
  not a deferral.
- Its planned ESLint ratchet targets `format(…'yyyy-MM-dd')`, `toLocale*String`,
  `.toISOString().split('T')[0]` and `DateTimeFormat().resolvedOptions()`. None of
  those selectors match ``new Date(`${d}T${t}:00`)``.

**Decision: fix off `main`.** Zero file overlap with that branch, so no merge pain;
its worktree is actively committing, so sharing it risks collision; and
`fromZonedTime`/`minutesToIso` is already on `main`, so there is no dependency on it
landing first.

**Follow-up once it merges:** that branch introduces
`restaurantClock.ts::parseWallClock`, a stricter wall-clock→instant converter with
verified Postgres parity on the nonexistent (spring-forward) and repeated
(fall-back) local hours. `wallClockToInstant` (below) should then delegate to it so
there is one converter, not two. Recorded here so the duplication is deliberate and
time-boxed, not accidental.

---

## 5. Design

### 5.1 New primitive — `wallClockToInstant`

Added to `src/lib/shiftInterval.ts` (alongside the existing `formatLocalDateInTz` /
`formatLocalTimeInTz`, which are its exact inverses):

```ts
export function wallClockToInstant(dateStr: string, timeHHMM: string, tz: string): Date
```

- Validates `dateStr` against `^\d{4}-\d{2}-\d{2}$` and `timeHHMM` against
  `^\d{2}:\d{2}$`, throwing `TypeError('INVALID_DATE')` otherwise.
- Converts via `fromZonedTime(\`${dateStr}T${timeHHMM}:00\`, tz)`.
- Throws `TypeError('INVALID_DATE')` if the result is not a valid Date.

**Why explicit validation instead of leaning on `Date`'s parser:** today
`new Date('2026-03-01Tabc:00')` yields `Invalid Date`, and `validateAndConstruct`
turns that into `TypeError('INVALID_DATE')`
([`shiftInterval.ts:70-72`](../../../src/lib/shiftInterval.ts#L70)) — a contract two
existing tests pin
([`shiftInterval.test.ts:64,68,72`](../../../tests/unit/shiftInterval.test.ts#L64)).
`fromZonedTime` on a malformed string returns `Invalid Date` too, but any
minutes-arithmetic route through `NaN` would produce a `RangeError` from
`.toISOString()` instead. A regex gate keeps the existing error contract exact.

**Timezone-validity policy:** `wallClockToInstant` does **not** substitute a
fallback timezone. Choosing a default is the caller's policy — on `main` every
caller already spells it `|| 'UTC'`
([`ShiftPlannerTab.tsx:118`](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx#L118),
[`Scheduling.tsx:221`](../../../src/pages/Scheduling.tsx#L221)), and
`fix/restaurant-tz-display` will upgrade those same expressions to `safeTz(...)`
with an `America/Chicago` default. Hard-coding a third default here would fight
both. A malformed **non-empty** IANA string therefore surfaces as `INVALID_DATE`,
which every call site already handles (§5.4). Production has 35 restaurants, zero
null/empty timezones, 5 distinct valid IANA zones.

### 5.2 `ShiftInterval.create` gains a **required** `tz`

```ts
static create(businessDate: string, startTime: string, endTime: string, tz: string): ShiftInterval
```

Required, not optional-with-default. An optional parameter leaves the footgun
loaded; a required one turns every present and future call site into a compile
error until someone supplies a timezone. That is a stronger ratchet than the ESLint
rule the display branch is planning, and it costs one mechanical edit per call site.

Body becomes:

```ts
const startAt = wallClockToInstant(businessDate, startTime, tz);
const endDate = endTime < startTime ? nextCalendarDay(businessDate) : businessDate;
const endAt   = wallClockToInstant(endDate, endTime, tz);
```

`nextCalendarDay` rolls the date with `Date.UTC` arithmetic — the same
host-TZ-independent technique `minutesToIso` uses
([`shiftTimeMath.ts:25-33`](../../../src/lib/shiftTimeMath.ts#L25)) — replacing the
current `nextDay.setDate(nextDay.getDate() + 1)` + `formatLocalDate` round trip
([`shiftInterval.ts:41-43`](../../../src/lib/shiftInterval.ts#L41)), which reads
host-local fields.

Resolving the end time against the **rolled-forward calendar day** before applying
the timezone is what makes an overnight shift straddling a DST transition come out
right; `minutesToIso`'s doc comment makes the same point.

**Deliberately not reused:** `resolveOvernightMinutes`
([`shiftTimeMath.ts:77-85`](../../../src/lib/shiftTimeMath.ts#L77)) rolls when
`end <= start`, so `09:00 → 09:00` becomes a 24-hour shift. `create` rolls only when
`end < start`, so equal times fall through to `INVALID_DURATION` — pinned by
[`shiftInterval.test.ts:76`](../../../tests/unit/shiftInterval.test.ts#L76). The two
semantics are genuinely different; merging them would silently change the Planner's
contract.

### 5.3 `endsOnNextDay` becomes `endsOnNextDay(tz)`

[`shiftInterval.ts:105-107`](../../../src/lib/shiftInterval.ts#L105) compares
`formatLocalDate(this.endAt)` — **host-local** — against `businessDate`. Once
`startAt`/`endAt` are genuinely restaurant-anchored instants, a host in a different
zone gets the wrong answer. It has no production callers (`grep` finds only
[`shiftInterval.test.ts:213-232`](../../../tests/unit/shiftInterval.test.ts#L213)),
so converting the getter to a method taking an explicit `tz` costs nothing and
removes a live trap for the next caller. Leaving a knowingly-wrong accessor on a
value object we just made timezone-correct is not an option.

### 5.4 Threading the timezone to the call sites

| Consumer | How it gets `tz` |
|---|---|
| `useValidatedShiftMutations` | new `tz` field on its existing `options` object ([`:184-186`](../../../src/hooks/useValidatedShiftMutations.ts#L184)) |
| `useShiftPlanner` | new `tz` option, forwarded to the pipeline at [`:542`](../../../src/hooks/useShiftPlanner.ts#L542) and read by `validateAndUpdateTime` at [`:603`](../../../src/hooks/useShiftPlanner.ts#L603) |
| `ShiftPlannerTab` | already computes `restaurantTimezone` at [`:118`](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx#L118) — passes it into the `useShiftPlanner(...)` call at [`:137`](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx#L137) |
| `ShiftDialog` | already receives a `timezone` prop, wired from `Scheduling.tsx` at [`:1602`](../../../src/pages/Scheduling.tsx#L1602) |

The timezone belongs on the **hook**, not on `ShiftCreateInput`: it is a property of
the restaurant, constant for every input in a batch, and putting it on the input
would make `handleAssignAll`
([`ShiftPlannerTab.tsx:482-490`](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx#L482))
restate it seven times.

**TDZ check** (lesson `memory/lessons.md:1298` — passing a value into an earlier
`useMemo` once caused `ReferenceError: Cannot access 'restaurantTimezone' before
initialization`): in `ShiftPlannerTab` the declaration at `:118` sits *above* the
`useShiftPlanner` call at `:137`, so no hoist is needed. Verified rather than
assumed.

### 5.5 `ShiftDialog` — the round trip must move together

The dialog is symmetric-broken: it **reads** host-local and **writes** host-local,
so today the two errors cancel for a user who never changes timezone. Fixing only
the write would make every *edit* of an existing shift shift its own times.

- **Write** — [`:83-84`](../../../src/components/ShiftDialog.tsx#L83) (conflict
  pre-check) and [`:160-161`](../../../src/components/ShiftDialog.tsx#L160) (insert)
  use `wallClockToInstant(date, time, timezone)`. The dialog carries independent
  `startDate` and `endDate` fields, so it calls the primitive directly rather than
  `ShiftInterval.create` (which can only express same-day or next-day).
- **Read** — the prefill at
  [`:101-108`](../../../src/components/ShiftDialog.tsx#L101) uses
  `format(start, 'yyyy-MM-dd')` / `format(start, 'HH:mm')` from `date-fns`, i.e.
  host-local. Becomes `formatLocalDateInTz` / `formatLocalTimeInTz` (already
  exported from `shiftInterval.ts`, the latter sliced from `HH:MM:SS` to `HH:MM`).
- **Error handling** — the conflict `useMemo` at
  [`:77-95`](../../../src/components/ShiftDialog.tsx#L77) already returns `null` for
  unusable input; it gains a `try/catch` so an `INVALID_DATE` becomes "no conflict
  check" rather than a render crash. `handleSubmit` gets the same guard beside its
  existing `alert()` validations at
  [`:146-158`](../../../src/components/ShiftDialog.tsx#L146).

### 5.6 Not in scope

- **Repairing the 6 already-wrong production rows.** A prod write; needs explicit
  user confirmation with exact row counts and affected tables. Two of the six are
  on past or same-day dates that payroll may already have consumed. Surfaced
  separately, awaiting the user's decision.
- **Template edits not back-propagating to already-created shifts** (Issue #2 from
  the diagnosis). Real, customer-visible, reads as the same bug — but a distinct
  product decision, not a timezone defect.
- **Template data hygiene** — names disagreeing with stored times; a
  "Sunday only" template with `days = [0,6]`.
- **The rest of the display layer** — `fix/restaurant-tz-display` owns it.
- **`ShiftInterval.fromTimestamps` and its 12 call sites** — it consumes absolute
  ISO instants and is already correct.

---

## 6. Test plan

Every new test must produce identical results under `TZ=UTC`, `TZ=America/Chicago`
and `TZ=Asia/Tokyo`. Per `memory/lessons.md:1297`, the whole suite gets one run
under `TZ=UTC` before pushing — that single command reproduces the CI-vs-dev-tz
divergence that a green local run hides.

**`wallClockToInstant`**
- `('2026-07-30','06:30','America/Chicago')` → `2026-07-30T11:30:00.000Z` (CDT, UTC-5).
- `('2026-01-15','06:30','America/Chicago')` → `2026-01-15T12:30:00.000Z` (CST, UTC-6) — proves DST is read from the date, not hardcoded.
- `('2026-07-30','06:30','UTC')` → `2026-07-30T06:30:00.000Z`.
- Spring-forward, the nonexistent local hour: `('2026-03-08','02:30','America/Chicago')`.
- Fall-back, the repeated local hour: `('2026-11-01','01:30','America/Chicago')`.
- Malformed date, malformed time, malformed timezone → `INVALID_DATE`.

**`ShiftInterval.create` — the Rush Bowls regression**
- `create('2026-07-29','06:30','12:30','America/Chicago')` → `startAt` is
  `2026-07-29T11:30:00.000Z`. **Fails on the current code even under `TZ=UTC`**
  (it yields `06:30:00.000Z`), so it is a true regression test, not a tautology.
- Midnight crossing: `create('2026-07-30','22:00','06:00','America/Chicago')` →
  end is the next calendar day, duration exactly 8 h.
- Midnight crossing across spring-forward:
  `create('2026-03-07','22:00','06:00','America/Chicago')` → duration **7 h**, not 8.
- Existing contracts preserved: `INVALID_DURATION` on equal times, `TOO_SHORT`
  under 15 min, `MAX_ENDURANCE` over 16 h.

**`ShiftDialog` round trip**
- Prefill a shift stored as `2026-07-30T11:30:00.000Z` with `timezone="America/Chicago"`
  → the date field reads `2026-07-30` and the time field `06:30`, under any host TZ.
- Submit without editing → `start_time` in the payload is byte-identical to the
  stored value. This is the assertion that would have caught a write-only fix.

**Existing call sites**
- ~60 `ShiftInterval.create(...)` uses across `shiftInterval.test.ts`,
  `shiftValidator.test.ts`, `useShiftPlanner.test.ts`,
  `useValidatedShiftMutations.test.tsx` and `useShiftPlanner.delegation.test.tsx`
  take an explicit `'UTC'`. Mechanical, and it converts each from
  *implicitly host-TZ-dependent* to *explicitly deterministic* — exactly the
  remediation `memory/lessons.md:1297` prescribes.
- [`useShiftPlanner.test.ts:211`](../../../tests/unit/useShiftPlanner.test.ts#L211)
  carries a comment reasoning about `create(...)` "in CST", so it takes
  `'America/Chicago'` and its pinned instant is re-derived rather than
  re-pinned blind (`memory/lessons.md:1182`).

**E2E**
- Pin the test restaurant's timezone explicitly before navigating and assert on
  the network side-effect, never on host-offset-derived clock strings
  (`memory/lessons.md:1009`; note `restaurants.timezone` **defaults to
  `America/Chicago`**, not UTC).
- Assign an employee to a template whose wall clock is known, then assert the
  `POST /shifts` body's `start_time` equals the instant computed from the
  restaurant timezone.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| A required 4th parameter is a breaking change to a shared value object | It is the point — the compiler enumerates every call site. All are in this repo; `grep` confirms 5 test files + 3 source files. |
| Two wall-clock converters exist until the display branch merges | Documented in §4 with a named follow-up to delegate to `parseWallClock`. |
| Existing tests pinned to host-local instants start failing | Expected and desired — each becomes explicit. Re-derive every changed pin from first principles rather than re-pinning the observed value (`memory/lessons.md:1182`). |
| Fixing the write while some display surface still renders host-local would look like a *new* bug to the customer | The Planner grid is already restaurant-tz-aware (§2), so the loop closes. Other surfaces are the display branch's scope and are no worse than today. |
| Malformed `restaurants.timezone` throwing at render | Prod has 35 rows, 0 null/empty, 5 valid IANA zones. `ShiftDialog`'s memo and submit both gain `try/catch`; the Planner's create path already catches ([`useValidatedShiftMutations.ts:234-236`](../../../src/hooks/useValidatedShiftMutations.ts#L234)). |
