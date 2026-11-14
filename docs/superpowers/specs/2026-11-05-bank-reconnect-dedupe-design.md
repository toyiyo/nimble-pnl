# Bank reconnect dedupe: design

Date: 2026-11-05
Branch: `fix/bank-reconnect-dedupe`
Scope: `supabase/functions/stripe-sync-transactions`, one new `_shared` module, unit tests.
No migration. No UI change.

## 1. Problem

Wetzel's - Cold Stone - Alamo Ranch shows double bank lines. Production has
1,309 exact pairs in 5,771 rows. The pairs add 284,814.06 of false inflow and
-263,948.42 of false outflow.

Stripe Financial Connections changes transaction IDs in two cases:

- A reconnect gives a new `fca_` account ID and new `fctxn_` IDs for the same
  history. See the comment at
  `supabase/functions/stripe-verify-connection-session/index.ts:105-145`.
- Stripe can also give new `fctxn_` IDs on the same `fca_`. Huntington 2589 got
  23 rows of this type on 2026-07-31. The cause is not known.

The sync treats a new ID as a new transaction:

- `supabase/functions/stripe-sync-transactions/index.ts:191-213` lists the full
  history of the current account, with no date limit.
- `index.ts:249-258` checks only `stripe_transaction_id`.
- `index.ts:260-264` checks only the tombstone of that same ID.
- `index.ts:272-288` inserts all other transactions.

`reconnect_connected_bank`
(`supabase/migrations/20260723130150_reconnect_bank_identity_safe.sql`) keeps the
`connected_banks` row. Thus old and new copies have one `connected_bank_id`.

## 2. Goals and non-goals

Goals:

1. A reissued Stripe ID updates the existing row. It does not add a second row.
2. The existing row keeps its category, splits, links, and notes.
3. Two real identical transactions stay as two rows.
4. A row that the user deleted does not come back with a reissued ID.

Non-goals:

- Delete the duplicates that exist now. A separate cleanup plan covers this.
- Update the status of existing rows when the ID does not change. The 90
  `pending` rows on Mercury 7138 are a separate problem.
- Match rows across two `connected_banks` rows. A disconnect and a fresh connect
  is not covered.
- Match rows when Stripe changes `transacted_at`, `amount`, or `description`
  together with the ID. Those rows still insert. The measured pairs are exact on
  these three fields.
- Match rows that `restore_deleted_transaction` created. These rows have no
  `raw_data` (`supabase/migrations/20260820120000_bank_delete_rpcs_membership_guard.sql:285`).
- Fix the limit of one tombstone for two identical deleted rows. The unique
  `(restaurant_id, fingerprint)` index causes it, and it exists today.

## 3. Design

### 3.1 Rule

A new Stripe transaction re-keys an existing row only if all of these are true:

- The row has the same `connected_bank_id`.
- The row has the same Stripe `transacted_at`, `amount`, and `description`.
- The `stripe_transaction_id` of the row is not in the current Stripe list. We
  call this row an orphan.
- No other new transaction took this row. The pairing is 1:1.

The orphan condition protects real identical transactions. If two identical
charges exist, Stripe lists both IDs. Neither row is an orphan, so a third
identical charge inserts as a new row.

| Orphans | New transactions | Result |
|---|---|---|
| 1 | 1 | 1 re-key |
| 2 | 2 | 2 re-keys |
| 1 | 2 | 1 re-key, 1 insert |
| 2 | 1 | 1 re-key, 1 orphan stays |
| 0 | 1 | 1 insert |

The sync never deletes a row. An orphan with no match stays. This is correct for
rows older than the Stripe history window.

### 3.2 Compare the Stripe values, not the row values

The key uses `raw_data`, because `raw_data` holds the Stripe object
(`index.ts:287`). A user change to `description` on the row does not break the
match. Rows with no `raw_data` have no key and never match. File imports are in
this group: they have a `csv_` or `manual_` ID
(`src/hooks/useBankStatementImport.tsx:450-456`) and no Stripe object.

The key is `JSON.stringify([transacted_at, amount, description])`, with
`transacted_at` and `amount` as numbers. The PostgREST `->>` operator returns
text, so the module changes these two values to numbers first.

### 3.3 New pure module

New file: `supabase/functions/_shared/bankTransactionRekey.ts`. It has no Stripe
client and no Supabase client, the same as
`supabase/functions/_shared/bankSyncAccountDecision.ts:1-6`. It exports:

- `BANK_ROW_MATCH_SELECT`: the projection string. It uses aliases, because
  `amount` and `description` are also real columns:
  `id, stripe_transaction_id, created_at, ta:raw_data->>transacted_at, amt:raw_data->>amount, descr:raw_data->>description`.
