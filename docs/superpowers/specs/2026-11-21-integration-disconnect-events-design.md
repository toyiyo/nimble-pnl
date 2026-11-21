# Integration disconnect events and alerts (PR 1 of 3)

Status: draft. Date: 2026-11-21. Branch: `feature/integration-disconnect-events`.

## 1. Problem

A user can disconnect a POS from `/integrations` with one click. No table records
who did it or why. Other owners do not get a notice. In one real case, sales data
stopped for 29 days before anyone noticed.

PR 1 records each disconnect, asks for a reason, offers a better next step, and
sends a Day-0 alert to all owners and to customer success.

Not in PR 1: pause sync, the data-gap banner, the Day 3/7/14 sequence, and the
churn-risk score.

## 2. Current state (with citations)

### 2.1 Disconnect paths

| Integration | Hook | Action today | Table flag |
|---|---|---|---|
| Revel | `src/hooks/useRevelConnection.tsx:102-118` | client UPDATE `is_active=false` | `is_active` (`supabase/migrations/20260706120000_revel_integration.sql:16`) |
| Toast | `src/hooks/useToastConnection.tsx:165-195` | client UPDATE `is_active=false` | `is_active` (`20260106120000_toast_standard_api_migration.sql:34`) |
| Focus | `src/hooks/useFocusConnection.tsx:204-239` | client UPDATE `is_active=false` | `is_active` (`20260627120000_focus_integration.sql:47`) |
| Square | `src/hooks/useSquareIntegration.tsx:91-119` | client DELETE (cascades to `square_locations`) | none |
| Clover | `src/hooks/useCloverIntegration.tsx:122-150` | client DELETE (cascades to `clover_locations`) | none |
| Shift4 | `src/hooks/useShift4Integration.tsx:147-180` | client DELETE by `id` | none |
| Bank | `src/hooks/useStripeFinancialConnections.tsx:142-197` | edge function `stripe-disconnect-bank` | `status`, `disconnected_at` |

- All six POS disconnects go through one button in
  `src/components/IntegrationCard.tsx:334-341`. The handler is at lines 188-228.
  There is no confirm step.
- `src/components/pos/RevelSetupWizard.tsx:49` also calls `disconnectRevel`. It
  is a rollback after a failed connection test. It is not a user disconnect.
- `src/hooks/useToastIntegration.tsx:101-128` has a second `disconnectToast`
  (hard DELETE). No UI calls it.
- The bank uses `src/components/banking/DisconnectBankDialog.tsx`. Its
  `handleDisconnect` (lines 54-70) loops over the bank ids of one institution.
- `supabase/functions/stripe-disconnect-bank/index.ts:70-80` allows only owner
  and manager. Lines 109-115 set `status='disconnected'`.

### 2.2 Permission rules

- RLS lets owner and manager write every connection table:
  - revel: `20260706120000_revel_integration.sql:130-132`
  - toast: `20260106120000_toast_standard_api_migration.sql:63-74`
  - square: `20250916223011_7793a7c0-...sql:76-86`
  - clover: `20251016025920_3c710088-...sql:8-25`
  - shift4: `20251117021438_78431eff-...sql:88-110`
  - focus: `20260627120000_focus_integration.sql:133-142`
  - connected_banks: `20260120100100_update_rls_for_collaborators.sql:463-468`
- The UI has no role check on the Disconnect button.
  `src/pages/Integrations.tsx:254-258` renders the card for every user who can
  open the page.
- Result: a chef or a custom role sees the button. RLS blocks the write, but the
  UPDATE or DELETE matches 0 rows and returns no error. The user sees a false
  "Disconnected" toast.
- `manage:integrations` is owner-only (`src/lib/permissions/definitions.ts:78-79`,
  `20260806140000_legacy_role_sensitive_flags.sql:152`). No component checks it.
- `public.user_has_role(p_restaurant_id, p_roles)` is at
  `20260120100000_add_collaborator_roles.sql:26-43`.

### 2.3 Email, Slack, and triggers

- Email goes through Resend. Use `sendEmailResult` and `sendPaced` from
  `supabase/functions/_shared/emailQueue.ts:94,152`.
- The layout is `generateEmailTemplate` in `_shared/emailTemplates.ts:189`. It
  escapes every field.
- The sender is `NOTIFICATION_FROM` and the app URL is `APP_URL`, in
  `_shared/notificationHelpers.ts:185,190`.
- Owner emails come from `public.bank_reauth_notice_recipients(p_restaurant_id, p_roles)`,
  at `20260723130200_schedule_bank_reauth_notices.sql:141-173`. Only
  `service_role` can execute it.
