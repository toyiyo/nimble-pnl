# Design: Delete the dead page EmployeeShiftMarketplace

Date: 2026-08-14
Branch: claude/gifted-joliot-f8335d
Type: chore (dead-code deletion)

## Problem

A Phase 2.5 frontend design review on 2026-08-14 found a dead page
component. No route and no import references
`src/pages/EmployeeShiftMarketplace.tsx`. Dead code adds maintenance
cost and confuses future readers.

## Evidence (premise citations)

Each claim about the current codebase carries a citation.

1. **No code references the component.** The command
   `grep -rn "EmployeeShiftMarketplace" src/` matches only the file
   itself: the declaration at
   `src/pages/EmployeeShiftMarketplace.tsx:21` and the export at
   `src/pages/EmployeeShiftMarketplace.tsx:265`. A second grep across
   `tests/` finds no match.
2. **No route mounts the component.** `src/App.tsx` does not import it.
   The employee shift feed route `/employee/shifts` mounts
   `AvailableShiftsPage` at `src/App.tsx:401`, imported at
   `src/App.tsx:62`.
3. **The dead page uses a shared hook.** It imports
   `useMarketplaceTrades` at `src/pages/EmployeeShiftMarketplace.tsx:9`
   and calls it at `src/pages/EmployeeShiftMarketplace.tsx:27`.
4. **The shared hook has live consumers, so the hook stays.**
   `useMarketplaceTrades` is exported at
   `src/hooks/useShiftTrades.ts:618`. Live consumers:
   - `src/hooks/useAvailableShifts.ts:5` (import) and
     `src/hooks/useAvailableShifts.ts:51` (call). `AvailableShiftsPage`
     consumes `useMarketplaceTrades` indirectly, through
     `useAvailableShifts`, which it imports at
     `src/pages/AvailableShiftsPage.tsx:29` and calls at
     `src/pages/AvailableShiftsPage.tsx:239`.
   - `tests/unit/useShiftTrades.test.ts:27` (unit tests for the hook).
   - `src/components/schedule/TradeMarketplace.tsx:14` — note: this
     component also has zero importers in `src/` and `tests/`. Its
     deletion is out of scope here and is flagged as a separate task.
5. **Historical docs mention the page.** Files under `docs/plans/` and
   `docs/superpowers/` name the component. These docs are historical
   records. Do not edit them.

## Approaches

1. **Delete the file only (chosen).** Delete
   `src/pages/EmployeeShiftMarketplace.tsx`. Change nothing else.
   Risk: none found — no import resolves to the file.
2. **Delete the file and the hook.** Rejected. The hook
   `useMarketplaceTrades` has live consumers (evidence item 4).
3. **Wire the page into a route.** Rejected. `AvailableShiftsPage`
   already serves the employee shift feed (evidence item 2). Two pages
   for one feed would duplicate behavior.

## Design

Delete `src/pages/EmployeeShiftMarketplace.tsx`. No other file changes.

## Test strategy

A deletion adds no new behavior, so it adds no new tests. The gates are:

- `npm run typecheck` — proves no import resolved to the deleted file.
- `npm run test` — proves the unit suite does not depend on the file.
- `npm run lint` and `npm run build` — standard Phase 8 gates.
- E2E: justified exception. The page was reachable by no route, so no
  user-facing behavior changes. There is no seam to exercise.
- `npm run test:db`: justified exception. The change touches no SQL.
