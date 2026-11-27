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

Revision 2 adds the findings of the Supabase and frontend design reviews.

### 4.0 Scope of integrations

- PR 1 covers revel, toast, square, clover, shift4, focus, and bank.
- Sling (`sling-scheduling`) uses the same Disconnect button
  (`IntegrationCard.tsx:209-212`). Sling is a scheduling integration, not a
  sales source. It keeps its current direct path, with no dialog and no event.
  Sling events are a follow-up.
- A card with no hook keeps the current generic toast.

### 4.1 Table `public.integration_events`

```sql
id               uuid PK DEFAULT gen_random_uuid()
restaurant_id    uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE
integration      text NOT NULL CHECK (integration IN
                   ('revel','toast','square','clover','shift4','focus','bank'))
event            text NOT NULL CHECK (event IN
                   ('connect','disconnect','pause','resume','auth_failure'))
actor_user_id    uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
reason           text NULL CHECK (reason IN ('switching_pos','credentials_changed',
                   'temporary_close','no_value','too_expensive','other'))
reason_text      text NULL CHECK (char_length(reason_text) <= 500)
details          jsonb NOT NULL DEFAULT '{}'
alert_claimed_at timestamptz NULL   -- lease start for the Day-0 alert
alerted_at       timestamptz NULL   -- set only after the alert sends finish
created_at       timestamptz NOT NULL DEFAULT now()
```

- Use `text` with `CHECK`, not a Postgres enum.
- `reason` is NULL when the user skips the reason.
- `details` holds a snapshot that stays after a DELETE. Examples:
  `rows_affected`, `merchant_ids` or `establishment_ids`, `location_count`,
  `connected_at`, and the bank institution name. It never holds tokens or
  secrets.
- Index `(restaurant_id, created_at DESC)`. PR 3 adds a partial index for the
  alert sweep.
- The table has no FK to a connection row, so the event stays after a DELETE.
- `ON DELETE CASCADE` on `restaurant_id` is intentional. When a restaurant is
  deleted, its audit rows go with it, the same as all other tenant data.
- RLS is on. One policy: `FOR SELECT TO authenticated USING
  (user_has_role(restaurant_id, ARRAY['owner','manager']))`. No write policy.
- Grants (the repo lesson in
  `20260804120000_review_funnel_service_role_grants.sql`):
  - `REVOKE ALL ON integration_events FROM PUBLIC, anon, authenticated, service_role`.
  - `GRANT SELECT ON integration_events TO authenticated`.
  - `GRANT SELECT, INSERT ON integration_events TO service_role`.
  - `GRANT UPDATE (alert_claimed_at, alerted_at) ON integration_events TO service_role`.
- PR 1 writes `disconnect` events only.
- Regenerate `src/integrations/supabase/types.ts` (the sync-types skill).

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
3. Check `p_integration` against a fixed map. Raise `22023` for `bank` and for
   any value not in the map.
4. Treat `''` as NULL for `p_reason`. Raise `22023` for a reason not in the
   list. Trim `p_reason_text`. Set it to NULL when blank. Raise `22023` when it
   is longer than 500 characters.
5. Read the snapshot for `details` (ids and `connected_at`) before the change.
6. Change the connection. All rows for the restaurant change:
   - revel, toast, focus: `UPDATE public.<tbl> SET is_active = false,
     updated_at = now() WHERE restaurant_id = p_restaurant_id AND is_active`.
   - square, clover, shift4: `DELETE FROM public.<tbl> WHERE restaurant_id =
     p_restaurant_id`. This keeps the current cascades.
   - Shift4 change: the hook deletes one row by `id` today
     (`useShift4Integration.tsx:147-180`). A restaurant can have more than one
     Shift4 row (`UNIQUE(restaurant_id, merchant_id)`). The card shows one
     connection, so "Disconnect Shift4" deletes all rows for the restaurant.
     `details.rows_affected` and `details.merchant_ids` record them.
7. `GET DIAGNOSTICS v_rows = ROW_COUNT`. If it is 0, raise `P0002` with the
   message `no active <integration> connection`.
8. Insert the event with `actor_user_id = auth.uid()`. Return its id.

- `REVOKE ALL ... FROM PUBLIC, anon`. `GRANT EXECUTE ... TO authenticated`.
- Build the dynamic SQL with `format('%I.%I', 'public', tbl)` from the fixed
  map only. The migration comment states "no EXECUTE with concatenated input".

### 4.3 RPC `public.record_integration_event` (service role only)

