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

**Superseded — the shared converter cannot be deferred.** An earlier revision of
this section planned to build a local `fromZonedTime`-based converter now and
delegate to that branch's `restaurantClock.ts::parseWallClock` after it merged,
calling the duplication "deliberate and time-boxed." The §5.1 measurements kill
that plan: `fromZonedTime` is wrong on both DST edges and host-dependent on one of
them, so Postgres parity is a **correctness requirement of this fix**, not a
later refinement. And parity is not a few lines — it is the offset-probe algorithm
in §5.1, which that branch has already written, tested against Postgres, and
documented.

Independently re-derived that branch's `parseWallClock` against the ten-case table
in §5.1: its `tzOffsetMinutes` is minutes-**east** (Chicago CDT = −300), so its
`Math.min(offsetBefore, offsetAfter)` is this document's `max(UTC − local)`. All
ten agree, including the two sub-hour-DST zones (Lord Howe 30 min, Chatham 45 min)
that its own doc comment does not claim to cover. That implementation is correct.

Waiting for it is not an option: `restaurantClock.ts` is **not on `main`**, and
that branch is 21 commits deep with **no PR open**, while this is a live customer
defect.

**Decision: this branch adds `src/lib/restaurantClock.ts` to `main`**, containing
`safeTz`, `tzOffsetMinutes` and `parseWallClock` copied **verbatim** from
`fix/restaurant-tz-display` (with its tests), and `wallClockToInstant` becomes a
thin adapter that composes `dateStr` + `timeHHMM` into a wall-clock string and
calls `parseWallClock`. This reaches the intended end state — one converter, not
two — immediately rather than on a promise.

Merge consequence, stated plainly: when `fix/restaurant-tz-display` rebases onto
`main` it will conflict on that file's *addition*. The resolution is mechanical —
keep that branch's version, which is a strict superset — and because the shared
functions are byte-identical there is no semantic merge to reason about. That is
a materially better outcome than two independent implementations of a DST
tiebreak drifting apart in a file neither branch's author is looking at.

⚠️ **This is a cross-session coordination point and is flagged for the user**, since
it changes what the other in-flight branch has to resolve at rebase time.

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
- Validates `tz` is a **non-empty** string accepted by `Intl.DateTimeFormat`,
  throwing `TypeError('INVALID_DATE')` otherwise (see "Timezone-validity policy").
- Resolves the wall clock to an instant with Postgres-identical DST semantics
  (algorithm below).

#### It cannot be a `fromZonedTime` wrapper

An earlier draft of this section specified `fromZonedTime(\`${dateStr}T${timeHHMM}:00\`, tz)`.
That is wrong, and measurably so. Probing `date-fns-tz`'s `fromZonedTime` for
`America/Chicago` under two host timezones, against the authoritative
`(…)::timestamp AT TIME ZONE tz` from production Postgres:

| wall clock | `TZ=Asia/Tokyo` | `TZ=UTC` | Postgres | |
|---|---|---|---|---|
| `2026-07-30 06:30` | 11:30Z | 11:30Z | **11:30Z** | ✅ |
| `2026-01-15 06:30` | 12:30Z | 12:30Z | **12:30Z** | ✅ |
| `2026-03-08 02:30` (nonexistent) | 07:30Z | 07:30Z | **08:30Z** | ❌ 1 h off under *both* hosts |
| `2026-11-01 01:30` (repeated) | 07:30Z | 06:30Z | **07:30Z** | ❌ host-TZ-dependent |

Two independent defects: it disagrees with the database on the spring-forward
nonexistent hour, and on the fall-back repeated hour it returns a **different
instant depending on the machine that ran it** — which is the very class of bug
this whole design exists to remove. Shipping it would fix the 120-minute error
and leave a 60-minute one behind on two days a year.

#### The rule Postgres actually follows

Ten cases across five zones, both transition directions, offsets expressed as
`UTC − local` (the `getTimezoneOffset()` convention):

| zone | direction | before | after | PG chose |
|---|---|---|---|---|
| America/Chicago | spring-fwd | 360 | 300 | **360** |
| America/Chicago | fall-back | 300 | 360 | **360** |
| Europe/Dublin | spring-fwd | 0 | −60 | **0** |
| Europe/Dublin | fall-back | −60 | 0 | **0** |
| Europe/London | spring-fwd | 0 | −60 | **0** |
| Europe/London | fall-back | −60 | 0 | **0** |
| Australia/Lord_Howe (30 min DST) | spring-fwd | −630 | −660 | **−630** |
| Australia/Lord_Howe | fall-back | −660 | −630 | **−630** |
| Pacific/Chatham (45 min offset) | spring-fwd | −765 | −825 | **−765** |
| Pacific/Chatham | fall-back | −825 | −765 | **−765** |

