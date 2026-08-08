# Design: one print-check dialog for the pending outflows list

Date: 2026-08-07
Branch: `perf/pending-outflows-single-dialog`
Status: proposed

## 1. Problem

The pending outflows list breaks the "Single Dialog Pattern" rule in CLAUDE.md.
The rule says: render ONE dialog at list level, not per row.

The list renders one card per outflow:

- `src/components/pending-outflows/PendingOutflowsList.tsx:120-122` maps
  `filteredOutflows` to `<PendingOutflowCard>`.

Each card mounts a `PrintCheckButton`:

- `src/components/pending-outflows/PendingOutflowCard.tsx:179-181` renders
  `<PrintCheckButton expense={outflow} />` behind a capability gate.

Each `PrintCheckButton` owns a full dialog and three data hooks:

- `src/components/pending-outflows/PrintCheckButton.tsx:47-49` calls
  `useCheckSettings()`, `useCheckBankAccounts()`, and `useCheckAuditLog()`.
- `src/components/pending-outflows/PrintCheckButton.tsx:176` renders
  `<Dialog open={open} onOpenChange={setOpen}>`.

So a list of N rows mounts N dialogs and 3N hook instances.

`useCheckBankAccounts` also runs an auto-create side effect:

- `src/hooks/useCheckBankAccounts.ts:222` declares `autoCreatedRef`, a ref that
  is **per hook instance**.
- `src/hooks/useCheckBankAccounts.ts:224-257` runs the effect. The guard at
  line 226 reads `autoCreatedRef.current`, so it stops a repeat in the same
  instance only. N instances each pass the guard and each start the async work.
- Line 227 (`if ((query.data?.length ?? 0) > 0) return;`) is the only shared
  brake. It depends on the React Query cache, which the writes update after the
  fact. This makes the number of duplicate `saveAccount` calls a race.

Nothing bounds N. The list is not virtualized:
`src/components/pending-outflows/PendingOutflowsList.tsx:1` imports only
`useMemo` from React, and the file has no `useVirtualizer`.

## 2. Goal

Move the print-check dialog and its hooks to list level. Reduce the per-card
element to a plain button that sets the active outflow.

Result: 1 dialog and 3 hook instances for the whole list, and 1 run of the
auto-create effect.

## 3. Non-goals

- **Virtualization.** The user's brief names the single-dialog pattern as the
  deliverable and calls the missing `useVirtualizer` an observation. Adding
  virtualization changes scroll, measurement, and keyboard behaviour, and it
  needs its own tests. Keep it as a follow-up.
- **A shared guard inside `useCheckBankAccounts`.** After this change the hook
  runs once on this page, so the per-instance ref is correct again. Other pages
  already call the hook once each (see section 4). Do not change the hook.
- **The check-printing capability gate** on branch `claude/elastic-jang-ef80f3`.
  This work is orthogonal.

## 4. Other callers of the three hooks (must stay unaffected)

- `src/pages/PrintChecks.tsx:99-101` calls all three hooks once, at page level.
- `src/components/checks/CheckSettingsDialog.tsx:65` calls
  `useCheckBankAccounts` once.

Neither renders inside a list, so neither multiplies. This change does not
touch them.

## 5. Design

### 5.1 New component: `PrintCheckDialog`

Create `src/components/pending-outflows/PrintCheckDialog.tsx`.

Props:

```ts
interface PrintCheckDialogProps {
  settings: CheckSettings;                 // never null; the list gates on it
  expense: PendingOutflow | null;          // null = closed
  onOpenChange: (open: boolean) => void;
}
```

The component keeps the whole body of today's dialog: the summary card, the
bank-account `<Select>` (shown only when `accounts.length > 1`), the memo
`<Input>`, the `<SearchableAccountSelector>`, and the footer buttons. It keeps
`useCheckBankAccounts`, `useCheckAuditLog`, and `usePendingOutflowMutations`.

It does **not** keep `useCheckSettings`; `settings` arrives as a prop. This
avoids a second call to the same hook from the same subtree.

`handlePrint` keeps its exact current order
(`src/components/pending-outflows/PrintCheckButton.tsx:76-158`):

1. Fetch MICR secrets (`fetchAccountSecrets`).
2. Claim the check number (`claimForAccount.mutateAsync`).
3. Update the outflow (`updatePendingOutflow.mutateAsync`).
4. Write the audit row (`logCheckAction.mutateAsync`).
5. Build and save the PDF.
6. Show the toast and close.

**Warning: do not reorder these steps.** Step 1 must stay first. A failure
after step 2 or 4 leaves a claimed check number or a "printed" audit row with
no PDF.

### 5.2 Always mounted, not conditionally mounted

Render the dialog as `<PrintCheckDialog expense={activeOutflow} ... />` with
`open={expense !== null}` inside. Do **not** write
`{activeOutflow && <PrintCheckDialog .../>}`.

Reason: with conditional mounting, `useCheckBankAccounts` mounts on the first
open. `defaultAccount` is then still `null`, and the account-init effect can
lose the race, so the first print shows "Please select a bank account". An
always-mounted dialog keeps the current timing: the hooks load while the list
loads.

Cost of always mounted: Radix does not render `DialogContent` children while
the dialog is closed, so the idle cost is the three hooks only — the same three
that a one-row list pays today.

### 5.3 Keep the content through the close animation

