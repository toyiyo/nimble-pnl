# Design: Preserve manually-entered tip hours (fixes flaky tip E2E tests)

**Date:** 2026-06-04
**Branch:** `fix/tip-hours-preserve-manual-edits`
**Type:** Bug fix (production correctness + E2E test hardening)

## Problem

Four E2E tests in `tests/e2e/tip-payouts.spec.ts` and `tests/e2e/tip-sharing.spec.ts`
fail intermittently in CI (observed in run 26963881125, E2E Shard 4/4):

| # | Test | Failure |
|---|------|---------|
| 1 | tip-payouts:235 "Payout sheet shows correct employee data" | `getByText('Dave Clark')` not found (hard fail) |
| 2 | tip-payouts:91 "Record tip payouts from timeline" | `getByText('Sarah Miller')` not found (flaky) |
| 3 | tip-payouts:163 "Partial payout shows correct badge" | `tip_payouts_amount_check` constraint violation (flaky) |
| 4 | tip-sharing:68 "splits tips proportionally by hours" | `$150.00` live preview not visible (flaky) |

The tests have not changed since PR #427. The failing run was on an unrelated
branch (`fix/timeoff-calendar-first-click`) with zero tips-file diff — i.e. a
pre-existing flake, matching the [2026-05-17] lessons entry that flagged this
tip live-preview pattern as a "long-standing pattern, separate fix."

## Root cause (one production bug, four symptoms)

`src/pages/Tips.tsx` has **two** effects that populate `hoursByEmployee` from
time punches:

- **Effect 1** (`Tips.tsx:250`) correctly **guards manual edits**:
  `if (!prev[empId] || prev[empId] === '0')` before overwriting.
- **Effect 2** (`Tips.tsx:284-322`) **unconditionally** runs
  `setHoursByEmployee(hoursFromPunches)` (line 321) and re-runs whenever
  `eligibleEmployees`, `settings`, or `punches` change reference.

On slow CI, a background React-Query resolution (settings, employees, or
punches) changes Effect 2's deps **mid-entry** and wipes a just-typed hours
value. With one employee's hours wiped to `0`, the by-hours split
(`calculateTipSplitByHours` → `distributeByRatio`) allocates that employee
**$0**. That single imbalanced/zeroed split explains all four symptoms:

- **Symptoms 1 & 2 — name "not found":** `TipPayoutSheet.buildInitialEntries`
  filters `split.items.filter(item => item.amount > 0)` (`TipPayoutSheet.tsx:57`),
  so the `$0` employee is removed from the sheet and the assertion on their name
  fails with "element not found".
- **Symptom 3 — constraint violation:** the seed in the partial-payout test
  inserts `tip_split_items[0].amount` into `tip_payouts`, whose column has
  `CHECK (amount > 0)` (`20260218000000_create_tip_payouts_table.sql:10`). When
  `[0]` lands on the `$0` row, the insert is rejected.
- **Symptom 4 — wrong live preview:** wiped hours produce wrong split amounts,
  so `$150.00` never renders.

That the team already added an `isResumingDraft` guard (`Tips.tsx:290`) to stop
Effect 2 from clobbering *draft-resumed* hours confirms the effect is known to be
dangerous — but the normal manual-entry path was never protected.

This is a real data-accuracy bug: a manager entering tip hours can have them
silently wiped by a background refetch, persisting an incorrect tip split.

## Fix

### Part A — Production: stop Effect 2 from wiping manual edits

The codebase already tracks which hours are user-typed: the hours input's
`onChange` sets `autoCalculatedHours[empId] = false` (`Tips.tsx:676`). Use that
signal to preserve manual edits.

New pure, unit-tested helper:

```ts
// src/utils/tipHours.ts
/**
 * Merge punch-derived hours into the current hours map without clobbering
 * values the user has manually entered. An entry is "manual" when its
 * autoCalculated flag is explicitly false (set by the hours input onChange).
 */
export function mergeManualHours(
  punchDerived: Record<string, string>,
  prev: Record<string, string>,
  autoCalculated: Record<string, boolean>,
): Record<string, string> {
  const merged: Record<string, string> = { ...punchDerived };
  for (const empId of Object.keys(prev)) {
    if (autoCalculated[empId] === false) {
      merged[empId] = prev[empId]; // user-typed — never overwrite
    }
  }
  return merged;
}
```

Wire into Effect 2. To avoid re-running the effect on every keystroke (which
would defeat the purpose and add churn), read the latest flags through a
render-synced ref rather than adding `autoCalculatedHours` to the dependency
array:

