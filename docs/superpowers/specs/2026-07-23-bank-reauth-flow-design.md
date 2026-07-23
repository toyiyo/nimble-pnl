# Bank re-authentication flow — design

**Date:** 2026-07-23
**Branch:** `feature/bank-reauth-flow`
**Status:** Design (Phase 2)

> All account identifiers, institution names, balances and last-4s in this document are
> **fictional placeholders** (e.g. `Northgate Savings & Trust`, `••4402`). No production
> customer data appears here, per the 2026-07-07 PII lesson.

---

## 1. Problem

Stripe Financial Connections silently drops a bank authorization. Stripe emits
`financial_connections.account.deactivated`, transactions stop flowing, and **every surface
in the product keeps claiming the data is fresh**. A tenant can go weeks believing their P&L
is current when the last real transaction landed a month ago.

Three separate mechanisms manufacture that false freshness:

| # | Mechanism | Location |
|---|-----------|----------|
| 1 | `last_sync_at` is stamped unconditionally after a sync run, even when the refresh failed or fetched nothing | `stripe-sync-transactions/index.ts` (end of handler) |
| 2 | The sync toast says "Sync complete" for `synced: 0` | `src/hooks/useSyncBankTransactions.tsx` |
| 3 | `as_of_date` is set to `new Date()` rather than Stripe's `balance.as_of` | `stripe-refresh-balance`, `refreshed_balance` webhook branch |

And two structural defects make recovery unsafe:

| # | Defect | Location |
|---|--------|----------|
| 4 | `deactivated` / `reactivated` have **no webhook branch** — they fall through to `default:`, which only records the event in `stripe_events`. `connected_banks` is never touched. | `stripe-financial-connections-webhook/index.ts` |
| 5 | On reconnect, `account.created` claims *any* `disconnected` row at the same `institution_name`. With N accounts at one bank all sharing that name, which row gets claimed is arbitrary and racy (N webhooks arrive within seconds). | same file, `account.created` branch |

Defect 5 is the dangerous one: it can graft account A's transaction history onto account B's
row, silently and irreversibly. A tenant with three accounts at one institution is a coin flip
away from a corrupted ledger on every reconnect.

### Two further findings surfaced while reading the code

**5a. `requires_reauth` would make the bank vanish.** `useStripeFinancialConnections`'s
`connectedBanks` query hard-filters `.eq('status', 'connected')`. Writing `requires_reauth`
without widening that filter removes the bank from `/banking` entirely — the exact opposite
of the designed experience. The status enum already contains `requires_reauth`
(`bank_connection_status_enum`), so no enum migration is needed, but the read path must widen
in the *same* change that starts writing the value.

**5b. Mixed-subscription early return.** In `stripe-sync-transactions`, an account not yet
subscribed to the `transactions` feature sets `needsSubscriptionSetup = true`; after the loop
the handler returns early with `synced: 0` **for the whole bank**. Sibling accounts that *were*
subscribed and *did* fetch rows get their work discarded from the response and the user is told
nothing synced. One cold account starves the warm ones.

---

## 2. Goals / non-goals

**Goals**

1. Never display a fetch timestamp as if it were a data timestamp.
2. Never offer a control that cannot work.
3. Detect a dropped authorization within one webhook, and escalate on the tenant's clock.
4. Make reconnect account-identity-safe: never merge two real accounts into one row.
5. Recover through Stripe's **relink** path, not a fresh link, so history stays continuous.

**Non-goals**

- No manual Dashboard relink for any existing tenant as part of this change (explicitly
  deferred by the user).
- No change to transaction categorisation, rules, or reconciliation logic.
- No new notification *channel*. Email + push only, matching the existing matrix.
- Hosted relink API is private beta at Stripe; we design for it but ship behind a graceful
  fallback (§5.3).

---

## 3. Data model

### 3.1 `connected_banks` — three new columns

Migration `20260723130000_connected_banks_reauth_columns.sql`:

