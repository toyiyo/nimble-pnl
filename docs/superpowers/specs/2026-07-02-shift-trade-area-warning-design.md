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

Two edits in `src/hooks/useShiftTrades.ts`, and they are **separate — both are
required** (frontend review, major):

1. **The `useMarketplaceTrades` query string** (the one that actually feeds
   `AvailableShiftsPage`) embeds `offered_by:employees!offered_by_employee_id(id,
   name, position)`. Add `area`:
   ```ts
   offered_by:employees!offered_by_employee_id(id, name, position, area)
   ```
2. **The shared `ShiftTrade['offered_by']` type** — add `area: string | null`.

These are independent: the `ShiftTrade` type is shared, but the query lives in
`useMarketplaceTrades` with its own select list. Updating only the type would
make `offered_by.area` type-`string` but runtime-`undefined`. The main
`useShiftTrades` query has yet another `offered_by` select; it does not feed this
feature, so leaving its select as-is is fine — but the shared type gains `area`
so any reader sees it. (Pre-existing note from Supabase review: `offered_by.email`
is already in the type but not selected by the marketplace query — a pre-existing
inconsistency we are NOT fixing here to avoid scope creep.)

The `employees` FK on `shift_trades.offered_by_employee_id` is a real
`NOT NULL REFERENCES employees(id)` (confirmed in the create migration), so this
embed is safe — no silent-null PostgREST embed risk, and `employees` SELECT RLS
already exposes coworkers' `area` (same sensitivity as the already-returned
`position`).

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

- Parent (render of each `item.type === 'trade'`, where `currentEmployee` is
  already guaranteed non-null by the page's early returns):
  `const areaMismatch = getAreaMismatch(item.trade.offered_by?.area, currentEmployee.area)`
  passed as `areaMismatch={areaMismatch}`.
- **Card layout** (frontend review, minor): `TradeCard`'s outer element changes
  from the current single-row `flex items-center justify-between` to
  `flex flex-col gap-2`. Row 1 is the existing content+button
  `flex items-center justify-between` block (unchanged). Row 2 is the full-width
  warning panel. The virtualizer's `measureElement` ref sits on the parent's row
  wrapper (outside `TradeCard`), so it re-measures the taller card automatically
  — no wrapper change around the measured element.
- `TradeCard` gains `areaMismatch?: AreaMismatch | null`. When present:
  - Render a **full-width** amber warning panel using the documented CLAUDE.md
    pattern: `flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border
    border-amber-500/20`, `AlertTriangle` icon `aria-hidden`, sentence text at
    **`text-[13px]`** in `text-amber-600` (established in this file for the SHIFT
    TRADE / Pending badges). Copy:
    **"This is a {offeredArea} shift — you work {claimerArea}."**
  - **Accessibility (frontend review, major + minor):** give the warning text a
    stable id `area-mismatch-${trade.id}` and set `aria-describedby` to it on the
    claim button, so a screen-reader user hears the area context exactly when the
    button is focused. Do **not** use `role="status"`/a live region — in this
    virtualized list a live region re-announces every time the row re-mounts on
    scroll (noisy). `aria-describedby` gives the info at the right moment without
    the spam.
  - Relabel the claim button **"Claim anyway"** (from "Accept"), in-flight label
    **"Claiming…"** (from "Accepting…"), and set a concise
    `aria-label={`Claim anyway — trade from ${name} on ${dateLabel}`}` (area
    detail comes through `aria-describedby`). Button stays **enabled** (warn,
    not block). When there is no mismatch, the button keeps its current "Accept"
    text, "Accepting…" in-flight label, and existing `aria-label`, with no
    `aria-describedby`.
- Extend the `memo` comparator to include the mismatch: compare
  `prev.areaMismatch?.offeredArea` / `?.claimerArea` to next (field-by-field, NOT
  by object reference — `getAreaMismatch` returns a fresh object each render, so
  reference compare would always differ and defeat memoization). Optional-chaining
  correctly handles the null↔object transitions.
- Three-state / guards: the warning derives from already-loaded row data
  (`offered_by.area`) + `currentEmployee.area`, not a separate query, so there is
  no independent loading/error state to guard. `currentEmployee` is non-null here
  (page early-returns a skeleton / not-linked state otherwise), and unknown area
  on either side ⇒ `getAreaMismatch` returns null ⇒ no warning. This satisfies the
  "warning heuristics must not fire on missing/errored data" lesson: unknown area
  ⇒ silence, never a false alarm.

## Accessibility

- Warning is visible sentence text (not color-only — it names both areas), icon
  `aria-hidden`, with a stable id `area-mismatch-${trade.id}`.
- The claim button links to it via `aria-describedby` (announced on focus), so no
  live region is needed — this avoids the virtualized-list re-announcement noise a
  `role="status"`/`aria-live` region would cause as rows re-mount on scroll.
- Button `aria-label` stays action-focused ("Claim anyway — …"); the area detail
  rides on `aria-describedby`.

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
