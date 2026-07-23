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

(`data_current_through` is `timestamptz` — see the note below; an earlier draft of this
document typed it `date` on a misreading of the schema.)

| Column | Meaning | Written by |
|--------|---------|------------|
| `account_mask` | Stripe's `account.last4`. Already captured on the balances row; needed on the bank row to make reconnect matching identity-safe. | `account.created` branch; backfilled from `bank_account_balances` |
| `deactivated_at` | When Stripe told us the authorization died. Drives the escalation ladder. | `deactivated` branch |
| `data_current_through` | The newest `transaction_date` we actually hold for this bank. **This is what the UI prints** — never `last_sync_at`. | `stripe-sync-transactions` after a successful fetch |

> **`data_current_through` is `timestamptz`, computed as `MAX(transaction_date)`.**
>
> *Corrected after a first draft got this wrong.* Both this design and the Phase 2.5 review
> asserted that `bank_transactions` stores `transaction_date DATE` with no full-precision
> instant available, and on that basis typed the new column `date`. That reading came from the
> original `CREATE TABLE` in `20251018183326_…sql` and missed the later
> `20251021195308_…sql` ("Refactor: Store full UTC timestamps"), which did
> `ALTER COLUMN transaction_date TYPE TIMESTAMPTZ` and the same for `posted_date`. Verified
> against production: both columns are `timestamp with time zone` today.
>
> So the precision *is* there, and `stripe-sync-transactions` already writes Stripe's exact
> instant into it (`new Date(txn.transacted_at * 1000).toISOString()`). Typing the new column
> `date` would deliberately discard it — which is the same class of lie as §1 defect #3, just
> pointed the other way. `data_current_through timestamptz` it is.

Supporting index for the recompute (§4.3), since `bank_transactions` only has
`idx_bank_transactions_bank(connected_bank_id)` today:

```sql
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_date
  ON public.bank_transactions (connected_bank_id, transaction_date DESC);
```

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

GRANT SELECT ON public.bank_reauth_notices TO authenticated;
GRANT ALL    ON public.bank_reauth_notices TO service_role;
```

Including `deactivated_at` in the unique key is what makes a *second, later* outage re-notify
rather than being suppressed by the first outage's rows.

**The GRANTs are not optional.** New tables do not inherit CRUD grants to `authenticated`;
without them a query fails with `permission denied` *before* RLS is even evaluated, so the
policy below would be silently dead. This repo has hit that exact footgun before —
`20260628000000_grant_user_restaurants_select.sql` documents it, and both
`20260706120000_revel_integration.sql` and `20260719120000_notification_channel_settings.sql`
carry explicit GRANTs for this reason.

RLS: service-role writes only; a single SELECT policy scoped through
`public.user_has_restaurant_access(restaurant_id)`
(`20260521222200_create_user_has_restaurant_access_helper.sql` — `STABLE SECURITY DEFINER
SET search_path = public`), so support tooling can read it. No INSERT/UPDATE/DELETE policy for
authenticated users. Do **not** hand-roll an inline `EXISTS (… user_restaurants …)` subquery;
the helper exists precisely to avoid that.

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

The INSERT must be conflict-aware, because the new partial unique index creates a race the old
code did not have: two concurrent `account.created` events for distinct `fca_` accounts that
share a `(restaurant_id, institution_name, account_mask)` tuple (a double-submitted Link flow)
both see 0 rows in step 1 and both reach step 2. The first wins; a bare INSERT makes the second
throw `23505` and the webhook 500s.

```sql
INSERT INTO connected_banks (…)
VALUES (…)
ON CONFLICT (restaurant_id, institution_name, account_mask)
  WHERE status <> 'disconnected' AND account_mask IS NOT NULL
DO UPDATE SET
  stripe_financial_account_id = EXCLUDED.stripe_financial_account_id,
  status = 'connected',
  connected_at = now(),
  disconnected_at = NULL,
  deactivated_at = NULL,
  sync_error = NULL,
  institution_logo_url = COALESCE(EXCLUDED.institution_logo_url, connected_banks.institution_logo_url)
