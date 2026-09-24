# Plan: Bank picker account ending and settlement-account suggestion

Date: 2026-09-03
Branch: `feature/deposit-match-bank-picker`
Design: `docs/superpowers/specs/2026-09-03-deposit-match-bank-picker-design.md`

Follow the design doc for every detail. This plan gives the task order.
Write each test before the code it checks (TDD).

## Task 1: SQL migration and pgTAP test

Files:
- `supabase/migrations/20260903140000_deposit_match_report_bank_suggestions.sql` (new)
- `supabase/tests/deposit_match_report_banks_test.sql` (new)

Steps:
1. Write the pgTAP test first. Seed a restaurant, a bank with
   `account_mask = '9510'`, and `bank_transactions` rows. Cases:
   - The payload `banks` entry carries `account_mask`.
   - 3 rows with a `TST*` description give `suggested_sources` with
     `toast: 3`.
   - 2 matching rows give no `toast` key (threshold check, low side).
   - Exactly 3 rows pass (threshold check, exact side).
   - 3+ rows with a `SHIFT4` description put both `focus` and `shift4`
     in `suggested_sources`.
   - A negative-amount row and an `is_transfer = true` row do not count.
   - `prosecdef` is true and the search path is `public, pg_temp` for
     `get_deposit_match_report` after the replace.
2. Write the migration. `CREATE OR REPLACE` the function with the full
   header restated: `SECURITY DEFINER`, `STABLE`,
   `SET search_path = public, pg_temp`. Restate the `REVOKE`/`GRANT`
   pair. Add `'account_mask', cb.account_mask` and the
   `suggested_sources` object to the `banks` payload. Follow the scan
   shape in the design: one pass per bank with
   `count(*) FILTER (WHERE description ~* pattern)` clauses, filters
   `amount > 0`, `is_transfer IS NOT TRUE`,
   `transaction_date >= CURRENT_DATE - 90`, threshold 3.
3. Run `npm run test:db`. The new test and the five existing
   `deposit_match_*` tests must pass.

## Task 2: Types and parser

Files:
- `src/types/depositMatch.ts`
- `tests/unit/depositMatch.types.test.ts`

Steps:
1. Test first: the parser passes `account_mask` and `suggested_sources`
   through on a bank row.
2. Add `account_mask: string | null` and
   `suggested_sources: Record<string, number>` to `DepositMatchBank`
   (`src/types/depositMatch.ts:133-138`). The parser needs no new
   checks; it casts the payload.

## Task 3: UI helpers

Files:
- `src/lib/depositMatchUi.ts`
- `tests/unit/depositMatchUi.test.ts`

Steps:
1. Tests first: `bankLabel` with a mask, without a mask, with an empty
   string, with an undefined field on a cast fixture;
   `suggestedBankForSource` picks the highest count, returns `null` for
   an unknown source, an empty list, and a bank row without the field.
2. Write `bankLabel(bank)` and `suggestedBankForSource(banks, source)`
   per the design, defensive per the design. Add the descriptor label
   map for the panel copy.

## Task 4: SetupDialog UI

Files:
- `src/components/deposit-match/SetupDialog.tsx`
- `tests/unit/SetupDialog.test.tsx`

Steps:
1. Tests first: option shows the `••9510` label; `Suggested` badge shows
   on the suggested option only; amber panel shows when the picked bank
   differs; the "Use this bank" button picks the bank; the panel hides
   when the suggested bank is picked; the button works with Tab and
   Enter.
2. Build the local `BankSelectItem` per the design
   (`SelectPrimitive.Item`, plain label in `ItemText`, badge as an
   `aria-hidden` sibling). Render the panel as an `<output>` element
   with the house amber classes. Do not change
   `src/components/ui/select.tsx`.

## Task 5: E2E extension

Files:
- `tests/e2e/deposit-match.spec.ts`

Steps:
1. In the first test, add `account_mask: '9510'` to the seeded bank.
   Give the seeded transaction a `TST*` description and insert two more
   positive `TST*` rows inside the 90-day window.
2. Check: the bank option label contains `••9510`; the amber panel
   appears after the `toast` source pick; its "Use this bank" button
   picks the bank; the rest of the flow stays green.
3. Warning: the existing option selector uses a substring match
   (`tests/e2e/deposit-match.spec.ts:112`). Keep it.

## Definition of done

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:db`
  pass.
- The deposit-match E2E spec passes.
- PR opens against `main` with the design and plan docs linked.
- CI is green.
