# Plan: show the selected period in the "Net Cash Flow" tile

Design: `docs/superpowers/specs/2026-08-21-pulse-period-net-design.md`
Branch: `fix/pulse-period-net`

## Task 1: rename the metric fields in the lib

Files: `src/lib/cashFlowMetrics.ts`,
`tests/unit/cashFlowMetrics.test.ts`,
`tests/unit/useCashFlowMetrics.test.tsx`

1. RED: change both test files to the new names. Rename
   `netInflows30d` to `totalInflows`, `netOutflows30d` to
   `totalOutflows`, `netCashFlow30d` to `netCashFlow`. Delete every
   assertion on `netInflows7d`, `netOutflows7d`, `netCashFlow7d`.
   Retitle the first case in `tests/unit/cashFlowMetrics.test.ts` to
   state the period-sum invariant. Run the two files; they must fail
   on the old field names.
2. GREEN: apply the same renames in `src/lib/cashFlowMetrics.ts`.
   Delete the three `7d` fields and their computation. Run the two
   files; they must pass.
3. COMMIT.

Note: `src/components/banking/FinancialPulseHero.tsx` and
`src/components/BankSnapshotSection.tsx` fail typecheck until Task 2.
Commit Task 1 and Task 2 together if the typecheck gate blocks the
commit hook; otherwise commit per task.

## Task 2: bind the hero tile and the snapshot to the period net

Files: `src/components/banking/FinancialPulseHero.tsx`,
`src/components/BankSnapshotSection.tsx`,
`tests/unit/FinancialPulseHero.test.tsx`

1. RED: add a case to `tests/unit/FinancialPulseHero.test.tsx`. Mock
   the hook with a 10-day period, `netCashFlow: 6919`, and a label
   `This Quarter`. Assert the tile shows `$6,919`-equivalent output
   and the subtext `This Quarter`. Assert the text `(7 days)` is
   absent. Run the file; it must fail.
2. GREEN: in `FinancialPulseHero.tsx` change `netCashFlow7d` to
   `netCashFlow` (four reads), change the subtext at `:95` to
   `{selectedPeriod.label}`, change `netCashFlow30d` at `:144` and
   `netInflows30d` at `:198` to the new names, and change the icon
   condition at `:97` to `>= 0`. In `BankSnapshotSection.tsx:44`
   change `netCashFlow30d` to `netCashFlow`. Run the file; it must
   pass.
3. COMMIT.

## Task 3: full local gate

Run `npm run typecheck`, `npm run lint`, `npm run test`,
`npm run build`. Fix and commit until green.

E2E gate: justified exception. The change re-binds an existing tile
to an existing field and renames fields. No route, RPC, or record
flow changes. Unit tests cover the tile binding and the lib math.
