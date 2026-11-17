# Bank reconnect dedupe: build plan

Design: `docs/superpowers/specs/2026-11-05-bank-reconnect-dedupe-design.md`
Branch: `fix/bank-reconnect-dedupe`

Use TDD for each task: write the failing test, then the code. Stage explicit paths only.

## Task 1: Fetch failure result

Files: `supabase/functions/_shared/bankSyncAccountDecision.ts`,
`tests/unit/bankSyncAccountDecision.test.ts`.

1. Add tests for `resultForFetchFailed`. Status is `refresh_failed`, `synced` is 0,
   and `shouldStampLastSyncAt` is false.
2. Add the function.

## Task 2: Pure planner

Files: `supabase/functions/_shared/bankTransactionRekey.ts` (new),
`tests/unit/bankTransactionRekey.test.ts` (new).

1. Add the tests in design section 5.
2. Add `BANK_ROW_MATCH_SELECT`, `MAX_REKEYS_PER_RUN`, the key functions, and
   `planTransactionStore`.
3. Reach at least 80% new coverage, conditions included.

## Task 3: Sync function

File: `supabase/functions/stripe-sync-transactions/index.ts`.

1. Set `fetchComplete = false` in the catch at lines 214-216. Push
   `resultForFetchFailed` and do not add the account to `pendingFetchAccounts`.
2. Replace lines 223-296 with the page reads, the plan, and the decisions (design 3.4).
3. Skip the store step if a read fails or `fetchComplete` is false.
4. Keep a `reconciled` status on a re-key.
5. Treat `23505` as a skip on an insert and on a re-key update.
6. Add `rekeyedCount` and `deferredCount` to the log line and the response.
7. Run `deno check supabase/functions/stripe-sync-transactions/index.ts`.

## Task 4: Checks

1. Run `npm run test`, `npm run typecheck`, and `npm run lint`.
2. State the E2E gate as a Justified exception (design section 5).

## Out of this PR

The Alamo Ranch cleanup. It needs separate approval. See
`docs/superpowers/plans/2026-11-05-alamo-ranch-cleanup-plan.md`, which stays out of git.