```sql
ALTER TABLE public.connected_banks
  ADD COLUMN IF NOT EXISTS account_mask text,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS data_current_through timestamptz;
```

| Column | Meaning | Written by |
|--------|---------|------------|
| `account_mask` | Stripe's `account.last4`. Already captured on the balances row; needed on the bank row to make reconnect matching identity-safe. | `account.created` branch; backfilled from `bank_account_balances` |
| `deactivated_at` | When Stripe told us the authorization died. Drives the escalation ladder. | `deactivated` branch |
| `data_current_through` | The newest `transacted_at` we actually hold for this bank. **This is what the UI prints** — never `last_sync_at`. | `stripe-sync-transactions` after a successful fetch |

Backfill in the same migration (safe, idempotent, no-op on empty tables):

```sql
UPDATE public.connected_banks cb
SET account_mask = b.account_mask
FROM public.bank_account_balances b
WHERE b.connected_bank_id = cb.id
  AND cb.account_mask IS NULL
  AND b.account_mask IS NOT NULL;
```

`data_current_through` is left NULL by the backfill on purpose: NULL means "we have never
proven freshness", and the UI renders that as "Not yet verified" rather than inventing a date.

**Partial unique index** enforcing account identity within a live connection:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS connected_banks_identity_uniq
  ON public.connected_banks (restaurant_id, institution_name, account_mask)
  WHERE status <> 'disconnected' AND account_mask IS NOT NULL;
```

This is the database-level guarantee behind §4.2. It cannot fire on legacy rows with a NULL
mask, and it permits any number of historical `disconnected` rows.

> **Pre-flight required in Phase 4:** run a read-only prod SELECT for existing violations of
> this index before writing the migration, and widen the predicate if real duplicates exist.

### 3.2 `bank_reauth_notices` — dedupe table

Migration `20260723130100_bank_reauth_notices.sql`, modelled directly on `trial_emails_sent`:

```sql
CREATE TABLE IF NOT EXISTS public.bank_reauth_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  connected_bank_id uuid NOT NULL REFERENCES public.connected_banks(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('day_1', 'day_4', 'day_10', 'recovered')),
  deactivated_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_reauth_notices_once
    UNIQUE (connected_bank_id, stage, deactivated_at)
);

ALTER TABLE public.bank_reauth_notices ENABLE ROW LEVEL SECURITY;
```

Including `deactivated_at` in the unique key is what makes a *second, later* outage re-notify
rather than being suppressed by the first outage's rows.

RLS: service-role writes only; a SELECT policy scoped to `restaurant_id` via the project's
existing membership helper, so support tooling can read it. No INSERT/UPDATE/DELETE policy for
authenticated users.

### 3.3 Notification type

New key `bank_reauth_required`, added to **all three** copies of the matrix (the vitest sync
test in `tests/unit/notificationTypes.test.ts` enforces this):

1. `supabase/functions/_shared/resolveChannels.ts` — union member
2. `src/lib/notificationTypes.ts` — union member **and** a `NOTIFICATION_TYPES` row
3. The `notification_channel_settings_type_check` CHECK constraint — via
   `ALTER TABLE ... DROP CONSTRAINT ... ; ADD CONSTRAINT ...` with the full re-listed set

`NotificationGroup` gains a fourth value, `'Banking'`:

```ts
{ key: 'bank_reauth_required', label: 'Bank needs reauthorization', group: 'Banking',
  channels: ['email', 'push'] }
```

The `COMMENT ON COLUMN` string in the original migration says "the 15 catalog keys" — update
it to 17 (16 existing + the new one) rather than leaving a stale count.

---

## 4. Backend

### 4.1 Webhook: handle `deactivated` / `reactivated`

`supabase/functions/stripe-financial-connections-webhook/index.ts`.

```
case "financial_connections.account.deactivated":
  UPDATE connected_banks
     SET status = 'requires_reauth',
         deactivated_at = COALESCE(deactivated_at, now()),
         sync_error = 'Your bank ended this connection. Reconnect to resume transactions.'
   WHERE stripe_financial_account_id = account.id
