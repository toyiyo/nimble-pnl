# Design: show the staged new-supplier name in the supplier combobox

Date: 2026-09-01
Branch: `fix/supplier-combobox-label`

## Problem

The user opens the supplier combobox, types a new name, and picks
`+ Create New Supplier: "<name>"`. The dropdown closes. The trigger
still shows the placeholder `Search or create supplier...`. The user
gets no confirmation of the selection. In a manual test of the preview
environment, this caused three retries of the create action.

## Root cause

The defect is in `SearchableSupplierSelector`. The component supports
two value conventions, and the display logic covers only one.

Cited claims about the current code:

1. When the user picks the create row, `handleSelect` calls
   `onValueChange(searchValue, true)` and closes the popover
   (src/components/SearchableSupplierSelector.tsx:76-81).
2. `getDisplayValue` shows a name in two cases only: when
   `value === 'new_supplier'`, or when `value` matches a supplier id
   (src/components/SearchableSupplierSelector.tsx:64-74). A raw staged
   name matches neither case, so the trigger shows the placeholder.
3. `ProductUpdateDialog` stores the raw name as the value:
   `setNewSupplier({ ...newSupplier, supplier_id: value })`
   (src/components/ProductUpdateDialog.tsx:855-857).
4. `ProductDialog` stores the raw name the same way:
   `setSelectedSupplierId(value)`
   (src/components/ProductDialog.tsx:636-637).
5. `AddExpenseSheet` also sets the raw name first, then creates the
   supplier and swaps the value to the new id
   (src/components/pending-outflows/AddExpenseSheet.tsx:116-124).
6. The `(new)` indicator renders only when `value === 'new_supplier'`
   (src/components/SearchableSupplierSelector.tsx:106-108). Parents
   that pass a raw name never show it.
7. `ProductUpdateDialog` discriminates a staged name from an id with a
   UUID regex before it saves
   (src/components/ProductUpdateDialog.tsx:934-937).

## Fix

Change `getDisplayValue` and the `(new)` indicator condition in
`SearchableSupplierSelector` only. No parent changes.

Add a derived flag:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStagedNewName =
  !!value?.trim() && value !== 'new_supplier' && !selectedSupplier && !UUID_RE.test(value);
```

The `trim()` call excludes a space-only value. Without it, a
space-only search stages a blank name next to a clear button.

Display rules, in order:

1. `value === 'new_supplier'` → keep the current behavior
   (`pendingNewName || searchValue || '+ Create New Supplier'`).
2. `selectedSupplier` found → show `selectedSupplier.name`.
3. `isStagedNewName` → show `value`. The value is the typed name.
4. Otherwise → show the placeholder.

Indicator and style rules:

- Show the `(new)` suffix when `showNewIndicator` is true and the value
  is `'new_supplier'` or `isStagedNewName`.
- Put a literal space before `(new)`. Without it, the accessible name
  reads as one word, for example "Sysco Foods(new)".
- Style both new cases with `text-primary font-medium`. The trigger
  span now uses `text-blue-600`
  (src/components/SearchableSupplierSelector.tsx:103). CLAUDE.md
  forbids direct color classes. Replace the class on the span the fix
  touches. The dropdown row at line 136 also uses `text-blue-600`; it
  is out of scope for this fix.

Clear button rule:

- The clear button shows for a staged name
  (src/components/SearchableSupplierSelector.tsx:183). This is
  intentional. The user can clear a staged new supplier. The
  `'new_supplier'` sentinel case keeps the button hidden; the sentinel
  parents own the pending state and clear it themselves.

## Why the UUID guard

A parent can pass a supplier id before the `suppliers` query resolves.
In that window `selectedSupplier` is undefined. Without the guard, the
trigger shows a raw UUID. With the guard, the trigger keeps the
placeholder until the list loads. The same regex already discriminates
these two shapes in `ProductUpdateDialog`
(src/components/ProductUpdateDialog.tsx:934-937).

## Effect on parents

- Raw-name parents (`ProductUpdateDialog`, `ProductDialog`,
  `AddPendingOutflowDialog`): these parents store the raw typed name
  as the value (claims 3 and 4;
  src/components/pending-outflows/AddPendingOutflowDialog.tsx:39-40).
  The trigger now shows the staged name. This is the fix.
- Sentinel parents (`AddExpenseSheet`, `EditExpenseSheet`): rule 1 is
  unchanged. Rule 3 also covers the short raw-name window in
  `AddExpenseSheet` before the create resolves (claim 5).
- Create-first parents (`ReceiptMappingReview`,
  `EnhancedCategoryRulesDialog`, `TransactionDetailSheet`): these
  parents call `createSupplier` and write state only after the call
  resolves (src/components/banking/EnhancedCategoryRulesDialog.tsx:134-138).
  The value never holds the raw name. The fix does not change their
  behavior. Their short no-feedback window during the network call is
  out of scope.

## Alternatives considered

- Change every parent to pass the `'new_supplier'` sentinel plus
  `pendingNewName`. Rejected: eight call sites, more risk, no extra
  user value.
- Show any unmatched value without the UUID guard. Rejected: a raw
  UUID can flash while the supplier list loads.

## Tests

Unit tests for the component in
`tests/unit/searchableSupplierSelector.test.tsx`:

1. A staged new name shows in the trigger with the `(new)` suffix when
   `showNewIndicator` is true.
2. A staged new name shows no `(new)` suffix when `showNewIndicator`
   is false.
3. A selected existing supplier shows its name.
4. An unmatched UUID value shows the placeholder.
5. The `'new_supplier'` sentinel with `pendingNewName` shows that name.
6. An empty value shows the placeholder.
7. A space-only value shows the placeholder.
8. The staged-name span carries the `text-primary` class.
9. With a staged name, the clear button renders. A click calls
   `onValueChange('', false)`.

Follow the render convention from
`tests/unit/SearchableAccountSelector.ariaLabel.test.tsx`: plain
`render` and `screen.getByRole('combobox')` with no provider wrapper.

This is a display-only change inside one component. No route, RPC, or
record flow changes. E2E coverage is not applicable; the unit tests
cover the full behavior surface.
