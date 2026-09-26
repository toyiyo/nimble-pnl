# Roles & Areas E2E flake: "grant Invoices without granting Banking"

## Symptom

`tests/e2e/roles-and-areas.spec.ts` ("an owner can grant Invoices without
granting Banking") failed about 50% of runs. The Banks `toBeChecked()` step
failed with "element(s) not found". The failure snapshot showed the roles list
and no open editor. CI passed only through `retries: 2`.

## Root cause

The test waited on the wrong element after the save click.

- The editor stays open until the save mutation resolves. `handleSave` awaits
  `createRole`, then calls `onBack()` (`src/components/roles/RoleEditor.tsx:499-527`).
- The editor preview panel shows the sentence "Invoices only can create, send
  and void invoices." (`RolePreviewPanel`, `roleName` prop at
  `src/components/roles/RoleEditor.tsx:803`).
- `page.getByText('Invoices only')` is a substring match. It matched that
  sentence in the open editor, so the "saved" wait passed at once.
- The "reopen" click hit the same sentence. That click does nothing. The
  Invoices radio step then passed on the unsaved draft.
- The mutation resolved, `onBack()` showed the list, and the Banks radiogroup
  was gone.

A probe spec (6 runs) showed the match inside the `<aside>` preview in all 6
runs. The editor was still open in 4 of 6 runs.

The app behavior is correct. The defect is in the test locator.

## Fix

Wait on the role card, `getByRole('article', { name: 'Invoices only' })`. The
sibling test uses the same locator (`tests/e2e/roles-and-areas.spec.ts:248`).
The card exists only on the list, so the wait now proves that the save
completed. Click the card's name button to reopen, and check that the
role-name input shows the saved name before the radio assertions.

No retry, no timeout, no skip.

## Evidence

- Before: `--repeat-each=10` gave 5 failed, 5 passed on local Supabase.
- After: `--repeat-each=10` gave 10 passed, two times. The full spec file
  passed (2 of 2).
