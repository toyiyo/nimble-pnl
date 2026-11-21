# Integration disconnect events and alerts (PR 1) — plan

Design: `docs/superpowers/specs/2026-11-21-integration-disconnect-events-design.md`
Branch: `feature/integration-disconnect-events`
Worktree: `.claude/worktrees/unruffled-knuth-0cbba5`

Use TDD for each task: write the failing test, run it, write the code, run it
again. Commit after each task. Stage explicit paths only. Never `git add -A`.
Put no tenant ids, names, emails, or amounts in code, tests, or commits.

## Task 1: table `integration_events`

Files: `supabase/migrations/20261121120000_integration_events.sql` (new),
`supabase/tests/integration_events.sql` (new)

Tests first (design §5, pgTAP part for the table):
- The table, the columns, and the CHECK constraints exist.
- `table_privs_are`: anon has none. authenticated has SELECT only.
- RLS as `authenticated` with `request.jwt.claims`: owner and manager read
  rows. chef, staff, kiosk, a collaborator, and an outside user read 0 rows.
  An owner of A reads 0 rows of B.

Code: design §4.1. Use the exact REVOKE and GRANT lines.

Run: `npm run db:reset`, then `npm run test:db`.

## Task 2: RPC `disconnect_integration`

Files: `supabase/migrations/20261121120100_disconnect_integration_rpc.sql`
(new), `supabase/tests/integration_events.sql`

Tests first (design §5, the RPC cases): Revel, Toast, Focus, Square with
`square_locations`, two Shift4 rows, manager allowed, denied roles, no uid,
cross-tenant, second call `P0002`, `22023` cases, trim and NULL rules,
`actor_user_id`, `search_path` in `proconfig`, anon cannot execute.

Code: design §4.2.

## Task 3: RPC `record_integration_event` and `integration_alert_recipients`

Files: `supabase/migrations/20261121120200_record_integration_event.sql` (new),
`supabase/tests/integration_events.sql`

Tests first: `function_privs_are` for both functions (anon and authenticated
denied, service_role allowed). As service_role: insert works, the 60-second
dedupe returns the same id, a bad reason raises `22023`.

Code: design §4.3 and §4.5 step 5. Add the dependency comment to
`bank_reauth_notice_recipients` with `COMMENT ON FUNCTION` in this migration.

Then regenerate `src/integrations/supabase/types.ts` (sync-types skill) and
commit it.

## Task 4: client helper `src/lib/integrationDisconnect.ts`

Files: `src/lib/integrationDisconnect.ts` (new),
`tests/unit/integrationDisconnect.test.ts` (new)

Tests first: RPC args, error pass-through, `P0002` to
`AlreadyDisconnectedError`, the notice checks `error`, logs it, and never
throws. Reason labels match design §4.7 step 2.

Code: design §4.6 first bullet.

## Task 5: Revel hook and wizard rollback

Files: `src/hooks/useRevelConnection.tsx`, `src/components/pos/RevelSetupWizard.tsx`,
`tests/unit/useRevelConnection.test.tsx` (new)

Tests first: `disconnectRevel` calls the helper with the reason, invalidates
`['revel-connection', restaurantId]`, shows one success toast, rethrows, and
calls the notice without `await`. `rollbackRevelConnection` does the direct
UPDATE, shows no toast, and never calls the RPC.

Code: design §4.6. Change the wizard to `rollbackRevelConnection`.

## Task 6: Toast and Focus hooks

Files: `src/hooks/useToastConnection.tsx`, `src/hooks/useFocusConnection.tsx`,
`src/hooks/useToastIntegration.tsx`, `tests/unit/useToastConnection.test.tsx`,
`tests/unit/useFocusConnection.test.tsx`

Tests first: rewrite the disconnect cases that assert `.update`
(`useToastConnection.test.tsx:294-340` and the Focus cases). Same checks as
Task 5.

Code: design §4.6. Delete the `throw error` in the Toast `onError`. Delete the
unused `useToastIntegration.disconnectToast`.

## Task 7: Square, Clover, and Shift4 hooks