```

`COALESCE` keeps the *first* deactivation timestamp when Stripe re-sends — the escalation clock
must not reset on a duplicate delivery.

```
case "financial_connections.account.reactivated":
  UPDATE connected_banks
     SET status = 'connected', deactivated_at = NULL, sync_error = NULL
   WHERE stripe_financial_account_id = account.id
  → then trigger stripe-sync-transactions for that bank
```

Both match on `stripe_financial_account_id` — precise, exactly as the existing `disconnected`
branch already does. `stripe_events` idempotency is unchanged and still applies.

**Per the 2026-07-20 lesson**, the state written is derived from the Stripe event type plus the
persisted row, never from a client-supplied body.

### 4.2 Identity-safe reconnect matching

Replace the "any disconnected row at this institution" lookup with a two-step match:

**Step 1 — identity match.** Conditional UPDATE, guarded so it cannot steal a row that is
already live on a different Stripe account:

```sql
UPDATE connected_banks
   SET stripe_financial_account_id = :new_id,
       status = 'connected',
       connected_at = now(),
       disconnected_at = NULL,
       deactivated_at = NULL,
       sync_error = NULL,
       institution_logo_url = :logo
 WHERE restaurant_id = :rid
   AND institution_name = :inst
   AND account_mask = :last4
   AND status IN ('disconnected', 'requires_reauth', 'error')
   AND stripe_financial_account_id IS DISTINCT FROM :new_id