Postgres takes the **maximum** every time — one uniform rule, with no special
case for which direction the transition runs. Restated instant-side, where it is
easier to reason about: **of the two candidate instants, always take the later
one.**

`Europe/Dublin` is the case that pins the rule down. tzdb models Dublin with
IST (+1) as *standard* and a *negative* DST offset in winter, so a
"prefer the standard-time offset" rule predicts −60 there — and Postgres chose 0.
The rule is purely numeric, not derived from tzdb's `isdst` designation.

#### Algorithm

Host-TZ-independent: it never reads a local-time getter and never depends on
`process.env.TZ`.

1. Parse the wall clock's literal fields **as if they were UTC** (`Date.UTC(...)`).
2. Probe the zone's offset 24 h either side of that naive value; keep the (at
   most two) distinct offsets.
3. A candidate offset is *valid* if applying it and formatting the result back in
   `tz` reproduces the input wall clock exactly.
4. Exactly one valid candidate → unambiguous, return it.
5. Zero valid (nonexistent hour) or two valid (repeated hour) → take the later
   instant, i.e. the smaller minutes-east offset. Matches Postgres on all ten
   cases above.

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
both. A malformed IANA string therefore surfaces as `INVALID_DATE`, which every
call site already handles (§5.4). Production has 35 restaurants, zero null/empty
timezones, 5 distinct valid IANA zones.

**The empty string must be rejected explicitly, not left to the converter.**
Probed alongside the DST cases: `fromZonedTime('2026-07-30T06:30:00', '')` does
not throw and does not return `Invalid Date` — it silently returns a **host-local**
instant (`2026-07-29T21:30:00.000Z` under `TZ=Asia/Tokyo`, i.e. 06:30 JST).
Malformed *non-empty* zones such as `'Not/AZone'` do return `Invalid Date`, so
`''` is the single input that fails open into precisely the bug being fixed.
Hence the explicit non-empty check in the contract above rather than inferring
invalidity from an `Invalid Date` result.

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
- Malformed date, malformed time, malformed **non-empty** timezone → `INVALID_DATE`.
- **Empty-string timezone → `INVALID_DATE`.** Its own case, not folded in with the
  malformed zones: `''` is the one input that fails open to a host-local instant
  rather than an `Invalid Date` (§5.1), so a test that only covers `'Not/AZone'`
  would pass against the broken implementation.

**`wallClockToInstant` — DST edges, pinned to Postgres**

Each expectation below is the value production Postgres returns for
`(wall)::timestamp AT TIME ZONE zone`, not a value derived from the
implementation. All must hold under every host TZ.

| input | expected |
|---|---|
| `('2026-03-08','02:30','America/Chicago')` nonexistent | `2026-03-08T08:30:00.000Z` |
| `('2026-11-01','01:30','America/Chicago')` repeated | `2026-11-01T07:30:00.000Z` |
| `('2026-03-29','01:30','Europe/Dublin')` nonexistent | `2026-03-29T01:30:00.000Z` |
| `('2026-10-25','01:30','Europe/Dublin')` repeated | `2026-10-25T01:30:00.000Z` |
| `('2026-10-04','02:15','Australia/Lord_Howe')` nonexistent | `2026-10-03T15:45:00.000Z` |
| `('2026-04-05','01:45','Australia/Lord_Howe')` repeated | `2026-04-04T15:15:00.000Z` |

Dublin earns its place: it is the only one of these that distinguishes "smaller
numeric offset" from "the non-DST offset" (§5.1), so dropping it would let a
plausible-but-wrong tiebreak ship green. Lord Howe covers a 30-minute DST shift,
where an implementation that assumes transitions are whole hours still passes
every Chicago case.

Both Chicago rows are additionally asserted **twice under different host
timezones** — the fall-back row is the one that catches host-dependence, since a
`fromZonedTime`-based implementation returns 07:30Z under `TZ=Asia/Tokyo` and
06:30Z under `TZ=UTC`, so a single-host test passes 50 % of the time by luck.

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