```ts
const autoCalculatedHoursRef = useRef(autoCalculatedHours);
autoCalculatedHoursRef.current = autoCalculatedHours; // "latest ref" pattern, every render

// inside Effect 2, replacing `setHoursByEmployee(hoursFromPunches)`:
setHoursByEmployee(prev =>
  mergeManualHours(hoursFromPunches, prev, autoCalculatedHoursRef.current),
);
```

**Behavior change is minimal and precise:** manually-entered hours are never
overwritten; auto-calculated and untouched hours still refresh from punches
exactly as today (Effect 2 keeps computing `hoursFromPunches` and keeps its
`setSelectedEmployees` responsibility unchanged).

### Part B — E2E test hardening (defense-in-depth)

These make the specs robust even if a similar timing issue recurs; with Part A
they should pass deterministically.

1. **Verify each hours fill committed.** Add a small helper used by both specs:
   ```ts
   async function fillHours(page, name: string, hours: string) {
     const input = page.getByRole('spinbutton', { name: new RegExp(name, 'i') });
     await input.fill(hours);
     await expect(input).toHaveValue(hours);
   }
   ```
   Replaces the bare `.fill()` calls in `enterAndApproveTips` (tip-payouts) and
   the inline hours entry (tip-sharing). Catches any regression where a fill
   does not stick, at the point of entry rather than three assertions later.

2. **Seed a guaranteed-positive payout.** In tip-payouts.spec.ts:205, replace
   `splits.tip_split_items[0]` with
   `splits.tip_split_items.find(i => i.amount > 0)` (throw a clear error if none).
   Never seeds a `$0` payout and is independent of Postgres array ordering.

3. **Explicit load timeouts on payout-sheet assertions.** The employee-name and
   allocation assertions that depend on the sheet's async data
   (tip-payouts.spec.ts:126-129, 266-270) get `{ timeout: 15000 }` instead of the
   implicit 5000ms, matching the other timeouts already used in these files.

## Testing strategy

- **Unit (TDD, RED first):** `tests/unit/tipHours.test.ts` covering
  `mergeManualHours`:
  - preserves an entry flagged `false` (manual) even when punch-derived differs;
  - refreshes entries flagged `true` (auto-calculated) from punch-derived;
  - refreshes entries with no flag (undefined) from punch-derived;
  - the exact bug scenario: prev `{a:'8'}` manual, punchDerived `{a:'0.00', b:'0.00'}`
    → result keeps `a:'8'`;
  - empty inputs / disjoint keys.
- **Integration:** the three hardened E2E specs exercise the real Effect 2 path
  against a live Supabase + browser, validating that manual hours survive to an
  approved, balanced split.
- **Regression gate:** `npm run typecheck`, `npm run lint`, `npm run build`, and
  the existing `tests/unit/tips-hours-auto-calculation.test.ts` /
  `tipPooling.test.ts` suites must stay green.

## Decided trade-offs

- **No heavy Tips.tsx render test.** Directly testing Effect 2's wiring would
  require mounting the whole page with all of its mocked React-Query hooks. The
  *logic* is covered by the pure-helper unit test and the *integration* by the
  E2E specs — a better cost/coverage ratio than a brittle full-page render test.
- **Latest-ref over effect dep.** Reading `autoCalculatedHours` via a
  render-synced ref (not the dep array) is deliberate: adding it as a dependency
  would re-run Effect 2 (and its `setSelectedEmployees`) on every keystroke,
  reintroducing exactly the kind of churn we are removing.
- **Pre-existing duplication left in place.** Effect 1 and Effect 2 both derive
  hours from punches (Effect 2 via an inline, break-ignoring reimplementation).
  Consolidating them would change punch-based auto-hours semantics (breaks), which
  is out of scope for a flake fix. Flagged as a follow-up, not addressed here.

## Files

| File | Change |
|------|--------|
| `src/utils/tipHours.ts` | **new** — `mergeManualHours` pure helper |
| `tests/unit/tipHours.test.ts` | **new** — unit tests (TDD) |
| `src/pages/Tips.tsx` | latest-ref + use `mergeManualHours` in Effect 2 |
| `tests/e2e/tip-payouts.spec.ts` | `fillHours` helper, positive-amount seed, load timeouts |
| `tests/e2e/tip-sharing.spec.ts` | `fillHours` helper |

## Out of scope

- Consolidating the two punch-hours effects / unifying on `calculateWorkedHours`.
- Adding per-share positivity validation to the approve gate
  (`TipReviewScreen` currently validates only `remaining === 0`).
- Any change to the `tip_payouts` `CHECK (amount > 0)` constraint — it is correct.