RETURNING id;
```

The `ON CONFLICT` inference clause must repeat the partial index's predicate verbatim, or
Postgres cannot match it to the index. Rows with a NULL `account_mask` never conflict (NULLs
are distinct in a unique index) and simply insert, which is the intended behaviour for the
legacy/unknown-mask case described below.

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
   - `data_current_through = MAX(transaction_date)` over the rows we actually hold for that
     bank, recomputed after insert (a backward index scan on the new
     `idx_bank_transactions_bank_date`). This is the value the UI prints.

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

Each run processes **two** cohorts:

**Cohort A — still down.**

1. Select banks where `status = 'requires_reauth' AND deactivated_at IS NOT NULL`.
2. Compute whole days elapsed (UTC-anchored, matching the trial-email convention).
3. Map to a stage — `day_1` (≥1), `day_4` (≥4), `day_10` (≥10) — taking the **highest** stage
   not yet present in `bank_reauth_notices` for that `(bank, deactivated_at)`.
4. Gate each channel through `resolveChannels(supabase, restaurantId, 'bank_reauth_required')`.
5. Send, then `INSERT … ON CONFLICT DO NOTHING` on the dedupe row — the unique constraint
   plus `DO NOTHING` is what makes a concurrent double-run a no-op rather than a `23505`.

**Cohort B — recovered.**

The `reactivated` / reconnect paths null out `connected_banks.deactivated_at`, so by the time
this worker runs there is no outage timestamp left on the bank row to correlate against — and
cohort A's query would never return a bank that is `connected` again anyway. The recovery
notice therefore sources its correlation key from the notices table, not from `connected_banks`:

```sql
SELECT n.connected_bank_id, n.deactivated_at, cb.restaurant_id
FROM (
  SELECT DISTINCT ON (connected_bank_id) connected_bank_id, deactivated_at
  FROM bank_reauth_notices
  WHERE stage <> 'recovered'
  ORDER BY connected_bank_id, deactivated_at DESC, sent_at DESC
) n
JOIN connected_banks cb ON cb.id = n.connected_bank_id
WHERE cb.status = 'connected'
  AND NOT EXISTS (
    SELECT 1 FROM bank_reauth_notices r
    WHERE r.connected_bank_id = n.connected_bank_id
      AND r.stage = 'recovered'
      AND r.deactivated_at = n.deactivated_at
  );
```

That is: "the most recent outage we told someone about, for a bank that is healthy again and
whose recovery we have not yet acknowledged." Because the dedupe key includes
`deactivated_at`, a later, separate outage produces a fresh chain and a fresh recovery notice.

Recipients by stage (the escalation ladder from the experience design):

| Stage | Recipients | Channels | Tone |
|-------|-----------|----------|------|
| Day 0 | — | in-app only | Freeze the numbers silently; the UI already shows it |
| Day 1 | owners + managers | email + push | First contact: what stopped, what to click |
| Day 4 | owners + managers | email + push | Name the cost — days of transactions now missing |
| Day 10 | owners only | email | Consequence tone; no push, this is not an interrupt |
| Recovered | owners + managers | email | Receipt: what backfilled, through what date |

**SECURITY DEFINER note:** if any helper RPC is added for the day-window query, it must pin
`SET search_path = public, pg_temp` (2026-07-20 lesson).

---

## 5. Frontend

### 5.1 Read path (must land with the write path)

`src/hooks/useStripeFinancialConnections.tsx`: change
`.eq('status', 'connected')` to `.in('status', ['connected', 'requires_reauth', 'error'])`.
Select the three new columns. `disconnected` stays excluded — a user-initiated disconnect
should still remove the card.

#### 5.1.1 Status must become per-account, not per-institution

This is the load-bearing structural change on the frontend, and the reason the rest of §5
works at all.

`groupBanks` (`src/utils/financialConnections.ts`) merges every `connected_banks` row sharing
an `institution_name` into one `GroupedBank` with a single worst-of `status`, and `BankBalance`
carries **no status field**. But §4.2 makes "N accounts at one institution, independently
authorised" the central scenario. With today's shape, an institution where 1 of 3 accounts is
quarantined would:

- strip Sync/Refresh from all three (the card's top-level dropdown loops `bank.bankIds`),
- give the UI no way to know *which* balance row to mark historical, and
- force the headline total to drop all three balances or none.

All three are wrong. So:

```ts
// src/utils/financialConnections.ts
export interface BankBalance {
  …
  bankStatus: BankStatus;          // NEW — inherited from the owning connected_banks row
  dataCurrentThrough: string | null; // NEW — the owning row's data_current_through
}