- No Slack code exists in the repo.
- User-driven notices use a client `functions.invoke` after the RPC, without a
  wait for the result. See `src/hooks/useShiftTrades.ts:87-126` and
  `src/hooks/useOpenShiftClaims.ts:11-27`.
- No row trigger calls `net.http_post` today.
- Edge-function logic lives in pure `_shared/*Handler.ts` files with injected
  deps. Vitest tests it, for example `tests/unit/bankReauthNoticesHandler.test.ts:2-8`.
- The user-auth pattern is at `supabase/functions/notify-schedule-published/index.ts:22-86`.
- The closest audit-table model is `public.security_events`, at
  `20250927023236_61cbaa4a-...sql:44-103`. It has a SELECT policy only, and an
  RPC does the inserts.

## 3. Approaches for the alert trigger

**A. Client invokes an edge function after the RPC (recommended).**
- The hook calls `disconnect_integration`, then invokes
  `notify-integration-disconnect` with the event id. It does not wait for the
  result.
- This is the current pattern (§2.3). It is easy to test with Vitest.
- Risk: if the browser closes between the two calls, no alert goes out. The
  event row keeps `alerted_at IS NULL`. PR 3 adds a cron sweep for those rows.

**B. Row trigger on `integration_events` with `pg_net`.**
- The alert always goes out, even if the browser closes.
- No precedent exists in the repo. The trigger needs the vault service key.
  pgTAP cannot check the HTTP call. A failure is invisible to the user.

**C. Cron sweep every 5 minutes.**
- This is reliable, but it adds up to 5 minutes of delay and a new cron job.

Decision: use A now. Keep the `alerted_at` column so that PR 3 can add C as a
safety net.

## 4. Design

### 4.1 Table `public.integration_events`

```sql
id             uuid PK DEFAULT gen_random_uuid()
restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE
integration    text NOT NULL CHECK (integration IN
                 ('revel','toast','square','clover','shift4','focus','bank'))
event          text NOT NULL CHECK (event IN
                 ('connect','disconnect','pause','resume','auth_failure'))
actor_user_id  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
reason         text NULL CHECK (reason IN ('switching_pos','credentials_changed',
                 'temporary_close','no_value','too_expensive','other'))
reason_text    text NULL CHECK (char_length(reason_text) <= 500)
details        jsonb NOT NULL DEFAULT '{}'   -- e.g. bank institution name
alerted_at     timestamptz NULL              -- set when the Day-0 alert is claimed
created_at     timestamptz NOT NULL DEFAULT now()
```

- Use `text` with `CHECK`, not a Postgres enum. A new value then needs only a
  new constraint, not `ALTER TYPE`.
- `reason` is NULL when the user skips the reason, or when the event is not a
  disconnect.
- Add an index on `(restaurant_id, created_at DESC)`.
- The table has no FK to a connection row. Square, Clover, and Shift4 delete
  their row, and the event must stay.
- RLS is on. One SELECT policy uses
  `user_has_role(restaurant_id, ARRAY['owner','manager'])`.
- There is no INSERT, UPDATE, or DELETE policy. Also
  `REVOKE INSERT, UPDATE, DELETE ON integration_events FROM anon, authenticated`.
- `GRANT SELECT TO authenticated` and `GRANT ALL TO service_role`.
- PR 1 writes `disconnect` events only. The other event values are for PR 2 and
  later.

### 4.2 RPC `public.disconnect_integration`

```sql
disconnect_integration(
  p_restaurant_id uuid,
  p_integration   text,
  p_reason        text DEFAULT NULL,
  p_reason_text   text DEFAULT NULL
) RETURNS uuid   -- the new event id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
```

Steps, in one transaction:
1. If `auth.uid()` is NULL, raise `42501`.
2. If `user_has_role(p_restaurant_id, ARRAY['owner','manager'])` is false, raise
   `42501`. This matches the current RLS write rule (§2.2).
3. If `p_integration = 'bank'`, raise `22023`. The bank uses its edge function
   (§4.4).
4. Change the connection:
   - revel, toast, focus: `UPDATE ... SET is_active = false, updated_at = now()
     WHERE restaurant_id = p_restaurant_id AND is_active`.
   - square, clover, shift4: `DELETE ... WHERE restaurant_id = p_restaurant_id`.
     This keeps the current behavior and its cascades.
5. If the row count is 0, raise `P0002` with the message
   `no active <integration> connection`. This fixes the false success in §2.2.
6. Set `p_reason_text` to NULL when it is blank. Trim it.
7. Insert the event with `actor_user_id = auth.uid()`. Return its id.

- `REVOKE ALL ... FROM PUBLIC, anon`. `GRANT EXECUTE ... TO authenticated`.
- Use dynamic SQL only with `format('%I', ...)` on a fixed table map. Do not
  pass user text into identifiers.

### 4.3 RPC `public.record_integration_event` (service role only)

