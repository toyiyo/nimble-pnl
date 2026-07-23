# Plan: Bank re-authentication flow

**Spec:** `docs/superpowers/specs/2026-07-23-bank-reauth-flow-design.md`
**Branch:** `feature/bank-reauth-flow`

Each task is TDD: RED (failing test) → GREEN (minimal code) → REFACTOR → COMMIT.

Ordering rationale: schema first (everything else reads the new columns), then the
pure helpers that are unit-testable without a Deno or React harness, then the edge
functions, then the frontend, then the worker. The frontend read-path widening
(Task 8) and the webhook write path (Task 5) must both land before the branch is
coherent — a `requires_reauth` written without Task 8 makes the bank vanish from
`/banking`.

---

## Task 0 — Pre-flight (no commit)

Before writing Task 1's migration, run a **read-only** prod SELECT for rows that
would violate the new partial unique index:

```sql
SELECT cb.restaurant_id, cb.institution_name, b.account_mask, count(*)
FROM connected_banks cb
JOIN bank_account_balances b ON b.connected_bank_id = cb.id
WHERE cb.status::text <> 'disconnected' AND b.account_mask IS NOT NULL
GROUP BY 1,2,3 HAVING count(*) > 1;
```

The Phase 2.5 review already ran this and found zero collisions. Re-confirm — the
index is `CREATE UNIQUE`, and a violation would fail the migration on deploy, not
in CI. If rows appear, widen the predicate and update the design before proceeding.

**Depends on:** nothing.

---

## Task 1 — Schema: `connected_banks` columns, backfill, indexes

`supabase/migrations/20260723130000_connected_banks_reauth_columns.sql`
`supabase/tests/bank_reauth_identity.sql`

RED — pgTAP:
1. `connected_banks` has `account_mask text`, `deactivated_at timestamptz`,
   `data_current_through date`.
2. `connected_banks_identity_uniq` exists and rejects a second live row with the
   same `(restaurant_id, institution_name, account_mask)`.
3. The index permits any number of `disconnected` rows on that same tuple.
4. Two rows with NULL `account_mask` at the same institution both insert (NULLs
   are distinct in a unique index) — this is the legacy/unknown-mask path.
5. `idx_bank_transactions_bank_date` exists.

GREEN — the migration per design §3.1: three `ADD COLUMN IF NOT EXISTS`, the
correlated `UPDATE … FROM bank_account_balances` mask backfill, the partial unique
index, the `bank_transactions` composite index.

`data_current_through` is `date`, not `timestamptz` — `bank_transactions` has no
`transacted_at` to take a `MAX()` over (design §3.1). Do not "improve" this.

**Depends on:** Task 0.

---

## Task 2 — Schema: `bank_reauth_notices` + notification type

`supabase/migrations/20260723130100_bank_reauth_notices.sql`
`supabase/tests/bank_reauth_notices.sql`

RED — pgTAP:
1. Table exists with the `stage` CHECK (`day_1`/`day_4`/`day_10`/`recovered`).
2. `bank_reauth_notices_once` blocks a duplicate `(connected_bank_id, stage,
   deactivated_at)`; a **different** `deactivated_at` inserts fine (a later outage
   re-notifies).
3. A restaurant member can `SELECT`; a non-member gets zero rows. This proves the
   GRANT **and** the policy — without the GRANT the query errors with
   `permission denied` before RLS runs, so a policy-only test passes vacuously.
4. `notification_channel_settings` accepts `bank_reauth_required` and still
   rejects a bogus key.

GREEN — table + RLS + `GRANT SELECT … TO authenticated` / `GRANT ALL … TO
service_role`; SELECT policy via `public.user_has_restaurant_access(restaurant_id)`
(do not hand-roll an inline `EXISTS` subquery); `DROP CONSTRAINT` /
`ADD CONSTRAINT` re-listing all 17 notification keys; update the stale
`COMMENT ON COLUMN` count from 15 to 17.

**Depends on:** Task 1 (FK to `connected_banks`).

---

## Task 3 — Notification type in all three copies

`supabase/functions/_shared/resolveChannels.ts`, `src/lib/notificationTypes.ts`,
`tests/unit/notificationTypes.test.ts`

RED — the existing sync test fails the moment one copy has the key and another
doesn't. Add the key to the `NOTIFICATION_TYPES` array first and watch it go red.

GREEN — add `'bank_reauth_required'` to both unions, add the `NOTIFICATION_TYPES`
row (`group: 'Banking'`, `channels: ['email', 'push']`), and extend
`NotificationGroup` with `'Banking'`.

Check whether the matrix UI (`NotificationChannelMatrix`) renders groups from a
hard-coded ordered list rather than deriving them — if so the new group needs
adding there too, and `tests/unit/NotificationChannelMatrix.test.tsx` will say so.

**Depends on:** Task 2 (CHECK constraint must accept the key first).

---

## Task 4 — Pure helpers: escalation stages + recipients

`supabase/functions/_shared/bankReauthStages.ts`, `tests/unit/bankReauthStages.test.ts`