- `MAX_REKEYS_PER_RUN`: 500.
- `planTransactionStore(input)`: returns one decision for each Stripe
  transaction.

```ts
type StoreDecision =
  | { kind: 'skip_existing'; txn }
  | { kind: 'skip_tombstoned'; txn }
  | { kind: 'rekey_row'; txn; rowId; previousStripeId }
  | { kind: 'rekey_tombstone'; txn; tombstoneId }
  | { kind: 'defer_rekey'; txn }
  | { kind: 'insert'; txn };
```

Order of the checks for each transaction:

1. The ID is on a row: `skip_existing`.
2. The ID is on a tombstone: `skip_tombstoned`.
3. An unused orphan row has the same key: `rekey_row`.
4. An unused orphan tombstone has the same tombstone key: `rekey_tombstone`.
5. All others: `insert`.

Steps 3 and 4 share one limit of `MAX_REKEYS_PER_RUN`. After the limit, a match
becomes `defer_rekey`. The sync does not insert a deferred transaction, because an
insert makes a duplicate. The next run finds the same orphans and continues.

Orphan rows are used oldest first (`created_at`, then `id`). The result does not
depend on the order of the Stripe list for a group of identical transactions,
because the rows in a group have the same Stripe values.

### 3.4 Changes to the store step

In `index.ts`, replace lines 223-296:

1. Read the rows of the bank in pages of 1,000, with keyset paging:
   `.eq("restaurant_id", ...).eq("connected_bank_id", bankId).gt("id", lastId).order("id").limit(1000)`.
   Keyset paging does not skip a row when a concurrent insert occurs.
   A page loop is necessary, because `max_rows = 1000` (`supabase/config.toml:9`).
2. Read the tombstones of the restaurant in pages of 1,000.
3. Call `planTransactionStore`.
4. Do each decision, re-keys first:
   - `rekey_row`: update `stripe_transaction_id`, `raw_data`, `status`, and
     `posted_date`, with
     `.eq("id", rowId).eq("restaurant_id", ...).eq("stripe_transaction_id", previousStripeId).select("id")`.
     The ID filter makes a concurrent sync a no-op. Count a re-key only if the
     update returns one row. Keep a `status` of `reconciled`, because that value
     is ours and not Stripe's (`supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:41`).
     Treat error `23505` as a skip: `stripe_transaction_id` is unique across all
     banks (same file, line 112), and the read covers one bank.
   - `rekey_tombstone`: update `external_transaction_id`.
   - `insert`: the current insert, without change.
5. Treat insert error `23505` as a skip. A row of a different bank can hold the
   ID. The current code skips this case at `index.ts:249-258`, because that
   lookup has no bank filter.

This removes one query for each transaction (`index.ts:249-253`). A sync of
3,000 transactions now uses about 3 read requests, not 3,000. This helps the
~10s CPU limit.

It also removes the `.in("external_transaction_id", allStripeIds)` read at
`index.ts:228-232`. That read puts all IDs in the URL, and `index.ts:228` does not
read the `error` value. A long history can fail with no message, and tombstones
are then not applied.

A failed page read stops the store step for this run. The code logs the error and
does no insert. If the code continued with part of the rows, known IDs would look
new and the sync would add duplicates.

### 3.5 Incomplete Stripe list

`index.ts:214-216` catches a fetch error and keeps the pages it has. With a part
of the list, a good row looks like an orphan. The store step must not run on that
data. The fix sets `fetchComplete = false` in that catch block. When it is false,
the store step does nothing for this run and logs the reason. The next sync gets
the full list. This changes one behavior: the rows of a partial fetch now wait for
the next sync.

Today the account continues to `pendingFetchAccounts` (`index.ts:218`) after the
catch. `resultForRefresh` then returns `ok`, `shouldStampLastSyncAt` returns true,
and `index.ts:338` clears `sync_error`
(`supabase/functions/_shared/bankSyncAccountDecision.ts:62-90`). With a skipped
store step, the UI must not show a good sync. The fix adds
`resultForFetchFailed(accountId)` to that module. It returns status
`refresh_failed` with a fetch error message. The catch block pushes this result
and does not add the account to `pendingFetchAccounts`. The existing code then
writes `sync_error` and does not stamp `last_sync_at`.

### 3.6 Tombstones

`deleted_bank_transactions` has no Stripe timestamp. It has `transaction_date`
(DATE), `amount`, and `description`
(`supabase/migrations/20260301000000_add_deleted_bank_transactions_tombstone.sql:29-45`).
The delete functions do not fill `raw`
(`supabase/migrations/20260820120000_bank_delete_rpcs_membership_guard.sql:59-85`).

