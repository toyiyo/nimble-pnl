# Inventory transaction search: uuid column fix

## Problem

`fetchInventoryTransactions` builds one `.or()` filter from three columns
(`src/services/inventoryTransactions.service.ts:139-141`). Every search term
fails with `operator does not exist: uuid ~~* unknown`.

The first report named `reference_id` as the uuid column. That report is not
correct. The cause is `performed_by`.

## Evidence

Column types:

- `reference_id` is `TEXT` (`supabase/migrations/20250920123920_6293feda-82b3-4972-839c-63ef0c3903c7.sql:94`).
- `performed_by` is `UUID` (`supabase/migrations/20250920123920_6293feda-82b3-4972-839c-63ef0c3903c7.sql:98`).
- `information_schema.columns` on local Supabase shows the same types.
- The `reference_id UUID` column in `supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:168` is on `journal_entries`, not on this table.

PostgREST results for a signed-in local user, with the pattern `"%a%"`:

| `or` filter | Status | Result |
|---|---|---|
| `reason.ilike` | 200 | rows |
| `reference_id.ilike` | 200 | rows |
| `performed_by.ilike` | 404 | `operator does not exist: uuid ~~* unknown` |
| all three (current code) | 404 | `operator does not exist: uuid ~~* unknown` |
| `reason.ilike`, `reference_id.ilike` | 200 | rows |

## Scope of the defect

- No caller passes `searchTerm` today.
  - `src/hooks/useInventoryTransactions.tsx:57-63` does not pass it.
  - `src/hooks/useHighUsageItems.tsx:41-46` does not pass it.
- `src/pages/InventoryAudit.tsx:93-99` filters on the client. It matches the product name, `reason`, and `reference_id`. It does not match `performed_by`.
- The Deno copy does not have the defect.
  - `supabase/functions/_shared/inventoryTransactions.ts:18` declares `searchTerm`.
  - The function at `supabase/functions/_shared/inventoryTransactions.ts:50` does not read it and builds no `.or()` filter.
  - `supabase/functions/ai-execute-tool/index.ts:1466-1475` does not pass it.

## Decision

Delete `performed_by.ilike` from the `.or()` list. Keep `reason` and
`reference_id`. Change the comment at
`src/services/inventoryTransactions.service.ts:136` to match.

The service search then matches the same columns as the client search in
`src/pages/InventoryAudit.tsx:97-98`.

## Alternatives not selected

- **Cast `performed_by` to text.** PostgREST filters do not accept a cast. This
  needs a generated column or an RPC, and so a migration. A text search on a
  user id gives no value to a person who searches by name.
- **Add `performed_by.eq` when the term is a uuid.** No caller needs this.
- **Delete `searchTerm` from the service.** This is a larger change than the
  defect needs. It also changes the public query type.

## Change list

- `src/services/inventoryTransactions.service.ts`: the filter and the comment.
- `tests/unit/inventoryTransactions.service.test.ts`: change the expected filter. Add a test that no search filter contains `performed_by`.

No schema, RLS, RPC, edge function, or UI change. The Phase 2.5 frontend review
does not apply, because this change touches no UI file.

## Base branch

PR #866 changes the same lines (`src/services/inventoryTransactions.service.ts:138-141`)
and is open. This branch starts from `fix/bank-search-comma`. The PR targets that
branch. Retarget this PR to `main` when PR #866 merges.
