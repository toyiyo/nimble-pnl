# Design: Area-mismatch warning in the shift-trade claim flow

**Date:** 2026-07-02
**Branch:** `feature/shift-trade-area-warning`
**Follow-up to:** PR #562 (manager stale-trade cleanup)

## Problem

When an employee claims a shift offered for trade, there is no signal that the
shift belongs to a *different work area* than theirs. A dishwasher (BOH/Dish) can
claim a bartender's shift (Bar) with no friction, and the manager only catches it
at approval — if at all.

## Decisions (locked, do NOT revisit)

1. **Warn, allow anyway.** Never hard-block. The manager still approves/rejects.
   The claim button becomes a deliberate "Claim anyway" when areas differ.
2. **Area source = the offering employee's `employees.area`** (`offered_by.area`).
   No `shifts.area` column, no `shift_templates` lookup, no schema/migration.
3. **Only warn when BOTH areas are known and differ.** If either the offering
   employee's or the claiming employee's area is null / empty / whitespace,
   show no warning (we can't assert a mismatch we don't know).

## Scope

Only the **claim flow** on the one reachable surface. Verified during discovery:

- `/employee/shifts` → `AvailableShiftsPage` is the **only routed/reachable**
  trade-claim UI. `src/components/schedule/TradeMarketplace.tsx` is **dead**
  (rendered nowhere) and `src/pages/EmployeeShiftMarketplace.tsx` is **dead**
  (not routed). We touch neither — surfacing them would be scope creep and
  risks "fixing" code no user sees.
- NOT the poster status-tracker, NOT the `send-shift-notification` TZ bug, NOT
  any manager-side change.

## Changes

### 1. Data — surface the offering employee's area

`useMarketplaceTrades` (`src/hooks/useShiftTrades.ts`) currently embeds
`offered_by:employees(id, name, position)`. Add `area`:

```ts
offered_by:employees!offered_by_employee_id(id, name, position, area)
```

Extend the `ShiftTrade['offered_by']` type (same file) with `area: string | null`.
The `employees` FK on `shift_trades.offered_by_employee_id` already exists, so
this embed is safe (no silent-null PostgREST embed risk).

The claiming employee's area is **already available**: `useCurrentEmployee` does
`.select('*')`, so `currentEmployee.area` is present — no hook change there.

### 2. Pure helper — `src/lib/shiftTradeArea.ts` (new, unit-tested)

```ts
export interface AreaMismatch {
  offeredArea: string;  // trimmed, original casing preserved for display
  claimerArea: string;
}

/** Normalize an area value: trimmed string, or null when unknown/blank. */
function normalizeArea(area: string | null | undefined): string | null {
  const t = (area ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * Returns mismatch info ONLY when both areas are known and differ
 * (case-insensitive, trimmed comparison). Returns null otherwise —
 * i.e. either area unknown/blank, or the two areas match.
 */
export function getAreaMismatch(
  offeredArea: string | null | undefined,
  claimerArea: string | null | undefined,
): AreaMismatch | null {
  const offered = normalizeArea(offeredArea);
  const claimer = normalizeArea(claimerArea);
  if (!offered || !claimer) return null;
  if (offered.toLocaleLowerCase() === claimer.toLocaleLowerCase()) return null;
  return { offeredArea: offered, claimerArea: claimer };
}
```

Pure, no React, no clock — fully unit-testable. Chosen over inline JSX logic per
the "keep testable logic in a pure helper" lesson.

### 3. UI — warning in `AvailableShiftsPage` `TradeCard`

`TradeCard` is a `memo` component with **no hooks** (data passed as props). Follow
that contract: the **parent** computes the mismatch and passes it down as a
precomputed prop.

- Parent (render of each `item.type === 'trade'`):
  `const areaMismatch = getAreaMismatch(item.trade.offered_by?.area, currentEmployee?.area)`
  passed as `areaMismatch={areaMismatch}`.
- `TradeCard` gains `areaMismatch?: AreaMismatch | null`. When present:
  - Render an amber warning row using the documented CLAUDE.md pattern
    (`bg-amber-500/10 border border-amber-500/20`, `AlertTriangle` icon
    `aria-hidden`, text in `text-amber-600`/amber-700 dark). Copy:
    **"This is a {offeredArea} shift — you work {claimerArea}."**
    Wrap in `role="status"` so it's announced without stealing focus.
  - Relabel the claim button **"Claim anyway"** (from "Accept") and update its
    `aria-label` to convey the cross-area intent. Button stays **enabled**
    (warn, not block).
- Extend the `memo` comparator to include the mismatch so the card re-renders
  when it changes: compare `prev.areaMismatch?.offeredArea/claimerArea` to next.
- Three-state / guards: the warning derives from already-loaded row data
  (`offered_by.area`) + `currentEmployee.area`, not a separate query, so there is
  no independent loading/error state to guard. If `currentEmployee` is still
  loading (`undefined`), `getAreaMismatch(_, undefined)` returns null → no
  warning (fails safe). This satisfies the "warning heuristics must not fire on
  missing/errored data" lesson: unknown area ⇒ no warning, never a false one.

## Accessibility

- Warning uses `role="status"` + visible text; icon is `aria-hidden`.
- Button keeps a descriptive `aria-label` (now including "different area").
- No color-only signal — the text states the areas explicitly.

## Testing

- `tests/unit/shiftTradeArea.test.ts` — `getAreaMismatch`:
  - both known & differ → object with trimmed originals;
  - identical → null; case-insensitive identical (`'Bar'` vs `'bar'`) → null;
  - whitespace-only / empty / null / undefined on either side → null;
  - trims surrounding whitespace before comparing and in the returned value.
- Component-level coverage is optional per CLAUDE.md; the branching logic lives
  in the pure helper, which carries the real coverage. A light render test may
  assert the warning + "Claim anyway" label appear for a mismatched trade and
  are absent for a same-area trade (nice-to-have, not required for the gate).

## Decided trade-offs

- **Offering employee's area over template area:** simplest, zero schema, and
  correct for the common case where the poster works their home area. If a
  poster is cross-covering another area, the warning may be based on their home
  area rather than the shift's true area — accepted per the locked decision; a
  future iteration can switch the source to `shift_templates.area` without
  changing the helper's signature.
- **Warn, not block:** cross-trained staff (a bartender who also runs food) must
  still be able to claim; the manager is the real gate.
- **No new query:** area rides along on the existing marketplace embed, so no
  extra round-trip and no new loading/error surface.