```sql
record_integration_event(p_restaurant_id uuid, p_integration text, p_event text,
  p_actor_user_id uuid, p_reason text, p_reason_text text, p_details jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
```

- `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated`.
  `GRANT EXECUTE ON FUNCTION ... TO service_role`. Without the REVOKE, any
  signed-in user could forge an event and send an alert to another tenant.
- SECURITY INVOKER is enough, because only service_role calls it.
- It does the same reason checks as §4.2 step 4.
- Dedupe: if an event with the same restaurant, integration, event, and actor
  exists from the last 60 seconds, it returns that id and inserts nothing.

### 4.4 Bank flow

- `stripe-disconnect-bank` accepts the optional fields `reason`, `reasonText`,
  and `recordEvent`.
- It checks `reason` against the list and trims `reasonText` to at most 500
  characters. It returns 400 for a bad value. It does not rely on the CHECK.
- When `recordEvent` is true and the Stripe call succeeds, it calls
  `record_integration_event` with
  `details = { institution_name, stripe_financial_connections_account_id }`.
  It returns `eventId`.
- If `record_integration_event` fails, the disconnect still succeeds. The
  function logs the error and returns `eventId: null`.
- `DisconnectBankDialog` loops over the bank ids of one institution. It sends
  `recordEvent: true` until one call returns an `eventId`. It stops the loop at
  the first failure. Result: one event for each institution, also when the
  first id fails.
- The 60-second dedupe (§4.3) stops a client that sends `recordEvent` on every
  id from making many alerts.

### 4.5 Edge function `notify-integration-disconnect`

- Input: `{ eventId }`. `config.toml` gets
  `[functions.notify-integration-disconnect] verify_jwt = true`.
- CORS handling follows `notify-schedule-published`.
- Logic lives in `_shared/integrationDisconnectAlertHandler.ts` with injected
  deps. The content lives in `_shared/integrationDisconnectAlertContent.ts`.
  `index.ts` only wires real clients.

Steps:
1. Check that `eventId` is a UUID. Else return 400.
2. Get the caller with `auth.getUser()`.
3. Load the event with the service client. Return the same 404 when the event
   does not exist, when `actor_user_id` is not the caller, when `event` is not
   `disconnect`, or when the event is older than 1 hour. This stops id probes.
4. Claim the alert with a lease:
   `UPDATE integration_events SET alert_claimed_at = now() WHERE id = $1 AND
   alerted_at IS NULL AND (alert_claimed_at IS NULL OR alert_claimed_at <
   now() - interval '5 minutes') RETURNING id`.
   If no row returns, return `{ skipped: 'already_alerted' }`.
5. Load the owners with a new service-role-only wrapper
   `integration_alert_recipients(p_restaurant_id)`. It calls
   `bank_reauth_notice_recipients(p_restaurant_id, ARRAY['owner'])`. A comment
   on both functions names the dependency.
6. Load the restaurant name and time zone, and the actor name and email. If the
   actor is NULL, use "A team member".
7. Send one email to each owner with `sendPaced` and `sendEmailResult`.
   - This is a security alert. It ignores notification preferences.
   - Subject: `<Integration> was disconnected from <restaurant>`.
   - Body: who, when (restaurant time zone), the integration, the reason
     label, and the reason text if it exists.
   - CTA: "Reconnect" to `${APP_URL}/integrations`.
8. If `CS_SLACK_WEBHOOK_URL` is set, post one message:
   - Use `blocks` with `plain_text` fields for the restaurant name and the
     reason text. Escape `&`, `<`, and `>` in any `mrkdwn` text. Set
     `link_names: false`. Cap the reason text at 500 characters again.
   - Use a 3-second `AbortController` timeout.
   - If the variable is not set, log `slack_skipped` and continue.
9. If at least one email or the Slack post succeeds, set `alerted_at = now()`.
   If all sends fail, leave `alerted_at` NULL. The lease then expires, and the
   PR 3 sweep can retry the row.
10. Return counts only: emails sent, emails failed, Slack status. No emails.

- Zero owners is not an error. Slack still goes out.
- The Slack message holds the restaurant id, the actor email, and free text.
  It goes to an internal CS channel only.
- Function secret to add: `CS_SLACK_WEBHOOK_URL`. It stays out of
  `config.toml`, `.env.example`, tests, and the PR body (only its name).

### 4.6 Client: shared helper and hooks