The tombstone key is the UTC date of `transacted_at`, the amount in cents, and
the normalized description. The normalization is the same as
`compute_transaction_fingerprint`: lowercase, trim, and delete all characters
except `a-z`, `0-9`, and space
(`supabase/migrations/20260301000000_add_deleted_bank_transactions_tombstone.sql:15-19`).
The date rule is correct because the database session timezone is UTC. A tombstone is an orphan if its `external_transaction_id` is not
in the Stripe list. Only `source = 'bank_integration'` tombstones of this
`connected_bank_id` with a `fctxn_` ID can match.

The tombstone key has less detail than the row key. The 1:1 rule limits the
effect: one tombstone stops one transaction.

The update of `external_transaction_id` keeps restore correct. Restore uses that
ID as the `stripe_transaction_id` of the new row
(`supabase/migrations/20260820120000_bank_delete_rpcs_membership_guard.sql:274-285`).

### 3.7 Triggers

The update does not change `description`, `amount`, or `supplier_id`. Thus
`reset_bank_transactions_rules_evaluated_at` does not reset the rule state
(`supabase/migrations/20260804090000_rules_evaluated_at_columns.sql:55-67`).
`update_bank_transactions_updated_at` sets `updated_at` only
(`supabase/migrations/20251018183326_5da7500b-3a17-4a58-af24-d2175258f871.sql:461`).
No other trigger acts on an update of this table. The closed-period check is in the
categorize functions, not on the table
(`supabase/migrations/20260819231210_add_bulk_categorize_bank_transactions.sql:175`).

### 3.8 Other uses of the ID

SQL functions use `stripe_transaction_id` in the text of `entry_number`
(`'BANK-' || stripe_transaction_id || ...`, for example
`supabase/migrations/20260819231210_add_bulk_categorize_bank_transactions.sql:239`).
This value is a label with a timestamp. An old label keeps the old ID after a
re-key. Nothing reads the ID back out of the label.

### 3.9 Counts and response

- `syncedCount` counts inserts only. The rule step at `index.ts:376` runs only
  for new rows. A re-key does not start it.
- Add `rekeyedCount` and `deferredCount`. Add them to the log line at
  `index.ts:373` and to the JSON response.

## 4. State before the cleanup

The fix is safe on Alamo Ranch before the cleanup. Each pair has an old row and a
new row. The new row has the current ID, so `skip_existing` applies. The old row
is an orphan, but no new transaction wants it. The sync makes no change to these
rows.

## 5. Tests

`tests/unit/bankTransactionRekey.test.ts`, with Vitest:

- Each row of the table in section 3.1.
- Two real identical transactions stay two rows.
- `fca_` rotation and a reissue on the same `fca_`.
- A user change to the row `description` still matches.
- Text and number forms of `amount` and `transacted_at` match.
- A row with no `raw_data` never matches. A `csv_` row never matches.
- A null `description` matches a null `description`.
- Tombstone: an ID hit, a reissued ID, a 1:1 limit, a wrong bank, a non-`fctxn_` ID.
- A row match comes before a tombstone match.
- The oldest orphan is used first.
- The limit: match 501 gives `defer_rekey`, not `insert`. Row and tombstone
  re-keys share the limit.
- A tombstone with a `23:30Z` instant keys on the UTC date.
- Tombstone description normalization.
- `resultForFetchFailed` gives `refresh_failed`, and `shouldStampLastSyncAt` is false.
- `BANK_ROW_MATCH_SELECT` has the expected fields.

Also run `deno check supabase/functions/stripe-sync-transactions/index.ts`,
because `tsc` does not check edge functions.

E2E gate: Justified exception. There is no UI change, and the path needs live
Stripe Financial Connections data. No SQL changes, so no pgTAP test is necessary.

## 6. Risks

| Risk | Control |
|---|---|
| A wrong re-key joins two real transactions | The row must be an orphan, and all three Stripe fields must be equal. The sync deletes nothing. |
| A partial Stripe list makes false orphans | The store step does not run (section 3.5). |
| A partial row read makes false new IDs | The store step stops (section 3.4). |
| Two syncs run at the same time | The update filters on the previous ID. The unique key stops a double insert. |
| A rotation takes too long | One update takes about 30-60 ms. `MAX_REKEYS_PER_RUN` limits a run to about 30 s of updates. The rest waits for the next run and adds no duplicate. |
| A cold account gives a fetch error | The bank shows `sync_error` until the next good sync. A wrong warning is safer than a false good sync. |
