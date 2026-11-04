# Design: Bank picker account ending and settlement-account suggestion

Date: 2026-09-03
Branch: `feature/deposit-match-bank-picker`
Base: `origin/main` at `a2a2515c` (contains the Deposit Match merge, PR #795)

## Goal

Two changes to the Deposit Match SetupDialog bank picker:

1. Show the account ending (last 4 digits) next to each bank name.
2. Suggest the bank account that receives deposits from the selected POS
   source. Show the suggestion. Do not auto-select it.

## Production evidence (2026-09-03, read-only)

The scan idea works on real data. For restaurant
`7c0c76e3-e770-401b-a2a9-c1edd407efed`, the last 90 days of positive
`bank_transactions` rows show:

| Bank | Descriptor pattern found | Rows |
|---|---|---|
| Mercury ••9866 | `SHIFT4; PYMT PROC; ...` | 70 |
| Mercury ••9510 | `Citizens; NET SETLMT; TST* ...` | 71 |
| 6 other accounts | no POS pattern | 0 |

Two facts drive the pattern table:

- Toast deposits do not contain the word "Toast". They carry the `TST*`
  merchant prefix.
- Focus deposits carry the `SHIFT4` descriptor. Focus card payments settle
  through Shift4 Payments rails.

## Current code (premises, with citations)

- `connected_banks.account_mask` exists and holds the Stripe last-4 digits.
  The column and its backfill:
  `supabase/migrations/20260723130000_connected_banks_reauth_columns.sql:10`
  and `:28`.
- `get_deposit_match_report` builds the `banks` payload with only four
  fields: `connected_bank_id`, `institution_name`, `status`,
  `data_current_through`:
  `supabase/migrations/20260901160000_deposit_match_refresh_engine.sql:406-411`.
- `DepositMatchBank` mirrors those four fields:
  `src/types/depositMatch.ts:133-138`.
- `parseDepositMatchReport` checks that `banks` is an array and casts the
  raw payload. Extra fields on a bank row pass through:
  `src/types/depositMatch.ts:178-180` and `:197`.
- The SetupDialog bank `SelectItem` shows `bank.institution_name` only:
  `src/components/deposit-match/SetupDialog.tsx:361-365`.
- The dialog gets `banks` as a prop of type `DepositMatchBank[]`:
  `src/components/deposit-match/SetupDialog.tsx:27`.
- The POS source picker calls `applySourceDefaults` on change:
  `src/components/deposit-match/SetupDialog.tsx:322-324` and `:127`.
- The dispatcher supports six sources: `focus`, `toast`, `square`, `revel`,
  `shift4`, `clover`:
  `supabase/migrations/20260901150000_deposit_match_adapters.sql:280-290`.
- `bank_transactions` has an index on `restaurant_id`:
  `supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:208`.
- `deposit_match_rules.descriptor_pattern` exists and narrows the engine's
  transaction match per rule:
  `supabase/migrations/20260901140000_deposit_match_tables.sql:32`,
  `supabase/migrations/20260901160000_deposit_match_refresh_engine.sql:152`.
  This design does not change it.
- The E2E spec picks the bank option by name with a substring match:
  `tests/e2e/deposit-match.spec.ts:111-112`. A label suffix does not break
  the selector.
- The amber suggestion panel is the house pattern for AI or system
  suggestions: `CLAUDE.md` section "Cards and Containers", class
  `bg-amber-500/10 border border-amber-500/20`.

## Change 1: Account ending in the picker

### SQL

One new migration replaces `get_deposit_match_report`. The `banks` payload
gains one field:

```sql
'account_mask', cb.account_mask,
```

The replacement restates the exact function header from
`supabase/migrations/20260901160000_deposit_match_refresh_engine.sql:312-318`:
`SECURITY DEFINER`, `STABLE`, and `SET search_path = public, pg_temp`.
`CREATE OR REPLACE FUNCTION` does not inherit these. The migration also
restates the `REVOKE`/`GRANT` pair, per the pattern at
`supabase/migrations/20260901160000_deposit_match_refresh_engine.sql:426-427`.
A pgTAP test checks `prosecdef` for the function after the replace.

### TypeScript

- `DepositMatchBank` gains `account_mask: string | null`.
- A new helper `bankLabel(bank)` in `src/lib/depositMatchUi.ts` returns
  `"Mercury ••9866"` when a mask exists, `"Mercury"` when it does not.
- The SetupDialog `SelectItem` shows `bankLabel(bank)`.

## Change 2: Settlement-account suggestion

### Where the scan runs

The scan runs in SQL, inside the same `get_deposit_match_report` function.
Reason: the report RPC is the one server-side aggregation point. A
client-side scan pulls raw `bank_transactions` rows into the browser and
hits the PostgREST 1000-row cap. This was a recorded concern from the user.

### Pattern table

A per-source regex, inline in the function:

| Source | Pattern | Reason |
|---|---|---|
| `focus` | `SHIFT.?4` | Focus settles through Shift4 Payments |
| `shift4` | `SHIFT.?4` | Same rails |
| `toast` | `TST\*\|TOAST` | Toast merchant prefix is `TST*` |
| `square` | `SQ \*\|SQUARE` | Square merchant prefix is `SQ *` |
| `clover` | `CLOVER` | Direct name |
| `revel` | none | No stable descriptor is confirmed |

A source with no pattern gets no suggestion.

The `focus` and `shift4` patterns are identical, so both sources point at
the same bank. This is an accepted limitation: the descriptor identifies
the settlement rail, not the POS product. The amber panel copy names the
descriptor ("Shift4 deposits", "TST* deposits"), not the POS source, so the
copy stays true for both.

### Scan shape

For each connected bank, count `bank_transactions` rows whose `description`
matches each pattern. The row filter is: `bt.amount > 0`,
`bt.is_transfer IS NOT TRUE` (the same candidate filter the match engine
uses at
`supabase/migrations/20260901160000_deposit_match_refresh_engine.sql:149`),
and `bt.transaction_date >= CURRENT_DATE - 90`. The column is a plain
`DATE`, so the bound uses `CURRENT_DATE`, not `now()`. Compute all
per-source counts in one pass per bank with `count(*) FILTER (WHERE ...)`
clauses, on the `idx_bank_transactions_bank_date` index
(`supabase/migrations/20260723130000_connected_banks_reauth_columns.sql:52-53`).
Keep a source only when the count is 3 or more. The threshold cuts one-off
noise, for example a refund from a marketplace with a similar name.

The `banks` payload gains one field per bank:

```json
"suggested_sources": { "focus": 70, "shift4": 70 }
```

An empty object means no suggestion. The scan is one indexed pass over one
restaurant's 90-day window. Cost: a few hundred to a few thousand rows.

### TypeScript

- `DepositMatchBank` gains `suggested_sources: Record<string, number>`.
- A new helper `suggestedBankForSource(banks, pos_source)` in
  `src/lib/depositMatchUi.ts` returns the bank with the highest hit count
  for the source, or `null`.
- Both helpers are defensive against a stale payload from an old RPC
  version: `suggestedBankForSource` reads
  `bank.suggested_sources ?? {}`, and `bankLabel` shows the plain
  institution name when `account_mask` is null, undefined, or empty. The
  mask is `text`, not a fixed-width type
  (`supabase/migrations/20260723130000_connected_banks_reauth_columns.sql:10`);
  the helper prefixes `••` to any non-empty mask, at any length.
- A display-label map gives the panel its descriptor name: `focus` and
  `shift4` show "Shift4", `toast` shows "TST*", `square` shows "SQ*",
  `clover` shows "Clover".

### UI (SetupDialog)

- The dropdown option of a suggested bank gets a `Suggested` badge
  (`text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-foreground`,
  matching the tender chip at
  `src/components/deposit-match/SetupDialog.tsx:406`).
- The shadcn `SelectItem` passes its children into
  `SelectPrimitive.ItemText` (`src/components/ui/select.tsx:107-124`).
  Radix mirrors `ItemText` into the closed trigger, so a badge placed in
  the children leaks into the trigger. The bank list therefore uses a
  small local `BankSelectItem` built on `SelectPrimitive.Item`: the
  `ItemText` holds only the label from `bankLabel(bank)`, and the badge is
  a decorative sibling with `aria-hidden="true"`. It copies the shadcn
  item classes. The shared `src/components/ui/select.tsx` stays unchanged.
- When a suggestion exists and the picked bank differs from it, show an
  amber panel under the picker: "We see Shift4 deposits in Mercury ••9866."
  with a button "Use this bank". The button sets `connected_bank_id`. The
  panel uses the house amber suggestion classes.
- The panel renders as an `<output>` element, which carries the implicit
  `status` role, so a screen reader announces its appearance. This follows
  the PR #795 precedent for the verdict banner.
- The "Use this bank" button uses the secondary style from CLAUDE.md:
  `h-8 px-3 rounded-lg text-[13px] font-medium`, amber-tinted text to
  match the panel.
- The suggestion never auto-selects a bank. The user stays in control.
- The panel is hidden when no suggestion exists, or when the suggested bank
  is already picked.

## Not in scope

- No change to `deposit_match_rules.descriptor_pattern` defaults. A default
  pattern changes engine match semantics — a recorded lesson
  (`memory/lessons.md`, 2026-09-03, "A review fix that changes engine
  semantics silently breaks the test seed premise").
- No new index. The `idx_bank_transactions_bank_date` index bounds the scan.
- No Revel pattern until a real descriptor is confirmed in production.

## Decided trade-offs

- The dialog footer stays non-sticky
  (`src/components/deposit-match/SetupDialog.tsx:296` and `:511`). The new
  panel can push the footer below the fold on a small viewport. The dialog
  already scrolls inside `max-h-[80vh]`, and a sticky footer is a separate
  change for every dialog in the app. Accepted for consistency.
- The `focus` and `shift4` sources share one pattern, so one bank can carry
  a suggestion for both. The panel copy names the descriptor, not the POS
  source, so the copy stays true. Accepted; a per-processor mapping is a
  later change.

## Tests

- pgTAP (`supabase/tests/deposit_match_report_banks_test.sql`): seed a bank
  with `account_mask` and 3+ transactions with a `TST*` description. Check
  the payload carries `account_mask` and `suggested_sources` with the
  count. Check the threshold both ways: 2 matching rows produce no
  suggestion, and exactly 3 rows produce one. Check the dual-source case:
  3+ `SHIFT4` rows put both `focus` and `shift4` in `suggested_sources`.
  Check `prosecdef` and the search path on the replaced function.
- Unit (`tests/unit/depositMatchUi.test.ts`): `bankLabel` with and without
  a mask; `suggestedBankForSource` picks the highest count, returns `null`
  for an unknown source and an empty bank list.
- Unit (`tests/unit/depositMatch.types.test.ts`): the parser passes the two
  new fields through.
- Unit (`tests/unit/SetupDialog.test.tsx`): badge shows on the suggested
  option; amber panel shows and its button picks the bank; panel hides when
  the suggested bank is picked; the "Use this bank" button works with the
  keyboard only (Tab to focus, Enter to activate).
- E2E (`tests/e2e/deposit-match.spec.ts`): seed the bank with
  `account_mask: '9510'` and give the seeded transaction a `TST*`
  description plus two more `TST*` rows. Check the option label shows
  `••9510`, the panel appears for `toast`, and its button picks the bank.