- New file `src/lib/integrationDisconnect.ts`:
  - `disconnectIntegration({ restaurantId, integration, reason, reasonText })`
    calls the RPC. It throws on error. It returns the event id. A `P0002` error
    becomes an `AlreadyDisconnectedError`.
  - `notifyIntegrationDisconnect(eventId)` invokes the edge function. It
    checks the returned `error` (invoke does not throw for non-2xx), logs it,
    and never throws. `skipped` results are not errors.
  - Shared types `IntegrationKey` and `DisconnectReason`, and the reason labels.
  - The helper never invalidates queries. The hook does.
- Each POS hook keeps its public function name and takes an optional
  `{ reason, reasonText }` argument. It calls the helper, then calls
  `notifyIntegrationDisconnect` without `await`.
- Toasts: the hook shows the one success toast. The hook shows no error toast
  for a disconnect. It rethrows, and the dialog shows the error in an `Alert`.
  `AlreadyDisconnectedError` counts as success: the hook resets its state and
  shows "Already disconnected".
- State and cache, per hook:
  - Revel: invalidate `['revel-connection', restaurantId]`.
  - Toast: invalidate `['toast-connection', restaurantId]`. Delete the
    `throw error` inside `onError` (`useToastConnection.tsx:182-189`).
  - Focus: invalidate `['focus-connection', restaurantId]`.
  - Square, Clover, Shift4: keep the local `setConnection(null)` and
    `setIsConnected(false)` after the RPC succeeds. They use no React Query.
- The Revel wizard rollback changes. `RevelSetupWizard.tsx:26,49` calls a new
  hook function, `rollbackRevelConnection`. It keeps the direct UPDATE,
  invalidates `['revel-connection', restaurantId]`, writes no event, and shows
  no toast. A failed setup is not a disconnect.
- Delete the unused `useToastIntegration.disconnectToast`
  (`useToastIntegration.tsx:101-128`). It is a hard DELETE with no callers and
  no event.
- `useStripeFinancialConnections.disconnectBank(bankId, deleteData, opts?)`
  with `type DisconnectBankOptions = { reason?, reasonText?, recordEvent? }`.
  It returns `{ eventId }`. It invalidates `['connectedBanks', restaurantId]`.
  `Banking.tsx:495` and `Accounting.tsx:230` pass the new signature through.

### 4.7 Shared dialog `DisconnectIntegrationDialog`

File: `src/components/integrations/DisconnectIntegrationDialog.tsx`.

Props:

```ts
{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationName: string;          // "Revel", "Chase"
  restaurantName: string;
  kind: 'pos' | 'bank';
  onConfirm: (r: { reason: DisconnectReason | null; reasonText: string | null }) => Promise<void>;
  onReconnect?: () => void;         // credentials_changed next step
  extraConfirmContent?: ReactNode;  // bank: the delete-data checkbox
  confirmDisabled?: boolean;        // bank: true until the second checkbox is set
  confirmLabel?: string;            // default "Disconnect anyway"
}
```