```sql
record_integration_event(p_restaurant_id uuid, p_integration text, p_event text,
  p_actor_user_id uuid, p_reason text, p_reason_text text, p_details jsonb)
RETURNS uuid
```

- `stripe-disconnect-bank` calls it after the Stripe call succeeds.
- `GRANT EXECUTE ... TO service_role` only.

### 4.4 Bank flow

- `stripe-disconnect-bank` accepts the optional fields `reason`, `reasonText`,
  and `recordEvent` in the body.
- When `recordEvent` is true, it calls `record_integration_event` with
  `details = { institution_name, bank_ids }`, and returns `eventId`.
- `DisconnectBankDialog` loops over the bank ids of one institution. It sends
  `recordEvent: true` only on the first id. Result: one event and one alert for
  each institution disconnect.

### 4.5 Edge function `notify-integration-disconnect`

- Input: `{ eventId }`. It uses the user JWT (`verify_jwt` default).
- Logic lives in `_shared/integrationDisconnectAlertHandler.ts` with injected
  deps. The content lives in `_shared/integrationDisconnectAlertContent.ts`.
  `index.ts` only wires real clients.

Steps:
1. Get the caller with `auth.getUser()`.
2. Load the event with the service client. If `actor_user_id` is not the
   caller, return 403. Only the person who disconnected can start the alert.
3. Claim the alert atomically:
   `UPDATE integration_events SET alerted_at = now() WHERE id = $1 AND alerted_at IS NULL RETURNING id`.
   If no row returns, return `{ skipped: 'already_alerted' }`.
4. Load the owners with `bank_reauth_notice_recipients(restaurant_id, ARRAY['owner'])`.
   Load the restaurant name and the actor name.
5. Send one email to each owner with `sendPaced` and `sendEmailResult`.
   - Subject: `<Integration> was disconnected from <restaurant>`.
   - Body: who, when (restaurant time zone if known, else UTC), the
     integration, and the reason label. Add the reason text if it exists.
   - CTA: "Reconnect" to `${APP_URL}/integrations`.
6. If `CS_SLACK_WEBHOOK_URL` is set, post one message to it:
   restaurant name, restaurant id, integration, actor email, reason, and reason
   text. If it is not set, log `slack_skipped` and continue.
7. Return a summary: emails sent, emails failed, Slack status.

- A failed send does not clear `alerted_at`. The function logs the failure. PR 3
  can add a retry.
- The Slack message holds tenant data. It goes to an internal channel only. The
  PR body names the secret but no channel URL.
- Function secret to add: `CS_SLACK_WEBHOOK_URL`. The PR body states this.

### 4.6 Client: shared helper and hooks

- New file `src/lib/integrationDisconnect.ts`:
  - `disconnectIntegration({ restaurantId, integration, reason, reasonText })`
    calls the RPC. It throws on error. It returns the event id.
  - `notifyIntegrationDisconnect(eventId)` invokes the edge function. It
    catches all errors and logs them. It never throws.
  - Shared types `IntegrationKey` and `DisconnectReason`, and the reason labels.
- Each POS hook keeps its public function name. The function takes an optional
  `{ reason, reasonText }` argument and calls the helper. It keeps its current
  state resets, query invalidations, and toasts.
- Square and Clover rethrow the error. Today they only show a toast. The dialog
  must know about the failure so that it stays open.
- The Revel wizard rollback (§2.1) gets a new hook function,
  `rollbackRevelConnection`. It keeps the direct UPDATE and writes no event. A
  failed setup is not a disconnect.
- The unused `useToastIntegration.disconnectToast` stays as it is. It is a
  follow-up to delete it.
- `useStripeFinancialConnections.disconnectBank(bankId, deleteData, opts?)`
  passes `reason`, `reasonText`, and `recordEvent`, and invokes the notice when
  `eventId` returns.

### 4.7 Shared dialog `DisconnectIntegrationDialog`

File: `src/components/integrations/DisconnectIntegrationDialog.tsx`. Use the
Dialog structure from CLAUDE.md, semantic tokens only, and `DialogDescription`.

Props:

```ts
{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationName: string;        // "Revel", "Chase"
  restaurantName: string;
  kind: 'pos' | 'bank';
  onConfirm: (r: { reason: DisconnectReason | null; reasonText: string | null }) => Promise<void>;
  onReconnect?: () => void;       // credentials_changed next step
  extraConfirmContent?: ReactNode; // bank: the delete-data checkbox
}
```

Steps (a step indicator shows Impact, Reason, Confirm):

1. **Impact.**
   - POS: "Sales stop on <today>. These reports stop updating:" P&L and daily
     sales, food cost % and labor %, tip pooling and break-even.
   - Bank: "Transactions stop on <today>." Bank balances, cash flow, and
     expense categorization.
   - Buttons: "Cancel" and "Continue".