RED:
1. Days elapsed is whole UTC days: exactly 1 → `day_1`; 3 → still `day_1`;
   exactly 4 → `day_4`; exactly 10 → `day_10`; 40 → `day_10` (no stage past 10).
2. 0 days → no stage (day 0 is in-app only).
3. Highest un-sent stage wins: a bank at day 6 with only `day_1` sent gets
   `day_4`, not a backfill of both.
4. Recipients per stage: day_1/day_4 → owners + managers; day_10 → owners only.
5. Channels per stage: day_10 is email-only (no push).

GREEN — a pure module exporting `stageForElapsedDays`, `nextStage(sentStages,
elapsed)`, and `recipientsForStage`. No Supabase client, no fetch — the
`_shared/resolveChannels.ts` and `_shared/availabilityReminderHandler.ts` pattern
of keeping logic directly unit-testable under vitest.

**Depends on:** nothing (pure).

---

## Task 5 — Webhook: `deactivated` / `reactivated` + identity-safe reconnect

`supabase/functions/stripe-financial-connections-webhook/index.ts`
`supabase/tests/bank_reauth_identity.sql` (extends Task 1's file)

RED — pgTAP against the SQL the handler will issue:
1. Simulated `deactivated` sets `status='requires_reauth'` and `deactivated_at`.
2. A **second** `deactivated` leaves `deactivated_at` unchanged (COALESCE) — the
   escalation clock must not reset on a redelivery.
3. `reactivated` restores `connected`, nulls `deactivated_at` and `sync_error`.
4. Three accounts at one institution with distinct masks reconnect to three
   distinct rows — no cross-graft. This is the bug the whole change exists for.
5. The conditional UPDATE will not steal a row already live on a different
   `stripe_financial_account_id`.
6. `ON CONFLICT … DO UPDATE` turns the concurrent-double-insert race into an
   update rather than a `23505`.

GREEN — the two new `case` branches (matching on `stripe_financial_account_id`,
as the existing `disconnected` branch already does) and the §4.2 two-step
match. State is derived from the Stripe event type plus the persisted row, never
from the request body.

The `ON CONFLICT` inference clause must repeat the partial index predicate
verbatim or Postgres won't match it to the index.

**Depends on:** Task 1.

---

## Task 6 — `stripe-sync-transactions`: stop lying, stop starving

`supabase/functions/stripe-sync-transactions/index.ts`

RED — extract the per-account decision into a pure `_shared/` helper so it is
unit-testable, then test:
1. `account.status !== 'active'` → `needs_reauth`, no fetch, no `last_sync_at`.
2. `transaction_refresh.status === 'failed'` → error result, `last_sync_at`
   untouched, `sync_error` set.
3. A mix of one unsubscribed and two subscribed accounts returns real counts for
   the two subscribed ones — today's bank-wide `needsSubscriptionSetup` early
   return discards them (design §5b).
4. A successful run sets `data_current_through` to `MAX(transaction_date)`.

GREEN — the four changes in §4.3, and the per-account response shape. Keep the
existing tombstone filter, rules application and reconciliation calls untouched.

**Depends on:** Task 1.

---

## Task 7 — `stripe-refresh-balance` + `refreshed_balance` branch use Stripe's `as_of`

`supabase/functions/stripe-refresh-balance/index.ts`,
`supabase/functions/stripe-financial-connections-webhook/index.ts`

RED: given a Stripe balance carrying `as_of`, the persisted `as_of_date` equals
that instant. Given a balance with no `as_of`, the existing `as_of_date` is left
**unchanged** — never overwritten with `now()`.

GREEN — replace both `new Date().toISOString()` writes.

**Depends on:** nothing.

---

## Task 8 — Frontend read path + per-account status

`src/utils/financialConnections.ts`, `src/hooks/useStripeFinancialConnections.tsx`,
`src/pages/Expenses.tsx`, `tests/unit/financialConnections.groupBanks.test.ts`

RED:
1. `groupBanks` stamps `bankStatus` and `dataCurrentThrough` onto every balance.
2. An institution with 1 of 3 accounts quarantined yields `reauthBankIds.length
   === 1` and `healthyBankIds.length === 2`.
3. `computeTotalBalance` excludes quarantined accounts; `quarantinedBalance`
   reports them separately; the two sum to the old unfiltered total.
4. `STATUS_PRIORITY` worst-of roll-up still drives the group's headline status.

GREEN — the type and `groupBanks` changes in §5.1.1, the total filters in §5.1.2,
the hook's `.in('status', [...])` widening plus the three new selected columns, and
replacing `Expenses.tsx`'s inline unfiltered `totalBalance` (line ~34) with the
shared helper.

`useConnectedBanks.tsx` is deliberately **not** touched (design §5.1.3).

**Depends on:** Task 1 (columns must exist for the select).

---

## Task 9 — `<FreshnessStamp>`

`src/components/banking/FreshnessStamp.tsx`, `tests/unit/freshnessStamp.test.tsx`

RED: fresh (<3 days) renders `Data through <date>` muted; stale (≥3) renders the
`· N days behind` suffix in amber; `null` renders `Not yet verified` and no date;
day math is whole UTC days and stable across clock times within a day.

GREEN — the component. `text-[13px] text-muted-foreground`, `tabular-nums`, no
direct colors.

**Depends on:** nothing.

---

## Task 10 — `<BankReauthBanner>`

`src/components/banking/BankReauthBanner.tsx`, `tests/unit/bankReauthBanner.test.tsx`

RED: returns `null` while loading; `null` when nothing is quarantined; renders the
institution, mask and stop-date with a Reconnect CTA when one is; renders the
destructive variant carrying `sync_error` for an `error` bank; has `role="status"`;
the status word "Needs reauthorization" is present (never colour-only).

GREEN — the component per §5.2, `flex-col sm:flex-row` with a truncating
institution name.

**Depends on:** Task 8 (consumes `reauthBankIds`).

---

## Task 11 — `BankConnectionCard` rework + delete `BankConnectionStatus`

`src/components/BankConnectionCard.tsx`,
delete `src/components/banking/BankConnectionStatus.tsx`

RED (component tests): with 1 of 3 accounts quarantined, the top-level Sync and
Refresh entries are present and operate on the 2 healthy IDs; with all quarantined
they are **absent**, not disabled; Reconnect appears and targets a single
`connected_bank_id`; the quarantined balance row carries the `Historical` chip.

GREEN — the §5.3 changes, `onReconnect` prop, `<FreshnessStamp>` replacing the
`Synced <date>` text, and the historical-row treatment (muted token + hatch
texture + chip — **not** an opacity drop on the figure; that fails WCAG 1.4.3).

Delete `BankConnectionStatus.tsx`. Verify zero imports first
(`grep -rn "BankConnectionStatus" src/`) — the Phase 2.5 review found none, but
confirm rather than trust.

**Depends on:** Tasks 8, 9.

---

## Task 12 — Sync toast honesty + banner placement + reconnect wiring

`src/hooks/useSyncBankTransactions.tsx`, `src/pages/Banking.tsx`,
`src/pages/Accounting.tsx`, `src/pages/Expenses.tsx`,
`tests/unit/useSyncBankTransactions.test.ts`

RED: `needsReauth` non-empty → destructive toast naming the bank; `synced === 0`
→ neutral "No new transactions", not "Sync complete"; `synced > 0` → count in the
message; **both** `['connectedBanks']` and `['connected-banks']` are invalidated.

GREEN — the toast branching, the dual invalidation, `handleConnectBank` gaining
its optional `connectedBankId` and being threaded down as `onReconnect`, and
`<BankReauthBanner>` added to Accounting and Expenses.

**Depends on:** Tasks 10, 11.

---

## Task 13 — Relink session

`supabase/functions/stripe-financial-connections-session/index.ts`

RED: with `connectedBankId` in the body the session is created with
`relink_options.authorization` and the response carries `mode: 'relink'`; when
Stripe rejects `relink_options` (private beta) it falls back to a normal session
with `mode: 'link'` rather than erroring; without `connectedBankId` behaviour is
byte-identical to today.

GREEN — §4.5. Reuse the existing owner/manager gate unchanged; scope the bank
lookup to the already-authorised `restaurantId`.

The fallback is safe precisely because Task 5's identity matching lands a fresh
`fca_` on the correct row by `(institution, last4)`.

**Depends on:** Tasks 1, 5.

---

## Task 14 — `bank-reauth-notices` worker + cron

`supabase/functions/bank-reauth-notices/index.ts`,
`supabase/migrations/20260723130200_schedule_bank_reauth_notices.sql`

RED (pgTAP, extending Task 2's file): the cohort-B recovery query finds a
reconnected bank via `bank_reauth_notices` **after** `connected_banks.deactivated_at`
has been nulled by the webhook — the correlation key lives in the notices table,
not on the bank row.

GREEN — the worker over both cohorts (§4.6), `resolveChannels` gating per channel,
`INSERT … ON CONFLICT DO NOTHING` on the dedupe row, emails through the shared
`EmailTemplateData` template. Cron migration modelled on
`20260507120300_schedule_trial_expiry_emails.sql`: `pg_cron` + `pg_net`, the
`cron.unschedule`-in-a-`DO`-block idempotency guard, the same
`app.settings.supabase_url` / `app.settings.service_role_key` GUCs, `0 9 * * *`.

Any helper RPC added here pins `SET search_path = public, pg_temp`.

**Depends on:** Tasks 2, 3, 4.

---

## Verification gates

`npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:db`.

`node_modules` does not come with a fresh worktree — install before the test run.

Every new executable line needs real coverage: SonarCloud's 80% new-code gate
fails on a single uncovered line, and source-text assertions do not count.

Before pushing: `grep -niE` PII sweep across the full branch diff **and** every
commit message. No production institution names, masks, balances, or tenant names.
