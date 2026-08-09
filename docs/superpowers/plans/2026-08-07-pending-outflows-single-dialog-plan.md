# Plan: one print-check dialog for the pending outflows list

Date: 2026-08-07
Branch: `perf/pending-outflows-single-dialog`
Design: [2026-08-07-pending-outflows-single-dialog-design.md](../specs/2026-08-07-pending-outflows-single-dialog-design.md)

## Scope

Move the print-check dialog and its three data hooks from each row to the list.
Delete `PrintCheckButton.tsx`. No database change, no migration, no RLS change.

Out of scope: list virtualization, and any change to `useCheckBankAccounts`.

## Step 1 — Write the failing tests (TDD, red)

Create `tests/unit/pendingOutflowsSingleDialog.test.tsx`.

Mock `usePendingOutflows`, `useCheckSettings`, `useCheckAuditLog`,
`usePendingOutflowMutations`, `usePermissions`, `RestaurantContext`,
`SearchableAccountSelector`, `@/utils/checkPrinting`, and `sonner`.

Mock `useCheckBankAccounts` with a module-level call counter:

```tsx
let bankAccountsHookCalls = 0;
vi.mock('@/hooks/useCheckBankAccounts', () => ({
  useCheckBankAccounts: () => { bankAccountsHookCalls += 1; return { ... }; },
}));
```

Tests:

1. `renders one print-check dialog for a list of five outflows` — render
   `<PendingOutflowsList onAddClick={noop} />` with 5 pending outflows. Open the
   dialog for row 1. Assert `getAllByRole('dialog')` has length 1.
2. `calls useCheckBankAccounts once for a list of five outflows` — assert
   `bankAccountsHookCalls === 1` after the first render pass.
3. `shows no print button when check settings are missing` — set
   `useCheckSettings` to return `{ settings: null }`. Assert
   `queryByRole('button', { name: /Print check for/i })` is `null`.

These three tests fail today: test 1 finds 0 open dialogs from the list level,
test 2 counts 5, and test 3 needs the new `onPrintCheck` gate.

Rename `tests/unit/PrintCheckButtonCategory.test.tsx` to
`tests/unit/PrintCheckDialogCategory.test.tsx` with `git mv`. Change it to
render `<PendingOutflowsList>` and open the dialog through the row button.
Keep the three category assertions. Add three cases:

4. `clears the form when the user opens a different row` — open row A, type a
   memo, pick bank account X, close, open row B. Assert the memo shows row B's
   `notes`, and the account `<Select>` shows the default account.
5. `clears the form when the user reopens the same row` — open row A, type a
   memo, click Cancel, reopen row A. Assert the memo shows row A's `notes`.
6. `keeps the typed memo when the query refetches the same row` — open row A,
   type a memo, push a new outflow object with the same `id`. Assert the typed
   memo stays.

Update `tests/unit/pendingOutflowCardPrintCheckGate.test.tsx`: drop the
`vi.mock` of `PrintCheckButton`, pass `onPrintCheck={vi.fn()}` to
`<PendingOutflowCard>`, and add a fourth case that omits `onPrintCheck` and
asserts no Print button.

Run `npm run test -- tests/unit/pendingOutflows tests/unit/PrintCheckDialog
tests/unit/pendingOutflowCard`. Confirm the new tests fail for the right
reason. Commit the red tests.

## Step 2 — Create `PrintCheckDialog.tsx` (green)

Copy `src/components/pending-outflows/PrintCheckButton.tsx` to
`src/components/pending-outflows/PrintCheckDialog.tsx` with `git mv`, then
change it:

1. Replace the props with `{ settings, expense, onOpenChange }` (design 5.1).
2. Delete the `useCheckSettings` call and the `if (!settings) return null` line.
3. Delete the `open` state and both `setOpen(false)` calls; use
   `onOpenChange(false)` (design 5.1).
4. Add `isOpen`, `wasOpen`, and `shownExpense`, plus the render-phase reset
   (design 5.3). Delete the old reset effect.
5. Keep the account-init effect, with `isOpen` in place of `open` (design 5.4).
6. Read `displayExpense` everywhere the body reads `expense`. Return `null`
   from the body only when `displayExpense` is `null`; keep the `<Dialog>` and
   its hooks mounted.
7. Delete the trigger `<Button>` and the `<>` fragment. The component now
   returns the `<Dialog>` alone.
8. Keep `handlePrint` byte-for-byte in its current order. Change only
   `expense` to `displayExpense` and `setOpen(false)` to `onOpenChange(false)`.

**Warning: do not reorder the steps in `handlePrint`.** The secret fetch must
stay before the check-number claim and the audit write.

## Step 3 — Change `PendingOutflowsList.tsx`

Add `useState` to the React import. Add:

```tsx
const { settings: checkSettings } = useCheckSettings();
const [activeOutflow, setActiveOutflow] = useState<PendingOutflow | null>(null);
```

Pass `onPrintCheck={checkSettings ? setActiveOutflow : undefined}` to each
`<PendingOutflowCard>`. Render one `<PrintCheckDialog>` after the list, gated
on `checkSettings`.

Keep the hook call above the early returns for `isLoading` and `error`, so the
hook order stays stable.

## Step 4 — Change `PendingOutflowCard.tsx`

Add `onPrintCheck?: (outflow: PendingOutflow) => void` to the props. Replace
the `<PrintCheckButton>` render site with the trigger `<Button>` copied from
`PrintCheckButton.tsx:162-174`, and change `setOpen(true)` to
`onPrintCheck(outflow)`. Keep `e.stopPropagation()` and the `aria-label`.

Gate: `{onPrintCheck && isResolved && hasCapability('edit:pending_outflows') && (...)}`.

Remove the `PrintCheckButton` import.

## Step 5 — Delete `PrintCheckButton.tsx`

Run `grep -rn "PrintCheckButton" src tests` first. Confirm no reference stays.
Delete the file.

## Step 6 — Verify

```bash
npm run typecheck
npm run lint
npm run test
```

All three must pass. Run the full unit suite, not one file, because
`PendingOutflowCard` and `PendingOutflowsList` have other tests.

Then verify the auto-create fix by hand, in the browser:

1. Start the dev server.
2. Open the Expenses page with several pending outflows.
3. Read the console and the network tab. Confirm one `check_bank_accounts`
   query, not one per row.

## Step 7 — E2E check

Grep `tests/e2e` for a spec that prints a check. If one exists, run it. If none
exists, state that in the PR body: this change moves a component and keeps the
same user flow, and the unit tests cover the flow end to end from the list.

## Files

| File | Action |
|------|--------|
| `src/components/pending-outflows/PrintCheckDialog.tsx` | new (`git mv` from `PrintCheckButton.tsx`) |
| `src/components/pending-outflows/PrintCheckButton.tsx` | delete |
| `src/components/pending-outflows/PendingOutflowsList.tsx` | edit |
| `src/components/pending-outflows/PendingOutflowCard.tsx` | edit |
| `tests/unit/PrintCheckDialogCategory.test.tsx` | new (`git mv` from `PrintCheckButtonCategory.test.tsx`) |
| `tests/unit/pendingOutflowCardPrintCheckGate.test.tsx` | edit |
| `tests/unit/pendingOutflowsSingleDialog.test.tsx` | new |

## Definition of done

- One `<Dialog>` in the DOM for a list of any length.
- `useCheckBankAccounts` runs once for the whole list.
- The print flow works from the list, with the same step order.
- The form clears on each open and on each row change.
- `npm run typecheck`, `npm run lint`, and `npm run test` pass.