Structure and style:
- Use `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, and
  `DialogDescription` with the CLAUDE.md classes: `p-0 gap-0
  border-border/40`, `text-[17px]` title, `text-[13px]` description,
  `text-[12px] uppercase tracking-wider` labels.
- Layout: `max-h-[80vh] flex flex-col`. Header and footer are `shrink-0`. The
  body is `overflow-y-auto`. Footer buttons stack below `sm`. The primary
  button is always visible at 375x667.
- Semantic tokens only. No amber. "Skip", "Back", and "Cancel" use the ghost
  style. The confirm button uses `variant="destructive"`.

Steps. A step indicator shows three labelled steps with `aria-current="step"`
and the screen-reader text "Step N of 3". It does not use color alone.

1. **Impact.**
   - POS: "Sales stop syncing today. These reports stop updating:" P&L and
     daily sales, food cost % and labor %, tip pooling and break-even.
   - Bank: "Transactions stop syncing today." Bank balances, cash flow, and
     expense categorization.
   - Buttons: "Cancel" and "Continue".
2. **Reason.** A `RadioGroup` with six choices. Each row has `min-h-11`. The
   next-step panel shows below the selected row:
   - `switching_pos` "I am switching to a different POS": "Keep your history
     when you switch." Button "Keep my connection" closes the dialog with no
     change.
   - `credentials_changed` "My credentials changed": "Reconnect instead."
     Button "Update credentials" closes the dialog, then calls `onReconnect`.
   - `temporary_close` "We are closed for a while": "Pause the sync instead.
     Pause is coming soon." No button.
   - `no_value` "I do not get value from it": "Talk to us for 15 minutes."
     Button "Book a call" opens `VITE_CS_BOOKING_URL` in a new tab with
     `rel="noopener noreferrer"`. The button does not show when the variable is
     not set. `.env.example` gets the variable name with an empty value.
   - `too_expensive` "It costs too much": "See a smaller plan." Button "Compare
     plans" closes the dialog and calls `navigate('/settings?tab=subscription')`
     (the same target as `src/components/AppHeader.tsx:269`).
   - `other` "Other": a labelled `Textarea` with `maxLength={500}` and a
     visible "N/500" counter.
   - Buttons: "Back", "Skip" (moves on with `reason = null`), and "Continue".
     Continue works for every choice.
3. **Confirm.** A summary: integration, restaurant, reason. The
   `extraConfirmContent` slot shows here. Buttons: "Back" (returns to step 2
   and keeps the choice) and the confirm button.
   - While the call runs, the confirm button shows a `Loader2` spinner and
     "Disconnecting…". All buttons are disabled. A `useRef` in-flight flag
     blocks a second call before React renders again.
   - While the call runs, the dialog does not close. `onOpenChange(false)` is
     ignored, and `onEscapeKeyDown` and `onInteractOutside` call
     `preventDefault`.
   - On error, the dialog stays open. It shows the error text in an `Alert`
     with `role="alert"`.
   - On success, it closes. Each close resets the step, the reason, the text,
     and the error.

Accessibility: each radio has a label. Each step heading has `tabIndex={-1}`.
Focus moves to the heading on each step change.

### 4.8 `IntegrationCard` and `Integrations` page

- For the six POS keys, the Disconnect button opens the dialog. Sling keeps its
  current direct call (§4.0).
- The card reads `selectedRestaurant` from `useRestaurantContext()`. It does
  not take a new prop.
- The role is the legacy text column `selectedRestaurant.role`
  (`src/hooks/useRestaurants.tsx:105`), the same value that `user_has_role`
  checks. A custom role record lives in `roleRecord` and is not used here.
- Show the button only when the role is `owner` or `manager`. While the context
  loads, `role` is `undefined`, so the button does not show and does not
  flash.
- Other roles see the "Connected" badge and the text "Ask an owner or manager
  to disconnect." The role gate does not hide "Configure".
- When the dialog opens, the card stores `restaurantId` and the restaurant
  name. `onConfirm` uses the stored id, not the context at confirm time. A
  restaurant switch while the dialog is open cannot disconnect the wrong
  tenant.
- `onReconnect` calls the current `handleConnect`.

### 4.9 Bank UI

- `DisconnectBankDialog` keeps its file. It renders `DisconnectIntegrationDialog`
  with `kind='bank'`.
- It drops `AlertDialogTrigger`, `children`, and the uncontrolled mode. The
  only caller, `BankConnectionCard.tsx:377-386`, is controlled.
- The `onDisconnect` prop type changes to
  `(bankId: string, deleteData: boolean, opts?: DisconnectBankOptions) => Promise<{ eventId: string | null }>`.
- The delete-data checkbox and its second confirmation checkbox move into
  `extraConfirmContent`. `confirmDisabled` gets `!canProceed`.
  `confirmLabel` is "Disconnect and delete data" when `deleteData` is set.
- The wrapper resets `deleteData` and `confirmDelete` on each close.
- `restaurantName` comes from `selectedRestaurant.restaurant.name`.

## 5. Tests

- **pgTAP** `supabase/tests/integration_events.sql`. Role tests use
  `SET LOCAL ROLE authenticated` plus `request.jwt.claims`. Service tests use
  `SET LOCAL ROLE service_role`. The default `postgres` role hides grant bugs.
  - The table, the columns, and the CHECK constraints exist.
  - `table_privs_are`: anon has none, authenticated has SELECT only.
  - RLS: an owner and a manager read rows. A chef, staff, kiosk, a
    collaborator, and an outside user read 0 rows. An owner of restaurant A
    reads 0 rows of restaurant B.
  - `function_privs_are`: anon cannot execute `disconnect_integration`.
    anon and authenticated cannot execute `record_integration_event`.
    service_role can.
  - Both functions have `search_path` in `proconfig`.
  - The RPC as an owner:
    - Revel, Toast, Focus: `is_active` changes to false, and one event row has
      the reason and `actor_user_id = auth.uid()`.
    - Square: the row and its `square_locations` rows are deleted. The event
      row stays.
    - Shift4 with two rows: both rows are deleted, and `details.rows_affected`
      is 2.
  - The RPC as a manager works. As a chef, staff, kiosk, or collaborator it
    raises `42501`. With no `auth.uid()` it raises `42501`.
  - Cross-tenant: an owner of A calls it for B and gets `42501`. B's row does
    not change.
  - A second disconnect raises `P0002`.
  - `bank` and an unknown integration raise `22023`. An invalid reason raises
    `22023`. `''` becomes NULL. A blank reason text becomes NULL, and the text
    is trimmed. 501 characters raises `22023`.
  - `record_integration_event` as service_role inserts a row. A second call
    within 60 seconds returns the same id.
  - Each test creates its own restaurant row and users.
- **Vitest:**
  - `tests/unit/integrationDisconnect.test.ts`: the RPC args, the error
    pass-through, the `AlreadyDisconnectedError` mapping, and the notice that
    checks `error` and never throws.
  - New hook test files: `useRevelConnection.test.tsx`,
    `useSquareIntegration.test.tsx`, `useCloverIntegration.test.tsx`. Each
    checks the RPC call, the state reset, the one success toast, and the
    rethrow.
  - Tests to rewrite: `useToastConnection.test.tsx:294-340`,
    `useShift4Integration.test.tsx:271-356`, and the disconnect cases in
    `useFocusConnection.test.tsx`. They assert the old direct `.update` and
    `.delete`.
  - The Revel wizard rollback calls `rollbackRevelConnection` and never calls
    the RPC.
  - `useStripeFinancialConnections`: the options pass through, and `eventId`
    triggers the notice.
  - `tests/unit/integrationDisconnectAlertHandler.test.ts`: the UUID check,
    the same 404 for a missing event and a wrong actor, the 1-hour window, the
    lease claim and skip, one email to each owner, zero owners, the
    null-actor fallback, Slack on and off, Slack escape with `<!channel>` and
    `<script>` input, the Slack timeout, and `alerted_at` stays NULL when all
    sends fail.
  - `tests/unit/DisconnectIntegrationDialog.test.tsx`: the steps, Back keeps the
    choice, each next-step panel, the booking button hidden without the
    variable, skip, the 500-character limit, the error `Alert`, the double-click
    guard, no close while pending, reset on close, and `confirmDisabled`. Check
    that the test setup mocks `ResizeObserver` and `scrollIntoView`.
  - `IntegrationCard` role gate: owner and manager see Disconnect. Chef and
    `collaborator_*` do not. An undefined role does not show it.
  - `DisconnectBankDialog`: the loop sends `recordEvent` until it gets an
    `eventId`, and stops at the first failure.
- **E2E** `tests/e2e/integration-disconnect.spec.ts`:
  - New helper `seedRevelConnection(page, restaurantId)` in
    `tests/helpers/e2e-supabase.ts`. It inserts through `window.__supabase` as
    the signed-in owner: `revel_instance: 'e2e-test'`, `establishment_id: ''`,
    `is_active: true`. The key columns are nullable.
  - Intercept `notify-integration-disconnect` with `page.route` and return
    200.
  - Owner path: open `/integrations`, wait for the Disconnect button, and go
    through the three steps with the reason "other". Check that the card shows
    "Connect". Read the event row through `window.__supabase` and check the
    reason.
  - Chef path: `setUserRole(page, 'chef')`. Check that no Disconnect button
    shows.
  - Mobile: run the owner path at 375x667. The confirm button is reachable.
  - Use `getByRole('dialog')`, `getByRole('radio', { name })`, and
    `getByLabel`. Use no fixed delays.

## 6. Risks and open points

- **Owner-only vs owner and manager.** The permission model says only owners
  have `manage:integrations`. RLS allows managers. This PR keeps owner and
  manager, so that no current user loses access. Changing it to owner-only is a
  product decision for later.
- **Booking URL.** No booking link exists in the repo. The "Book a call" button
  needs `VITE_CS_BOOKING_URL`. Without it, the button does not show.
- **Slack.** No Slack webhook secret exists. The alert skips Slack until
  `CS_SLACK_WEBHOOK_URL` is set in the function secrets. The message sends
  tenant data to Slack. CS must accept this for an internal channel.
- **Lost alert.** If the browser closes after the RPC, no alert goes out. If
  all sends fail, `alerted_at` stays NULL. PR 3 adds a sweep for rows with
  `alerted_at IS NULL`.
- **Shift4 behavior change.** Disconnect now deletes all Shift4 rows for the
  restaurant, not one row by id (§4.2 step 6).
- **Sling.** Sling keeps its old path and records no event (§4.0).
- **Public repo.** The docs, tests, and PR body contain no tenant ids, names,
  emails, or amounts.