export interface GroupedBank {
  …
  reauthBankIds: string[];   // NEW — the subset of bankIds needing reauthorization
  healthyBankIds: string[];  // NEW — the complement; drives which controls stay live
}
```

`groupBanks` stamps `bankStatus` / `dataCurrentThrough` onto each balance as it merges (it
already rewrites `connected_bank_id` in that same map, so this is the same pass), and
partitions `bankIds`. `STATUS_PRIORITY`'s worst-of roll-up stays as-is and is still correct
for the card's *headline badge* — it just stops being the only status the UI can see.

#### 5.1.2 Totals

`computeTotalBalance` / `computeAccountCount` in `src/utils/financialConnections.ts` gain a
status filter so quarantined accounts are excluded from the headline number, and the hook
exposes `quarantinedBalance` alongside `totalBalance` so the UI can show the held-back amount
rather than silently shrinking the total.

**`src/pages/Expenses.tsx` has a duplicate inline total that must be fixed in the same change:**

```ts
// Expenses.tsx:34-36 — no status filter, feeds bookBalance on line 42
const totalBalance = connectedBanks
  .flatMap((bank) => bank.balances || [])
  .reduce((sum, balance) => sum + (Number(balance?.current_balance) || 0), 0);
```

Once the read path widens, this pulls quarantined balances straight into `bookBalance`. Replace
it with the shared helper — one exported function, one filter rule, no second copy to drift.

#### 5.1.3 `useConnectedBanks` — explicitly out of scope

`src/hooks/useConnectedBanks.tsx` is a **separate** hook (query key `['connected-banks', …]`,
`select('*, bank_account_balances(*)')`) feeding the Dashboard balance widget
(`src/pages/Index.tsx`), `FinancialIntelligence.tsx`, and `EnhancedReconciliationDialog.tsx`.
It also hard-filters `.eq('status', 'connected')`.

**Decision: leave it filtering `connected`.** Its consumers all treat the result as "money we
can trust right now", and the filter already produces the correct behaviour for that reading —
a quarantined account drops out of the Dashboard total, which is what §5.1.2 does deliberately
on Banking. Widening it without also building per-surface quarantine treatment on three more
pages would import the problem without the fix.

The residual gap is real and is named here rather than left silent: the Dashboard total shrinks
with no on-screen explanation. Closing it means surfacing `<BankReauthBanner>` on the Dashboard
too — deferred to the follow-up in §9, not smuggled into this change.

### 5.2 New primitives

**`<FreshnessStamp>`** — `src/components/banking/FreshnessStamp.tsx`

Prints `data_current_through`, never `last_sync_at`. Three states:

| Input | Renders |
|-------|---------|
| Fresh (< 3 days) | `Data through Jul 21` — muted |
| Stale (≥ 3 days) | `Data through Jul 12 · 11 days behind` — amber |
| NULL | `Not yet verified` — muted, no date invented |

Typography per CLAUDE.md: `text-[13px] text-muted-foreground`, `tabular-nums` on the date.

`data_current_through` is a `timestamptz` (§3.1), but the stamp deliberately renders a **date**
and floors the gap to whole days. A number that reads "11 days behind" must not tick to 12
because the viewer reloaded after midnight UTC while nothing about the data changed — the gap
is computed by flooring both endpoints to UTC calendar days and subtracting. The full instant
stays available for the `title` attribute and for anything downstream that needs precision.

The 3-day amber threshold is about **ordinary staleness** — a weekend, a slow Stripe refresh.
It is deliberately *not* the day-0 quarantine signal: quarantine keys off `bankStatus ===
'requires_reauth'`, fires the instant the webhook lands, and is carried by `<BankReauthBanner>`
plus the card badge. A bank can be quarantined while its stamp still reads fresh, and that
combination is correct: the data we hold *is* current as of yesterday; it just stopped there.

**`<BankReauthBanner>`** — `src/components/banking/BankReauthBanner.tsx`

Rendered at the top of `/banking`, and **added to** `src/pages/Accounting.tsx` and
`src/pages/Expenses.tsx` (see §5.3 — it cannot ride in on `BankConnectionStatus`, which nothing
renders). Fires when any bank is `requires_reauth`. Amber, not destructive — this is a "do a
thing" state, not a failure. Names the institution and the masked account, states the date data
stopped, single primary action: **Reconnect**.

Uses `bg-amber-500/10 border border-amber-500/20 rounded-xl`, matching the AI-suggestion panel
convention already in CLAUDE.md, and the `text-amber-700 dark:text-amber-400` pairing already
used by `BankConnectionCard`'s `requires_reauth` badge — so the banner and the badge read as
the same state.

Accessibility and responsive requirements:

- `role="status"` on the container. The hook's realtime channel invalidates on any
  `connected_banks` change, so the banner can appear mid-session while a screen-reader user is
  already on the page; without a live region that quarantine is announced to nobody.
- Status is never encoded by colour alone — the amber is accompanied by the `AlertCircle` icon
  and the literal words "Needs reauthorization".
- Layout is `flex-col sm:flex-row` with the institution name `truncate`, matching the
  responsive pattern `Banking.tsx` already uses. Verified at 375px: institution + `••4402` +
  date + CTA must wrap to a second row rather than overflow.

### 5.3 Reworked surfaces

**`BankConnectionCard.tsx`** (the card actually used by `/banking`)

- Replace `• Synced {formatDate(last_sync_at)}` with `<FreshnessStamp>`.
- Gains an `onReconnect?: (connectedBankId: string) => Promise<void>` prop.
- **Top-level dropdown**: "Refresh balance" and "Sync transactions" now loop
  `bank.healthyBankIds` rather than `bank.bankIds`, so a healthy sibling keeps working while
  another account is quarantined. When `healthyBankIds` is empty both entries are **removed**
  — not disabled. A control that cannot work should not be present.
- **Reconnect** appears as a primary dropdown entry whenever `reauthBankIds.length > 0`. For a
  single quarantined account it targets that `connected_bank_id` directly; for several it opens
  the accounts list so the user picks — never a silent "first of N".
- **Per-account rows** now branch on `balance.bankStatus`, which is what §5.1.1 exists to
  provide. A quarantined row renders historical; its siblings render normally. Its own
  per-account dropdown swaps Refresh/Sync for Reconnect targeting
  `balance.connected_bank_id`.

*Historical-row treatment (contrast-safe):* do **not** reduce opacity on the balance figure —
`opacity-50` on `text-foreground` over `bg-background` drops below the 4.5:1 WCAG 1.4.3 floor
for normal-size text. Instead: the figure moves to `text-muted-foreground` at full opacity
(a token pairing already contrast-checked across both themes), the row container takes a faint
diagonal `repeating-linear-gradient` built from `hsl(var(--muted-foreground) / 0.06)` for the
hatch, and the row carries a literal `Historical` chip plus the account's own `as_of_date`.
Texture and text carry the meaning; nothing depends on the hatch being perceived.

**`BankConnectionStatus.tsx` — delete it**

The design originally planned to rework this component "as used by Accounting and Expenses".
It is not used by anything: `grep -rn "BankConnectionStatus" src/` returns only the file's own
definition. Reworking it would produce a component nobody renders, and — worse — would have
left `<BankReauthBanner>` absent from Accounting and Expenses while the design believed it was
covered there.

So: delete `src/components/banking/BankConnectionStatus.tsx`, and add `<BankReauthBanner>` to
`src/pages/Accounting.tsx` and `src/pages/Expenses.tsx` as a real, explicit change. This is a
net deletion plus two one-line insertions, and it is the only version of this that actually
puts the signal in front of the user.

**`useSyncBankTransactions.tsx`**

Stop claiming success for nothing. Branch on the new per-account response:

- any `needsReauth` → destructive toast naming the bank, action "Reconnect"
- `synced === 0` and no error → neutral toast, "No new transactions"
- `synced > 0` → success toast with the count

Invalidate **both** cache keys, rather than swapping one for the other:

```ts
queryClient.invalidateQueries({ queryKey: ['connectedBanks'] });   // useStripeFinancialConnections
queryClient.invalidateQueries({ queryKey: ['connected-banks'] });  // useConnectedBanks (Dashboard, FI, reconciliation)
```

The hook currently invalidates only the kebab-case key, which never matches
`['connectedBanks', restaurantId]`; the realtime channel papers over that on Banking today.
Simply switching to the camelCase key would regress the Dashboard's post-sync refresh — the two
keys belong to two genuinely different hooks (§5.1.3), and both need the invalidation.

### 5.4 Reconnect interaction

`handleConnectBank` in `Banking.tsx` gains an optional `connectedBankId` argument and is passed
down as `onReconnect` to `BankConnectionCard` and `BankReauthBanner`. Same
`collectFinancialConnectionsAccounts` flow; the difference is entirely server-side (§4.5).

The ID is always a single `connected_bank_id`, never a `GroupedBank.bankIds` array — §5.1.1's
`reauthBankIds` / per-balance `connected_bank_id` are what make that unambiguous. A group with
more than one quarantined account expands the accounts list instead of guessing.

The dialog copy varies on the returned `mode`: relink says "Reconnect Northgate Savings & Trust
••4402"; link fallback says "Connect Northgate Savings & Trust".

**States** (CLAUDE.md mandates all three on every new surface): `<FreshnessStamp>` renders its
NULL case as `Not yet verified` and has no async state of its own. `<BankReauthBanner>` returns
`null` while the hook is loading (never a skeleton for a banner that usually shouldn't exist),
`null` when no bank is quarantined, and surfaces a destructive variant carrying `sync_error`
when a bank is in `error` rather than `requires_reauth`. Reconnect has an in-flight spinner on
its own button and a destructive toast on failure.

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
| `BankReauthBanner`: null when loading, null when none quarantined, destructive on `error`, `role="status"` present | unit | `tests/unit/bankReauthBanner.test.tsx` |
| Sync toast branching (needsReauth / 0 / N) + both invalidation keys fire | unit | `tests/unit/useSyncBankTransactions.test.ts` |
| `groupBanks` stamps per-balance `bankStatus`; partitions `reauthBankIds` / `healthyBankIds`; 1-of-3 quarantined leaves 2 healthy | unit | `tests/unit/financialConnections.groupBanks.test.ts` |
| `computeTotalBalance` excludes quarantined accounts and reports them as `quarantinedBalance` | unit | same |
| Notification matrix stays in sync (new key in all 3 copies) | unit | existing `tests/unit/notificationTypes.test.ts` — must stay green |
| Identity-safe match: 3 accounts, 1 institution, concurrent reconnect ⇒ 3 distinct rows, no cross-graft | pgTAP | `supabase/tests/bank_reauth_identity.sql` |
| Partial unique index rejects a duplicate live `(restaurant, institution, mask)`; `ON CONFLICT … DO UPDATE` makes the concurrent-insert race a no-op rather than a `23505` | pgTAP | same |
| NULL `account_mask` rows never conflict and always take the INSERT path | pgTAP | same |
| `deactivated` twice ⇒ `deactivated_at` unchanged (COALESCE) | pgTAP | same |
| `bank_reauth_notices` unique constraint blocks a double send; a *new* `deactivated_at` allows re-notify | pgTAP | `supabase/tests/bank_reauth_notices.sql` |
| `bank_reauth_notices` is SELECT-able by a member and denied to a non-member (proves the GRANT *and* the RLS policy, not just one) | pgTAP | same |
| Cohort-B recovery query finds a reconnected bank via the notices table after `connected_banks.deactivated_at` was nulled | pgTAP | same |

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

**`data_current_through` as a separate column rather than a computed `MAX(transaction_date)`
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
| `20260723130000_connected_banks_reauth_columns.sql` | 3 columns + mask backfill + partial unique index + `idx_bank_transactions_bank_date` |
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
- **Quarantine treatment on the Dashboard / FinancialIntelligence / reconciliation surfaces**
  fed by `useConnectedBanks` (§5.1.3). Those totals will silently shrink when an account is
  quarantined; closing that means widening the hook *and* rendering `<BankReauthBanner>` on
  three more pages. Named, scoped out, and worth doing next.
- **Restaurant-timezone-aware freshness display.** `transaction_date` is a true UTC instant
  (§3.1), and `<FreshnessStamp>` floors it to UTC calendar days. For a restaurant several hours
  off UTC, a late-evening transaction can therefore stamp as the following day. Rendering the
  stamp in the restaurant's own timezone is the right fix and is a separable change — the
  precision needed for it is already in the column.
- Bringing `BankConnectionCard.tsx` fully onto the CLAUDE.md type scale. It currently uses
  `text-base` / `text-lg` / `text-sm` / `text-xs` rather than the mandated
  `text-[17px]` / `text-[14px]` / `text-[13px]` / `text-[12px]`. This change touches the file
  but deliberately does not restyle lines it isn't otherwise editing — a whole-file typography
  sweep would bury the behavioural diff that needs reviewing.
- The three redundant unique indexes on `connected_banks.stripe_financial_account_id` —
  collapsing them is safe but unrelated; separate PR.
- Moving the hard-coded `pk_live_…` publishable key in `Banking.tsx` to config.
- Stripe API version: the codebase pins `2025-08-27.basil`; current is `2026-06-24.dahlia`.
  Upgrading is a cross-cutting change touching every Stripe edge function — separate PR.