Files: `src/hooks/useSquareIntegration.tsx`, `src/hooks/useCloverIntegration.tsx`,
`src/hooks/useShift4Integration.tsx`, `tests/unit/useSquareIntegration.test.tsx`
(new), `tests/unit/useCloverIntegration.test.tsx` (new),
`tests/unit/useShift4Integration.test.tsx`

Tests first: the helper call, the local state reset after success, one success
toast, no error toast, the rethrow, `AlreadyDisconnectedError` as success.
Rewrite `useShift4Integration.test.tsx:271-356`.

Code: design §4.6.

## Task 8: shared dialog

Files: `src/components/integrations/DisconnectIntegrationDialog.tsx` (new),
`tests/unit/DisconnectIntegrationDialog.test.tsx` (new), `.env.example`

Tests first: design §5, the dialog list. Check that the test setup mocks
`ResizeObserver` and `scrollIntoView`. Add the mocks to the test file if not.

Code: design §4.7. Add `VITE_CS_BOOKING_URL=""` to `.env.example`.

## Task 9: `IntegrationCard` wiring and role gate

Files: `src/components/IntegrationCard.tsx`,
`tests/unit/IntegrationCard.disconnect.test.tsx` (new)

Tests first: owner and manager see Disconnect. chef, `collaborator_*`, and an
undefined role do not, and see the hint text. Configure stays visible. The
dialog `onConfirm` uses the `restaurantId` stored at open. Sling keeps the
direct call.

Code: design §4.0 and §4.8.

## Task 10: bank edge function

Files: `supabase/functions/stripe-disconnect-bank/index.ts`, plus a shared
module with the input checks if the function has no testable seam
(`supabase/functions/_shared/disconnectBankInput.ts`, new),
`tests/unit/disconnectBankInput.test.ts` (new)

Tests first: reason in the list, text trimmed and capped, 400 on a bad value,
`recordEvent` calls `record_integration_event` only after Stripe succeeds, an
RPC failure returns `eventId: null`.

Code: design §4.4.

## Task 11: bank hook and bank dialog

Files: `src/hooks/useStripeFinancialConnections.tsx`,
`src/components/banking/DisconnectBankDialog.tsx`,
`src/components/banking/BankConnectionCard.tsx`, `src/pages/Banking.tsx`,
`src/pages/Accounting.tsx`, `tests/unit/DisconnectBankDialog.test.tsx` (new),
`tests/unit/bankConnectionCard.test.tsx`

Tests first: options pass through, `eventId` starts the notice, the loop sends
`recordEvent` until it gets an `eventId` and stops at the first failure,
`confirmDisabled` follows `canProceed`, the state resets on close.

Code: design §4.4, §4.6 last bullet, and §4.9.

## Task 12: alert edge function

Files: `supabase/functions/_shared/integrationDisconnectAlertContent.ts` (new),
`supabase/functions/_shared/integrationDisconnectAlertHandler.ts` (new),
`supabase/functions/notify-integration-disconnect/index.ts` (new),
`supabase/config.toml`, `tests/unit/integrationDisconnectAlertHandler.test.ts`
(new), `tests/unit/integrationDisconnectAlertContent.test.ts` (new)

Tests first: design §5, the handler list.

Code: design §4.5. Add `[functions.notify-integration-disconnect]
verify_jwt = true` to `config.toml`. Follow the structure of
`bankReauthNoticesHandler.ts`.

## Task 13: E2E

Files: `tests/helpers/e2e-supabase.ts`, `tests/e2e/integration-disconnect.spec.ts`
(new)

Tests: design §5, the E2E list. Add `seedRevelConnection`.

Run: `npx playwright test tests/e2e/integration-disconnect.spec.ts --reporter=line`
in the foreground with the dev server trapped (CLAUDE.md "No Unbounded Waits").

## Task 14: full check

Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:db`, and
`npm run build`. Fix all failures.

## PR body notes

- Name the new function secret `CS_SLACK_WEBHOOK_URL` and the new client
  variable `VITE_CS_BOOKING_URL`. Both are optional. Give no values.
- State the Shift4 behavior change and the Sling scope.
- State the open point: owner and manager vs owner-only.
