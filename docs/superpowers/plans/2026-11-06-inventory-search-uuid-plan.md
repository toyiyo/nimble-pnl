# Inventory transaction search uuid fix: plan

Design: `docs/superpowers/specs/2026-11-06-inventory-search-uuid-design.md`

1. In `tests/unit/inventoryTransactions.service.test.ts`, change the expected filter to `reason` and `reference_id` only. Add a test that the filter does not contain `performed_by`. Check that both fail.
2. In `src/services/inventoryTransactions.service.ts`, delete `performed_by.ilike` from the `.or()` list and change the comment. Check that the tests pass.
3. Send the new filter to local PostgREST with a signed-in test user. Check for a `200` and for a row match. Delete the test user and the test link after the check.
4. Run typecheck, lint, and unit tests.
