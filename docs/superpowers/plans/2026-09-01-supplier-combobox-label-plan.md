# Plan: show the staged new-supplier name in the supplier combobox

Design doc: docs/superpowers/specs/2026-09-01-supplier-combobox-label-design.md
Branch: `fix/supplier-combobox-label`

## Scope

One component changes:
`src/components/SearchableSupplierSelector.tsx`.
One test file is new:
`tests/unit/searchableSupplierSelector.test.tsx`.
No parent component changes. No database changes.

## Step 1: write the failing tests (TDD red)

Create `tests/unit/searchableSupplierSelector.test.tsx`. Follow the
render convention from
`tests/unit/SearchableAccountSelector.ariaLabel.test.tsx`: plain
`render` from `@testing-library/react`, no provider wrapper.

Render `SearchableSupplierSelector` with a small `suppliers` fixture.
Write the nine tests from the design doc:

1. `value="Acme Meats"`, `showNewIndicator` — the trigger shows
   `Acme Meats` and the ` (new)` suffix.
2. `value="Acme Meats"`, no `showNewIndicator` — no `(new)` suffix.
3. `value` set to a fixture supplier id — the trigger shows the
   supplier name.
4. `value` set to a UUID not in the fixture — the trigger shows the
   placeholder.
5. `value="new_supplier"`, `pendingNewName="OCR Vendor"` — the trigger
   shows `OCR Vendor`.
6. `value=""` — the trigger shows the placeholder.
7. `value="   "` — the trigger shows the placeholder.
8. The staged-name span has the `text-primary` class.
9. With `value="Acme Meats"`, the `Clear supplier` button renders.
   A click calls `onValueChange('', false)`.

Run `npx vitest run tests/unit/searchableSupplierSelector.test.tsx`.
Tests 1, 2, 7, 8 must fail. Tests 3-6 and 9 must pass; they pin the
current behavior.

## Step 2: fix the component (TDD green)

Edit `src/components/SearchableSupplierSelector.tsx`:

1. Below the `selectedSupplier` line (now line 64), add:
   ```ts
   const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
   const isStagedNewName =
     !!value?.trim() && value !== 'new_supplier' && !selectedSupplier && !UUID_RE.test(value);
   ```
   Move `UUID_RE` above the component body; it is a constant.
2. In `getDisplayValue` (lines 67-74), add before the final return:
   `if (isStagedNewName) return value;`.
3. In the trigger span (lines 101-109):
   - Change the style condition to
     `(value === 'new_supplier' || isStagedNewName) && "text-primary font-medium"`.
     This replaces `text-blue-600` on this span.
   - Change the indicator condition to
     `showNewIndicator && (value === 'new_supplier' || isStagedNewName)`.
   - Put a literal space before `(new)` so the accessible name keeps
     a word break.

Do not change the dropdown row class at line 136. Do not change the
clear button condition at line 183.

Run the test file again. All nine tests must pass.

## Step 3: verify

```
npm run typecheck
npm run lint
npx vitest run
```

All must pass.

## Step 4: ship

Commit `src/components/SearchableSupplierSelector.tsx` and
`tests/unit/searchableSupplierSelector.test.tsx` with explicit paths.
Push the branch. Open a PR against `main`.

## E2E statement

E2E coverage is not applicable. The change is display logic inside one
component. The nine unit tests cover the full behavior surface. No
route or data flow changes.
