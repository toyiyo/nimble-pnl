# Bank transaction search comma fix: plan

Design: `docs/superpowers/specs/2026-11-06-bank-search-comma-design.md`

1. Add failing tests for `quoteForOrFilter` to `tests/unit/utils.test.ts`, then add the function to `src/lib/utils.ts`.
2. Add failing tests in `tests/unit/bankTransactionSearch.test.ts`, then add `parseSearchAmount` and `buildBankSearchFilter` in `src/lib/bankTransactionSearch.ts`.
3. Change the `coffee` assertion in `tests/unit/useBankTransactions.test.ts` to expect a quoted value. Add a test for `$1,260.05`. Check that both fail, then change `applySearchFilter` to call `buildBankSearchFilter`.
4. Add a failing test in `tests/unit/inventoryTransactions.service.test.ts` for a comma in the search. Then change `fetchInventoryTransactions` to call `quoteForOrFilter`.
5. Send the filter from `buildBankSearchFilter` to local PostgREST for `$1,260.05`. Check for a `200`.
6. Run typecheck, lint, and unit tests.
