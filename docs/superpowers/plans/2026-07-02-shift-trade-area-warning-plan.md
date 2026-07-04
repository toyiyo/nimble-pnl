# Plan: Shift-trade area-mismatch warning

Design: `docs/superpowers/specs/2026-07-02-shift-trade-area-warning-design.md`
Branch: `feature/shift-trade-area-warning`

RED → GREEN → REFACTOR → COMMIT per task. No DB migration. One reachable surface
(`AvailableShiftsPage`).

## Task 1 — Pure helper `getAreaMismatch`
- **RED:** `tests/unit/shiftTradeArea.test.ts` — both-known-and-differ → object
  (trimmed originals); identical → null; case-insensitive identical → null;
  null/undefined/''/whitespace on either side → null; trims before compare + in result.
- **GREEN:** create `src/lib/shiftTradeArea.ts` (`normalizeArea` + `getAreaMismatch`,
  `AreaMismatch` interface).
- **Commit:** `feat(scheduling): getAreaMismatch helper`

## Task 2 — Surface offering employee's area in the marketplace query
- **GREEN:** in `src/hooks/useShiftTrades.ts`, update BOTH (separate edits):
  (a) the `useMarketplaceTrades` embed select → add `area` to
  `offered_by:employees!offered_by_employee_id(id, name, position, area)`, and
  (b) the shared `ShiftTrade['offered_by']` type → add `area: string | null`.
- FK is real (`offered_by_employee_id → employees(id)`, NOT NULL). Leave the
  pre-existing `offered_by.email` type/select inconsistency alone (out of scope).
- **Commit:** `feat(scheduling): include offering employee area in marketplace trades`

## Task 3 — Warning UI in `AvailableShiftsPage` TradeCard
- Parent: compute `getAreaMismatch(item.trade.offered_by?.area, currentEmployee.area)`
  per trade row (currentEmployee non-null after early returns); pass `areaMismatch`.
- `TradeCard`: change outer to `flex flex-col gap-2` (row 1 = existing
  content+button; row 2 = full-width warning). Add `areaMismatch` prop; render
  amber panel (`flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border
  border-amber-500/20`, `AlertTriangle` aria-hidden, `text-[13px]` amber text,
  id `area-mismatch-${trade.id}`, copy "This is a {offeredArea} shift — you work
  {claimerArea}."). NO live region. Button when mismatch → "Claim anyway" /
  "Claiming…", `aria-describedby={id}`, concise cross-area aria-label; stays
  enabled. No-mismatch path unchanged ("Accept"/"Accepting…").
- Extend `memo` comparator: compare `areaMismatch?.offeredArea` / `?.claimerArea`
  field-by-field (not by reference).
- **Verify:** `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- **Commit:** `feat(scheduling): warn on cross-area shift-trade claim`

## Dependencies
1 → 3 (helper used by page). 2 → 3 (area data used by page). 1 and 2 independent.

## Verification gate (Phase 8)
`npm run test && npm run typecheck && npm run lint && npm run build` green.
`npm run test:db` unaffected (no SQL change).