RETURNING id;
```

**Step 2 — no identity match ⇒ INSERT a new row.** Never fall back to claiming an arbitrary
row at the same institution. A brand-new account at a known bank is a new row; that is correct
and cheap. The old behaviour's failure mode (silently merging two accounts) is not.

Rows with a NULL `account_mask` (pre-backfill legacy, or a Stripe payload without `last4`)
match nothing in step 1 and therefore take the INSERT path. That is the safe direction: a
duplicate row is visible and repairable; a merged ledger is neither.

Because each webhook now targets a distinct `(institution, last4)` tuple, N accounts arriving
within seconds no longer race for the same row. The partial unique index (§3.1) is the backstop.

### 4.3 `stripe-sync-transactions` — stop lying, stop starving

Four changes:

1. **Read the status.** Inspect `account.status` after retrieve. If it is not `active`, write
   `requires_reauth` (and `deactivated_at` if unset) for that bank, skip the fetch, and include
   the account in a `needsReauth` array on the response.
2. **Inspect the refresh result.** `accounts.refresh(...)` returns
   `transaction_refresh.status`. Treat `failed` as a hard signal, not a swallowed error:
   surface it rather than continuing into a paginated list that will return nothing.
3. **Stamp truth, not intent.** Replace the unconditional
   `last_sync_at = now()` with:
   - `last_sync_at = now()` **only** when the refresh succeeded (it means "we successfully
     talked to Stripe", which is now honest), and
   - `data_current_through = max(transacted_at)` over the rows we actually hold for that bank,
     recomputed after insert. This is the value the UI prints.

   On a failed refresh neither is touched, and `sync_error` is set.
4. **Per-account subscription handling.** Delete the bank-wide `needsSubscriptionSetup` early
   return (§5b). Subscribe the cold account, record it in a per-account result entry, and let
   the already-subscribed siblings complete and report their real counts. The response becomes
   per-account:

   ```jsonc
   { "synced": 42,
     "accounts": [
       { "accountId": "fca_…", "synced": 42, "status": "ok" },
       { "accountId": "fca_…", "synced": 0,  "status": "subscribing" },
       { "accountId": "fca_…", "synced": 0,  "status": "needs_reauth" }
     ],
     "needsReauth": ["fca_…"] }
   ```

### 4.4 `stripe-refresh-balance` and the `refreshed_balance` branch

Both currently write `as_of_date: new Date().toISOString()`. Both must write Stripe's own
`balance.as_of` (a Unix timestamp on the account's `balance` object), falling back to leaving
the existing `as_of_date` **unchanged** when Stripe doesn't supply one. Never invent a date.

### 4.5 Relink session

`stripe-financial-connections-session/index.ts` gains an optional `connectedBankId` in the
request body. When present:

- Look up the bank (service-role, scoped to the same `restaurantId` already authorised by the
  existing `owner`/`manager` role gate — no widening of the gate).
- Create the session with `relink_options: { authorization: <authorization id> }` so Stripe
  repairs the *existing* authorization. The `fca_` account IDs survive, which means the
  `fctxn_` transaction IDs survive, which means the `stripe_transaction_id` UNIQUE constraint
  keeps doing its job and no history is duplicated.

**Fallback (§2 non-goal):** the hosted relink API is in private beta. If the
`relink_options` parameter is rejected by the API, catch that specific failure and fall back to
a normal session — §4.2's identity matching is precisely what makes that fallback survivable,
because a fresh link with new `fca_`/`fctxn_` IDs will land on the correct row by
`(institution, last4)` rather than an arbitrary one. The design is correct whether or not
relink is available to this account.

Response gains `mode: 'relink' | 'link'` so the UI can word the dialog accurately.

### 4.6 `bank-reauth-notices` worker + cron

New edge function `supabase/functions/bank-reauth-notices/`, modelled on
`trial-expiry-emails`. Daily at 09:00 UTC (migration
`20260723130200_schedule_bank_reauth_notices.sql`, using the same
`cron.unschedule`-in-a-`DO`-block idempotency pattern).

Each run:

1. Select banks where `status = 'requires_reauth' AND deactivated_at IS NOT NULL`.
2. Compute whole days elapsed (UTC-anchored, matching the trial-email convention).
3. Map to a stage — `day_1` (≥1), `day_4` (≥4), `day_10` (≥10) — taking the **highest** stage
   not yet present in `bank_reauth_notices` for that `(bank, deactivated_at)`.
4. Gate each channel through `resolveChannels(supabase, restaurantId, 'bank_reauth_required')`.
5. Send, then INSERT the dedupe row. The unique constraint makes a concurrent double-run safe.

Recipients by stage (the escalation ladder from the experience design):

| Stage | Recipients | Channels | Tone |
|-------|-----------|----------|------|
| Day 0 | — | in-app only | Freeze the numbers silently; the UI already shows it |
| Day 1 | owners + managers | email + push | First contact: what stopped, what to click |
| Day 4 | owners + managers | email + push | Name the cost — days of transactions now missing |
| Day 10 | owners only | email | Consequence tone; no push, this is not an interrupt |
| Recovered | owners + managers | email | Receipt: what backfilled, through what date |

The `recovered` stage is emitted by the same worker when it observes a bank that has a
`day_1`+ notice for a `deactivated_at` and is now `connected` again.

**SECURITY DEFINER note:** if any helper RPC is added for the day-window query, it must pin
`SET search_path = public, pg_temp` (2026-07-20 lesson).

---

## 5. Frontend

### 5.1 Read path (must land with the write path)

`src/hooks/useStripeFinancialConnections.tsx`: change
`.eq('status', 'connected')` to `.in('status', ['connected', 'requires_reauth', 'error'])`.
Select the three new columns. `disconnected` stays excluded — a user-initiated disconnect
should still remove the card.

Knock-on effects to handle in the same change:

- `totalBalance` / `bankCount` / `accountCount` now include quarantined banks. Balances from a
  `requires_reauth` bank must be **excluded from the headline total** and shown separately, or
  the top-line number silently changes meaning.
- `groupBanks` in `src/utils/financialConnections.ts` already ranks
  `error > requires_reauth > disconnected > connected` via `STATUS_PRIORITY`, so a grouped
  institution card correctly surfaces the worst member status. No change needed there.

### 5.2 New primitives

**`<FreshnessStamp>`** — `src/components/banking/FreshnessStamp.tsx`

Prints `data_current_through`, never `last_sync_at`. Three states:

| Input | Renders |
|-------|---------|
| Fresh (< 3 days) | `Data through Jul 21` — muted |
| Stale (≥ 3 days) | `Data through Jul 12 · 11 days behind` — amber |
| NULL | `Not yet verified` — muted, no date invented |

Typography per CLAUDE.md: `text-[13px] text-muted-foreground`, `tabular-nums` on the date.

**`<BankReauthBanner>`** — `src/components/banking/BankReauthBanner.tsx`

Rendered at the top of `/banking` (and on Accounting/Expenses where `BankConnectionStatus`
lives) when any bank is `requires_reauth`. Amber, not destructive — this is a "do a thing"
state, not a failure. Names the institution and the masked account, states the date data
stopped, single primary action: **Reconnect**.

Uses `bg-amber-500/10 border border-amber-500/20 rounded-xl`, matching the AI-suggestion panel
convention already in CLAUDE.md, and the `text-amber-700 dark:text-amber-400` pairing already
used by `BankConnectionCard`'s `requires_reauth` badge — so the banner and the badge read as
the same state.

### 5.3 Reworked surfaces

**`BankConnectionCard.tsx`** (the card actually used by `/banking`)

- Replace `• Synced {formatDate(last_sync_at)}` with `<FreshnessStamp>`.
- When `status === 'requires_reauth'`: **remove** "Refresh balance" and "Sync transactions"
  from the dropdown — do not disable them. A control that cannot work should not be present.
  Add a primary **Reconnect** action in their place.
- Per-account balance rows for a quarantined bank render hatched/dimmed with the account's own
  `as_of_date` stamp, so the number is visibly historical rather than current.

**`BankConnectionStatus.tsx`** (used by Accounting and Expenses)

Currently renders the raw enum inside a `destructive` badge, always shows a Sync button, and
violates the Apple/Notion spec (`text-lg font-semibold`, `p-3 border rounded-lg`,
`text-green-600` hard-coded). Rework:

- Human status labels, not enum values.
- Semantic tokens throughout; drop `text-green-600` for the emerald token pairing used by
  `BankConnectionCard`.
- Same rule: no Sync button on a bank that cannot sync; Reconnect instead.
- `<FreshnessStamp>` replaces `Last synced: …`.
- Keep `refetchInterval: 30000`.

**`useSyncBankTransactions.tsx`**

Stop claiming success for nothing. Branch on the new per-account response:

- any `needsReauth` → destructive toast naming the bank, action "Reconnect"
- `synced === 0` and no error → neutral toast, "No new transactions"
- `synced > 0` → success toast with the count

Also fix the invalidation key: it currently invalidates `['connected-banks']` while the hook's
query key is `['connectedBanks', restaurantId]`. The realtime channel papers over this today;
the explicit key should still be correct.

### 5.4 Reconnect interaction

`handleConnectBank` in `Banking.tsx` gains a `connectedBankId` argument. Same
`collectFinancialConnectionsAccounts` flow; the difference is entirely server-side (§4.5). The
dialog copy varies on the returned `mode`: relink says "Reconnect Northgate Savings & Trust
••4402"; link fallback says "Connect Northgate Savings & Trust".

**Note:** `Banking.tsx:200` hard-codes a live `pk_live_…` publishable key. Publishable keys are
not secret, so this is not a leak — but it is a config smell and it blocks sandbox testing.
Out of scope for this change; flagged for follow-up.

---

## 6. Testing

Per the 2026-07-20 coverage lesson, **every new executable line needs real coverage** —
source-text assertions do not count toward SonarCloud's 80% new-code gate.

| Area | Test | Location |
|------|------|----------|
| Stage math (days → `day_1`/`day_4`/`day_10`, UTC-anchored, boundary at exactly 1/4/10) | unit | `tests/unit/bankReauthStages.test.ts` |
| Recipient + channel resolution per stage | unit | same |
| `FreshnessStamp` three states incl. NULL | unit | `tests/unit/freshnessStamp.test.tsx` |
| Sync toast branching (needsReauth / 0 / N) | unit | `tests/unit/useSyncBankTransactions.test.ts` |
| Notification matrix stays in sync (new key in all 3 copies) | unit | existing `tests/unit/notificationTypes.test.ts` — must stay green |
| Identity-safe match: 3 accounts, 1 institution, concurrent reconnect ⇒ 3 distinct rows, no cross-graft | pgTAP | `supabase/tests/bank_reauth_identity.sql` |
| Partial unique index rejects a duplicate live `(restaurant, institution, mask)` | pgTAP | same |
| `deactivated` twice ⇒ `deactivated_at` unchanged (COALESCE) | pgTAP | same |
| `bank_reauth_notices` unique constraint blocks a double send; a *new* `deactivated_at` allows re-notify | pgTAP | `supabase/tests/bank_reauth_notices.sql` |

The pure stage/matching logic is extracted into `_shared/` helpers specifically so it is
unit-testable without a Deno HTTP harness — the pattern `_shared/availabilityReminderHandler.ts`
and `_shared/resolveChannels.ts` already establish.

---

## 7. Decided trade-offs

**Fail-open vs fail-closed on channels.** `resolveChannels` fails open. A bank outage notice is
exactly the kind of message that must not be silently dropped by a transient DB error, so we
keep the existing behaviour rather than special-casing this type.

**INSERT on no identity match, rather than a best-effort claim.** Produces a visible duplicate
row in the worst case. Accepted deliberately: a duplicate is diagnosable and repairable, a
merged ledger is neither.

**`data_current_through` as a separate column rather than a computed `MAX(transacted_at)`
subquery.** The subquery would be correct but puts an aggregate over `bank_transactions` on
every `/banking` render. A denormalised column written at sync time is one lookup, and sync is
the only thing that can change the answer.

**Amber, not red.** `requires_reauth` is an action state, not an error state. Reserving
destructive styling for `error` keeps the two distinguishable at a glance — which matters
because they need different user actions.

**Removing controls rather than disabling them.** A disabled Sync button invites a hover,
a tooltip, and a support ticket. Absence plus a working Reconnect is unambiguous.

---

## 8. Migration inventory

| File | Purpose |
|------|---------|
| `20260723130000_connected_banks_reauth_columns.sql` | 3 columns + mask backfill + partial unique index |
| `20260723130100_bank_reauth_notices.sql` | dedupe table + RLS + notification CHECK constraint update |
| `20260723130200_schedule_bank_reauth_notices.sql` | daily pg_cron registration |

All three prefixes verified unique against `supabase/migrations/` (latest existing:
`20260723120000_add_collaborator_operations_manager_role.sql`) — the 2026-07-21 prefix-collision
lesson.

No `CREATE OR REPLACE FUNCTION` is planned. If Phase 4 finds one is needed, source the body
from the latest migration that sorts before the new one and write a provenance comment
(2026-07-20 / 2026-07-22 lessons).

---

## 9. Out of scope / follow-ups

- Manual Dashboard relink for any currently-affected tenant (user deferred).
- The three redundant unique indexes on `connected_banks.stripe_financial_account_id` —
  collapsing them is safe but unrelated; separate PR.
- Moving the hard-coded `pk_live_…` publishable key in `Banking.tsx` to config.
- Stripe API version: the codebase pins `2025-08-27.basil`; current is `2026-06-24.dahlia`.
  Upgrading is a cross-cutting change touching every Stripe edge function — separate PR.
