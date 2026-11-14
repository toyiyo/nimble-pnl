# E2E failures on main: root causes and fixes

STE-aligned.

## Scope

These Playwright specs fail on `main`:

| Spec | State on main | CI evidence |
|------|---------------|-------------|
| `tests/e2e/pos-sale-with-tip.spec.ts:13` | Fails every time | Runs 43360580959, 43360117703, 43363507480, 43370285930 |
| `tests/e2e/overnight-shift-hours.spec.ts:129` | Flaky | Run 43370285930: `Expected "5"`, `Received "0.00"` |
| `tests/e2e/tip-sharing.spec.ts:195`, `:240` | Flaky | Run 41765360427: `Expected {"mode":"exactly","percentage":30} Received: undefined`, and a `locator.fill` timeout |
| `tests/e2e/tips-complete-flow.spec.ts` | Flaky (shard 4/4) | No failure log found. It uses the same Tips page code. |

## 1. POS sale with tip

**Cause.** The CI runner uses UTC. The restaurant timezone is
`America/Chicago`. PR #861 sets the default end date of the POS Sales list to
the restaurant day. The spec seeds the sale on the host (UTC) day. From 00:00
to 06:00 UTC, the UTC day is one day after the restaurant day. The sale is
then out of range, and the page shows "No sales in this range."

**Fix.** The spec reads `restaurants.timezone` and seeds the sale on the
restaurant day. Commit 9830e660 (#869) on `main` has this fix, so this branch
does not change the spec.

## 2. Overnight shift hours on the Tips page

**Cause.** `useTimePunches` returns punches with `punch_time` descending.
`src/pages/Tips.tsx` had three hours producers with different rules:

1. The bootstrap effect.
2. The refresh effect. It paired each `clock_in` with a `clock_out` at a later
   array index. In a descending array the `clock_out` is at an earlier index,
   so this rule always gave `0.00`.
3. The Recalculate button.

The refresh effect runs again when its dependencies change. It then wrote
`0.00` over the correct value from the other two producers. The race made the
spec flaky.

**Fix.** A new pure function, `hoursFromPunches`
(`src/utils/tipHours.ts`), wraps `calculateWorkedHoursForClockInDay`. All
three producers use it. The refresh effect keeps the `mergeManualHours` rule,
so manual edits stay.

## 3. Tip-sharing role rules

**Cause.** Two races in the tip settings autosave:

- The hydration effect in `src/pages/Tips.tsx` copied `settings` into local
  state on each refetch. A refetch that returned an older row wrote over an
  unsaved local role rule. The autosave then saw no difference and did not
  save. The spec then read `undefined` for the role rule.
- `useAutoSaveTipSettings` could start a second save while the first save was
  in flight. Before the first insert returns, no row `id` is known, so both
  saves insert a row.

**Fix.**

- `src/utils/tipSettingsSync.ts` (new): `tipSettingsKey` and
  `shouldHydrateTipSettings`. The page hydrates only on the first load, or
  when the local state is equal to the last hydrated state, or when the local
  state is equal to the incoming row. Thus a refetch never removes an unsaved
  local edit.
- `src/hooks/useAutoSaveTipSettings.ts`: a new `isSaving` option. The hook does
  not schedule a save while a save is in flight. When `isSaving` goes back to
  false, the effect runs again and saves the latest state.
- `src/hooks/useTipPoolSettings.tsx`: the update mutation writes the saved row
  into the query cache with `setQueryData`. The next save then knows the row
  `id` and does an update.

## Tests

- `tests/unit/tipHours.test.ts`: 4 tests for `hoursFromPunches` (descending
  order, rounding, no punches, a shift from the previous evening).
- `tests/unit/tipSettingsHydration.test.ts`: the key and the 4 hydration cases,
  which include the refetch race.
- `tests/unit/useAutoSaveTipSettings.test.ts`: no save while a save is in
  flight.
- Local E2E with `TZ=UTC` at 03:00 UTC (inside the failure window): all four
  specs pass. `tip-sharing` and `overnight-shift-hours:129` pass with
  `--repeat-each=3`.
