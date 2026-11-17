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
| `(description.ilike."%a%",amount.eq.1260.05,amount.eq.-1260.05)` | `200` |

The anon role returns no rows because of RLS. These results prove the parse
only. They do not prove a row match.

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
a decimal string, or `null` if the text is not an amount.

The accepted form is strict:

- One optional `-`, before or after one optional `$`.
- A whole part: ASCII digits, or groups of three digits with commas.
- An optional `.` with one or two ASCII digits. The whole part can be empty
  only when this part exists.
- No spaces inside the text.

`\d` in a JavaScript regular expression matches ASCII digits only. The function
deletes the commas and adds a leading `0` when the whole part is empty.

| Input | Output |
|---|---|
| `$1,260.05` | `1260.05` |
| `1260.05` | `1260.05` |
| `-$1,260.05` | `1260.05` |
| `$-50` | `50` |
| `.5` | `0.5` |
| `-.5` | `0.5` |
| `1,260` | `1260` |
| `1,260.5` | `1260.5` |
| `007` | `007` |
| `0.00` | `0.00` |
| `1,26` | `null` |
| `1,2603` | `null` |
| `12,34,567` | `null` |
| `1260.` | `null` |
| `1260.055` | `null` |
| `1.260,05` | `null` |
| `+5` | `null` |
| `--5` | `null` |
| `5-` | `null` |
| `-` | `null` |
| `.` | `null` |
| `$.` | `null` |
| `($50.00)` | `null` |
| `$ 50` | `null` |
| `1e5` | `null` |
| `NaN` | `null` |
| `USD 50` | `null` |
| `coffee` | `null` |
| `$` | `null` |
| `１２` (full-width digits) | `null` |

The function returns a string and not a number. This keeps the exact digits, so
float conversion cannot change the value. `amount` is `NUMERIC(15, 2)`
(`supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:117`).

`buildBankSearchFilter(text: string): string` returns the full `.or()` string.
It quotes the three text conditions. If `parseSearchAmount` returns a value, it
adds `amount.eq.<value>` and `amount.eq.-<value>`. If the value is zero, it adds
`amount.eq.<value>` only.

Both signs are necessary because debits are negative and credits are positive
(`src/hooks/useBankTransactions.tsx:212-213`).

`applySearchFilter` calls `buildBankSearchFilter`.

### Inventory search

`fetchInventoryTransactions` quotes its value with `quoteForOrFilter`. It gets
no amount match.

## Decided trade-offs

- A bare number such as `2024` also matches an amount of `2024.00`. The match
  is exact, so the search adds few rows. The user chose to match amounts.
- `%`, `_`, and `*` stay wildcards. PostgREST changes `*` to `%` in `ilike`
  values. A `\` stays a LIKE escape character. This behavior does not change.
- A value beyond the column range returns no row and no error. Local PostgREST
  returned `200` for `amount.eq.99999999999999999999`.
- `($50.00)` is not an amount in this change. The search still checks it as
  text.

## Tests

- `tests/unit/utils.test.ts`: `quoteForOrFilter` cases.
- `tests/unit/bankTransactionSearch.test.ts`: the table above and the filter
  string.
- `tests/unit/useBankTransactions.test.ts`: the hook sends a quoted filter.
- `tests/unit/inventoryTransactions.service.test.ts`: the service sends a
  quoted filter.