2. **Reason.** A `RadioGroup` with the six labels from the concept page. Each
   choice shows a next-step panel:
   - switching_pos: "Keep your history when you switch". Button "Connect new
     POS" closes the dialog. The connection stays.
   - credentials_changed: "Reconnect instead". Button "Update credentials" calls
     `onReconnect`.
   - temporary_close: "Pause the sync instead". A note says "Pause is coming
     soon." No button.
   - no_value: "Talk to us for 15 minutes". Button "Book a call" opens
     `import.meta.env.VITE_CS_BOOKING_URL` in a new tab. If the env var is not
     set, the button does not show.
   - too_expensive: "See a smaller plan". Button "Compare plans" goes to
     `/settings?tab=subscription` (the same target as
     `src/components/AppHeader.tsx:269`).
   - other: "Tell us more". A `Textarea` with a 500-character limit and a label.
   - "Skip" moves on with `reason = null`. "Continue" moves on with the choice.
3. **Confirm.** A summary: integration, restaurant, reason. The
   `extraConfirmContent` slot shows here. Buttons: "Back" and a small
   destructive "Disconnect anyway".
   - While the call runs, the buttons are disabled and the dialog cannot close.
   - On error, the dialog stays open and shows the error text in an `Alert`.
   - On success, it closes and resets its state.

Accessibility: each radio has a label. The step indicator has
`aria-current="step"`. Focus moves to the step heading on each step change.

### 4.8 `IntegrationCard` and `Integrations` page

- The Disconnect button opens the dialog. It does not call the hook directly.
- Show the button only when `selectedRestaurant.role` is `owner` or `manager`.
  This matches RLS and the RPC. Other roles see the "Connected" badge only.
- `onReconnect` closes the dialog and calls the current `handleConnect`.
- `restaurantName` comes from `useRestaurantContext`.

### 4.9 Bank UI

- `DisconnectBankDialog` keeps its file and its props. Inside, it renders
  `DisconnectIntegrationDialog` with `kind='bank'`.
- The delete-data checkbox and its second confirmation move into
  `extraConfirmContent`.
- Its loop sends `recordEvent: true` and the reason only on the first id.

## 5. Tests

- **pgTAP** `supabase/tests/integration_events.sql`:
  - The table, the columns, and the CHECK constraints exist.
  - RLS: an owner and a manager can read rows. A chef and an outside user read 0
    rows. `authenticated` cannot INSERT, UPDATE, or DELETE.
  - The RPC as an owner:
    - Revel: `is_active` changes to false, and one event row has the reason.
    - Square: the row is deleted, and the event stays.
  - The RPC as a chef raises `42501`.
  - With no active connection, the RPC raises `P0002`.
  - `p_integration = 'bank'` raises `22023`. An unknown value also fails.
  - `record_integration_event` is not executable by `authenticated`.
  - Each test creates its own restaurant row and users.
- **Vitest:**
  - `tests/unit/integrationDisconnect.test.ts`: the helper RPC args, the error
    pass-through, and the notice that never throws.
  - One hook test file for each changed hook. Each checks the RPC call and that
    the old direct `.update` or `.delete` is gone.
  - `tests/unit/integrationDisconnectAlertHandler.test.ts`: the actor check, the
    claim skip, one email to each owner, Slack on and off, and the escaped HTML.
  - `tests/unit/DisconnectIntegrationDialog.test.tsx`: the steps, each
    next-step panel, skip, the 500-character limit, the error state, and the
    double-click guard.
- **E2E** `tests/e2e/integration-disconnect.spec.ts`:
  - Seed a Revel connection for a new test restaurant.
  - Open `/integrations`, click Disconnect, and go through the three steps with
    the reason "other".
  - Check that the card shows "Connect". Check that one `integration_events`
    row exists with the reason.
  - The alert function call can fail locally. The test does not depend on it.

## 6. Risks and open points

- **Owner-only vs owner and manager.** The permission model says only owners
  have `manage:integrations`. RLS allows managers. This PR keeps owner and
  manager, so that no current user loses access. Changing it to owner-only is a
  product decision for later.
- **Booking URL.** No booking link exists in the repo. The "Book a call" button
  needs `VITE_CS_BOOKING_URL`. Without it, the button does not show.
- **Slack.** No Slack webhook secret exists. The alert skips Slack until
  `CS_SLACK_WEBHOOK_URL` is set in the function secrets.
- **Lost alert.** If the browser closes after the RPC, no alert goes out. The
  row keeps `alerted_at IS NULL` for the PR 3 sweep.
- **Public repo.** The docs, tests, and PR body contain no tenant ids, names, or
  amounts.
