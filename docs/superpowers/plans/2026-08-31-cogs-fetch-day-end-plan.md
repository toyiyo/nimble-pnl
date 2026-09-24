# Plan: inclusive day-end bound for COGS bank queries

Design: docs/superpowers/specs/2026-08-31-cogs-fetch-day-end-design.md

## Task 1 — RED: add the failing unit test

Add one test to `tests/unit/cogsFetch.test.ts`:

- Name: `applies the inclusive day-end bound to both transaction_date filters`.
- Reuse the existing `makeClient` mock. It records filter calls per query.
- Call `fetchFinancialCOGSRows(client, 'rest-1', '2026-08-01', '2026-08-31')`.
- Assert the bank query records
  `['lte', 'transaction_date', '2026-08-31T23:59:59.999Z']`.
- Assert the split-parent query records the same call.
- Assert the `pending_outflows` query records
  `['lte', 'issue_date', '2026-08-31']`.
- Run `npx vitest run tests/unit/cogsFetch.test.ts`. The new test must fail.
  The failure output must show the bare `2026-08-31` bound.

## Task 2 — GREEN: fix the two filters

Change `src/services/cogsFetch.ts`:

- Add `import { toInclusiveDayEnd } from '@/lib/dateOnly';`.
- Line 61: `.lte('transaction_date', toInclusiveDayEnd(endDateStr))`.
- Line 78: `.lte('transaction_date', toInclusiveDayEnd(endDateStr))`.
- Do not change the `pending_outflows` bound or any `.gte` bound.
- Run `npx vitest run tests/unit/cogsFetch.test.ts`. All tests must pass.
- Commit both files together.

## Task 3 — Verify

- `npm run test` (full unit suite)
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:db` after a fresh `npm run db:reset` (shared-db lesson)
- E2E gate: justified exception. The change edits a query upper bound.
  The visible effect depends on a transaction with a UTC timestamp after
  midnight on the period's last day. The unit test pins the exact bound
  string, which is deterministic. An E2E assertion on a dashboard total
  would depend on the runner timezone (lesson 2026-04-11). Run the existing
  E2E suite unchanged.

## Dependencies

Task 2 depends on Task 1. Task 3 depends on Task 2.
