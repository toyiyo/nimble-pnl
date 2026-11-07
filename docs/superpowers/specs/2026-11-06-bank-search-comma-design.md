# Bank transaction search: comma fix and amount match

## Problem

A search for `$1,260.05` on the Banking page fails with this error:

```text
"code": "PGRST100"
"details": "unexpected \"0\" expecting \"not\" or operator (eq, gt, ...)"
```

`applySearchFilter` puts the raw search text into an unquoted `.or()` value
(`src/hooks/useBankTransactions.tsx:183-188`). A comma separates conditions in
a PostgREST logic tree. The comma in the amount therefore splits the condition.

The hook trims the text and does nothing else
(`src/hooks/useBankTransactions.tsx:244`). The hook applies the filter at one
call site (`src/hooks/useBankTransactions.tsx:280`).

`fetchInventoryTransactions` uses the same unquoted pattern
(`src/services/inventoryTransactions.service.ts:137-139`).

The search checks `description`, `merchant_name`, and `normalized_payee` only
(`src/hooks/useBankTransactions.tsx:186`). It does not check `amount`. A quote
fix alone stops the error, but the search still does not find the transaction.

## Evidence

Local PostgREST returned these results:

| `or` value | Result |
|---|---|
| `(description.ilike.%$1,260.05%,merchant_name.ilike.%$1,260.05%)` | `400`, `PGRST100` |
| `(description.ilike."%$1,260.05%",merchant_name.ilike."%$1,260.05%")` | `200` |
| `(description.ilike."%a\"b\\c(d)%")` | `200` |

## Goals

- A search that contains a PostgREST reserved character does not fail.
- A search that is a money amount also finds transactions with that amount.
- The amount match finds debits and credits.

## Non-goals

- No change to the search input or to any other UI.
- No range match or partial match on amounts.
- No change to the existing `sanitizeForOrFilter` callers.
- No database change.

## Design

### `quoteForOrFilter` in `src/lib/utils.ts`

Add `quoteForOrFilter(value: string): string`. It escapes `\` and `"` with a
backslash, then wraps the value in double quotes.

Do not use `sanitizeForOrFilter` (`src/lib/utils.ts:21-31`) here. It deletes
commas, so `$1,260.05` becomes `$1260.05`. That text does not match a
description that contains `$1,260.05`.

### `src/lib/bankTransactionSearch.ts` (new)

`parseSearchAmount(text: string): string | null` returns the absolute amount as
a canonical decimal string, or `null` if the text is not an amount.

| Input | Output |
|---|---|
| `$1,260.05` | `1260.05` |
| `1260.05` | `1260.05` |
| `-$1,260.05` | `1260.05` |
| `$-50` | `50` |
| `.5` | `.5` |
| `1,26` | `null` |
| `1260.055` | `null` |
| `coffee` | `null` |
| `$` | `null` |

The function returns a string and not a number. This keeps the exact digits, so
float conversion cannot change the value. `amount` is `NUMERIC(15, 2)`
(`supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:117`).

`buildBankSearchFilter(text: string): string` returns the full `.or()` string.
It quotes the three text conditions. If `parseSearchAmount` returns a value, it
adds `amount.eq.<value>` and `amount.eq.-<value>`.

Both signs are necessary because `applyAmountFilters` treats debits as negative
(`src/hooks/useBankTransactions.tsx:197-199`).

`applySearchFilter` calls `buildBankSearchFilter`.

### Inventory search

`fetchInventoryTransactions` quotes its value with `quoteForOrFilter`. It gets
no amount match.

## Decided trade-offs

- A bare number such as `2024` also matches an amount of `2024.00`. The match
  is exact, so the search adds few rows. The user chose to match amounts.
- `%` and `_` stay LIKE wildcards. This behavior does not change.
- A value with more than 13 whole digits exceeds the column range. The
  comparison returns no row, and no error occurs.

## Tests

- `tests/unit/utils.test.ts`: `quoteForOrFilter` cases.
- `tests/unit/bankTransactionSearch.test.ts`: the table above and the filter
  string.
- `tests/unit/useBankTransactions.test.ts`: the hook sends a quoted filter.
- `tests/unit/inventoryTransactions.service.test.ts`: the service sends a
  quoted filter.
