# Receipt images storage RLS: delete the permissive policies

Date: 2026-10-26
Severity: high (security audit, fix 3 of 7)

## Problem

Any signed-in user can read, replace or delete the receipts of any restaurant.

The `receipt-images` bucket is private
(`supabase/migrations/20250928000424_e694f874-8211-4ce1-b75c-d1378f1edf57.sql:2-6`).
But 4 permissive policies on `storage.objects` check only that the user is
signed in
(`supabase/migrations/20250927214536_f9d9e0f9-0f8d-4ffb-93c9-f2667b19b4e9.sql:9-43`):

| Policy | Command | Condition |
|---|---|---|
| "Allow authenticated users to upload receipt images" | INSERT | `bucket_id = 'receipt-images' AND auth.uid() IS NOT NULL` |
| "Allow authenticated users to view their receipt images" | SELECT | same |
| "Allow authenticated users to update their receipt images" | UPDATE | same |
| "Allow authenticated users to delete their receipt images" | DELETE | same |

Postgres ORs permissive policies for the same command. Thus these 4 policies
cancel the folder policies that check `user_restaurants`
(`20250928000424_...sql:21-77`). The production check confirms that all 4
policies are live.

Note: the task brief names the INSERT policy "Allow authenticated users to
upload their receipt images". The migration creates it as "Allow authenticated
users to upload receipt images" (`20250927214536_...sql:9`). The fix deletes
both names, so the result is correct for either name.

## Current callers (all paths)

Each upload path starts with the restaurant id folder:

| Caller | Path | Line |
|---|---|---|
| `useReceiptImport` | `${restaurant_id}/${finalFileName}` | `src/hooks/useReceiptImport.tsx:223` |
| `useBankStatementImport` | `${restaurant_id}/bank-statements/${finalFileName}` | `src/hooks/useBankStatementImport.tsx:128` |
| `useExpenseInvoiceUpload` | `${restaurant_id}/expense-invoices/${finalFileName}` | `src/hooks/useExpenseInvoiceUpload.tsx:77` |
| `useAttachments` (upload) | `${restaurantId}/expense-invoices/${finalFileName}` | `src/hooks/useAttachments.ts:203` |

Each read or delete uses the stored `raw_file_url`, which is the upload path:

- `createSignedUrl`: `src/hooks/useReceiptImport.tsx:298`,
  `src/hooks/useBankStatementImport.tsx:196`,
  `src/hooks/useExpenseInvoiceUpload.tsx:149`,
  `src/hooks/useAttachments.ts:124`, `src/hooks/useAttachments.ts:247`.
- `download`: `src/hooks/useAttachments.ts:334`,
  `src/components/attachments/AttachmentViewer.tsx:64,119,162`.
- `remove`: `src/hooks/useAttachments.ts:299`.

`supabase/functions/proxy-receipt-file/index.ts:83-86` downloads with a
service-role client. RLS does not apply to it, so the fix does not change it.

No caller in `src/` or `supabase/functions/` writes a path that does not start
with the restaurant id. The policy change does not need a caller change.

## Role gap in the folder policies

The folder INSERT and UPDATE policies allow `owner`, `manager` and `chef`
(`20250928000424_...sql:31,60`). The folder DELETE policy allows `owner` and
`manager` (`20250928000424_...sql:75`). The folder SELECT policy allows every
member (`20250928000424_...sql:41-46`).

The table policies for the rows that point at these files:

| Table | INSERT roles | Source |
|---|---|---|
| `receipt_imports` | owner, manager, operations_manager, collaborator_operations_manager | `supabase/migrations/20260723120000_add_collaborator_operations_manager_role.sql:720-731` |
| `bank_statement_uploads` | owner, manager | `supabase/migrations/20251118100000_add_bank_statement_uploads.sql:74-81` |
| `expense_invoice_uploads` | owner, manager | `supabase/migrations/20260115000000_add_expense_invoice_uploads.sql:41-48` |

`operations_manager` and `collaborator_operations_manager` can create a
`receipt_imports` row. Today the permissive INSERT policy lets them upload the
file. After the delete, the folder INSERT policy blocks them. The receipt
upload flow uploads the file before it writes the row
(`src/hooks/useReceiptImport.tsx:225-240`), so these users cannot import a
receipt.

## Design

One new migration, `supabase/migrations/20261026120300_receipt_images_storage_rls.sql`:

1. `DROP POLICY IF EXISTS` for the 4 permissive policies. Also drop the name
   from the task brief ("Allow authenticated users to upload their receipt
   images").
2. Recreate the folder INSERT and UPDATE policies. Copy the body from
   `20250928000424_...sql:21-62` without change, and add
   `operations_manager` and `collaborator_operations_manager` to the role
   array. This keeps receipt import open for every role that
   `receipt_imports` admits.
3. Do not change the folder SELECT and DELETE policies.
4. Do not change other buckets.

### Rejected approaches

- **Delete the 4 policies only.** This breaks receipt import for 2 roles that
  can use it today.
- **Change the folder policies to `user_has_capability()`.** This is a larger
  change. The table policies still compare `user_restaurants.role`, so storage
  and table checks would not agree.

## Risk

- Objects whose first folder is not a restaurant id become unreadable for app
  users. An early migration used `auth.uid()` as the first folder
  (`supabase/migrations/20250927204537_9b1632c6-d265-4043-99b6-688f9d715ace.sql:7-29`)
  for one day. No current caller writes such a path. The receipt proxy uses
  the service role, so it can still read such a file. This fix does not query
  production. The PR body asks the owner to count such objects before the
  deploy.
- A `staff` or `kiosk` member still can read the receipts of its own
  restaurant through the folder SELECT policy. This does not change.

## Tests

`supabase/tests/receipt_images_storage_rls.test.sql` (pgTAP), as the
`authenticated` role with JWT claims:

- User A (owner of restaurant A) cannot select, update or delete an object in
  the folder of restaurant B. User A cannot upload into the folder of
  restaurant B.
- User A can read and upload in its own folder.
- An `operations_manager` of restaurant A can upload in the folder of
  restaurant A.
- The 4 permissive policies do not exist.

## TLA+

No `run-tla` trigger matches. The change has no concurrent writer, cursor,
retry or state machine.