`src/components/ui/dialog.tsx:40` gives `DialogContent` the classes
`data-[state=closed]:animate-out`, `fade-out-0`, `zoom-out-95`, and
`slide-out-to-top-[48%]`. Radix keeps the content mounted until that animation
ends. If the component reads `expense` directly, `expense` is already `null`
during the exit, so an empty box fades out and Radix warns about a missing
`DialogTitle`.

Hold the last non-null expense and adjust state during render:

```tsx
const [shownExpense, setShownExpense] = useState<PendingOutflow | null>(null);

if (expense && expense.id !== shownExpense?.id) {
  setShownExpense(expense);
  setMemo(expense.notes ?? '');
  setSelectedCategoryId(expense.category_id ?? null);
}

const displayExpense = expense ?? shownExpense;
```

This replaces the reset effect at
`src/components/pending-outflows/PrintCheckButton.tsx:60-65`. That effect
depends on `[open, expense.notes, expense.category_id]`, so a background
refetch of `usePendingOutflows` that returns a new object clobbers text the
user typed. The render-time form keys on `expense.id`, so a refetch of the same
row does not reset the fields.

### 5.4 Account init

Keep the current behaviour
(`src/components/pending-outflows/PrintCheckButton.tsx:68-71`), with `open`
derived from the prop:

```tsx
const isOpen = expense !== null;
useEffect(() => {
  if (!isOpen) return;
  setSelectedAccountId((current) => current ?? defaultAccount?.id ?? null);
}, [isOpen, defaultAccount?.id]);
```

### 5.5 `PendingOutflowsList`

```tsx
const { settings: checkSettings } = useCheckSettings();
const [activeOutflow, setActiveOutflow] = useState<PendingOutflow | null>(null);
```

Pass `onPrintCheck={checkSettings ? setActiveOutflow : undefined}` to each card,
and render one dialog after the list:

```tsx
{checkSettings && (
  <PrintCheckDialog
    settings={checkSettings}
    expense={activeOutflow}
    onOpenChange={(open) => { if (!open) setActiveOutflow(null); }}
  />
)}
```

`setActiveOutflow` is a stable setter, so no `useCallback` is needed.

### 5.6 `PendingOutflowCard`

Add an optional prop:

```ts
onPrintCheck?: (outflow: PendingOutflow) => void;
```

Replace `<PrintCheckButton expense={outflow} />` at
`src/components/pending-outflows/PendingOutflowCard.tsx:179-181` with the same
`<Button>` markup that lives at
`src/components/pending-outflows/PrintCheckButton.tsx:162-174`, including
`e.stopPropagation()` and `aria-label={`Print check for ${outflow.vendor_name}`}`.

The gate becomes:

```tsx
{onPrintCheck && isResolved && hasCapability('edit:pending_outflows') && (
  <Button ... onClick={(e) => { e.stopPropagation(); onPrintCheck(outflow); }} ... />
)}
```

The `onPrintCheck &&` term reproduces today's `if (!settings) return null` at
`src/components/pending-outflows/PrintCheckButton.tsx:74`: with no check
settings, no Print button appears.

### 5.7 Delete `PrintCheckButton.tsx`

After the move, nothing imports it. `PendingOutflowCard.tsx:179` is its only
render site in the app. Delete the file.

## 6. Test plan

| Test | File | Proves |
|------|------|--------|
| Dialog count for an N-row list | new `tests/unit/pendingOutflowsSingleDialog.test.tsx` | one `PrintCheckDialog`, not N |
| Auto-create effect runs once | same file | `useCheckBankAccounts` mounts once for an N-row list |
| Category flows into `updatePendingOutflow` | rewrite of `tests/unit/PrintCheckButtonCategory.test.tsx` | the print path still works from list level |
| Capability gate | update of `tests/unit/pendingOutflowCardPrintCheckGate.test.tsx` | button hidden when `!isResolved`, `!hasCapability`, or no `onPrintCheck` |
| No check settings | new case in the list test | no Print button and no dialog |

The auto-create test counts hook instances, not database writes: mock
`useCheckBankAccounts` with a module-level counter and assert the counter is 1
after rendering a list of 5 outflows. The current code makes that counter 5.

`tests/unit/PrintCheckButtonCategory.test.tsx` moves to
`tests/unit/PrintCheckDialogCategory.test.tsx` and drives the dialog through
the list, so it covers the trigger and the dialog together.

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Blank dialog during the close animation | `shownExpense` (section 5.3) |
| First print shows "Please select a bank account" | always-mounted dialog (section 5.2) |
| Print button appears with no check settings | `onPrintCheck` is `undefined` when `settings` is null (section 5.6) |
| Typed memo lost on a background refetch | key the reset on `expense.id` (section 5.3) |
| A second render site for `PrintCheckButton` exists | grep before delete; only `PendingOutflowCard.tsx:179` renders it today |

## 8. Files

| File | Change |
|------|--------|
| `src/components/pending-outflows/PrintCheckDialog.tsx` | new |
| `src/components/pending-outflows/PrintCheckButton.tsx` | delete |
| `src/components/pending-outflows/PendingOutflowsList.tsx` | own the state, the settings hook, and the dialog |
| `src/components/pending-outflows/PendingOutflowCard.tsx` | add `onPrintCheck`, inline the trigger button |
| `tests/unit/PrintCheckButtonCategory.test.tsx` | rename and rewrite |
| `tests/unit/pendingOutflowCardPrintCheckGate.test.tsx` | update for `onPrintCheck` |
| `tests/unit/pendingOutflowsSingleDialog.test.tsx` | new |

No database, RLS, or edge-function change. No migration.
