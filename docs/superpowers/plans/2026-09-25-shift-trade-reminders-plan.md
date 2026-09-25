# Plan: shift trade reminders and home visibility

Design: `docs/superpowers/specs/2026-09-25-shift-trade-reminders-design.md`
Branch: `claude/quirky-dijkstra-ksy4au`

Each task is TDD: write the failing test, make it pass, commit. Run the
tasks in order. Stage explicit paths only.

## Backend

### Task 1: Migration — table, time zone helper, CHECK constraint

- Files: `supabase/migrations/20260925120000_shift_trade_reminders.sql`,
  `supabase/tests/66_shift_trade_reminders_schema.test.sql`.
- Test first: table exists with RLS on, `UNIQUE (shift_trade_id, stage)`,
  stage CHECK, `authenticated` cannot select, `safe_restaurant_tz` returns
  the fallback for NULL, `''` and `'Not/AZone'`, and returns a valid zone
  unchanged. The CHECK constraint accepts `shift_trade_reminder` and
  `shift_trade_unclaimed`.
- Build: design B4 items 1, 2 and 7.

### Task 2: Candidates RPC

- Files: same migration, `supabase/tests/67_shift_trade_reminder_candidates.test.sql`.
- Test first (fix `p_now`, seed trades at known offsets):
  - Each stage window and its lower and upper bound.
  - The created-at skip rule, and NULL `created_at`.
  - Quiet hours in the restaurant zone, and a garbage zone does not raise.
  - Block mode: employee stages skipped inside `trade_deadline_hours`;
    `unclaimed` due at `trade_deadline_hours + 12`.
  - `unclaimed` needs `now - created >= 1h`.
  - Only `open` trades on `scheduled`/`confirmed` shifts.
  - Channel settings off: no row. Missing settings row: row.
  - An existing reminder row hides that stage only.
  - `LIMIT` and `start_time` order.
  - `authenticated` cannot execute.
- Build: design B4 item 3.

### Task 3: Claim, audience and recipients RPCs

- Files: same migration, `supabase/tests/68_shift_trade_reminder_claim_audience.test.sql`.
- Test first:
  - Claim: `true` then `false` for the same stage; `false` for a non-open
    trade; `false` for a started shift; a second stage claims `true`.
  - Audience: excludes the poster, inactive employees, employees without
    `user_id`, and overlaps with `scheduled`/`confirmed`; includes a
    `cancelled` overlap; a directed trade returns only the target.
  - Recipients: the four scheduler roles each return; `staff` does not;
    a deleted user does not; the poster returns once with
    `kind = 'poster'` and not as a scheduler.
  - `authenticated` cannot execute any of them.
- Build: design B4 items 4, 5 and 6.

### Task 4: Cron schedule

- Files: same migration, extend test 66 with a check that
  `cron.job` has `shift-trade-reminders` at `*/15 * * * *`.
- Build: design B4 item 8. Add `[functions.shift-trade-reminders]
  verify_jwt = false` to `supabase/config.toml`.

### Task 5: Notification type catalog

- Files: `src/lib/notificationTypes.ts`,
  `supabase/functions/_shared/resolveChannels.ts`,
  `supabase/functions/_shared/notificationActionTypes.ts` (add
  `TRADE_REMINDER_TYPE` constants), `tests/unit/notificationTypes.test.ts`,
  `tests/unit/notificationActionTypes.test.ts`.
- Test first: both unions list the two new keys, and the matrix channels
  are `['push']` and `['email','push']`.

### Task 6: Reminder content builder

- Files: `supabase/functions/_shared/shiftTradeReminderContent.ts`,
  `tests/unit/shiftTradeReminderContent.test.ts`.
- Test first: title and body for each stage and audience; `{when}` from
  real hours; draft shift uses `tentativePushBody`; URL has `trade` and
  `restaurant`; tag is `trade-reminder-<id>`; the scheduler email HTML
  escapes names.

### Task 7: Reminder handler

- Files: `supabase/functions/_shared/shiftTradeRemindersHandler.ts`,
  `tests/unit/shiftTradeRemindersHandler.test.ts`.
- Test first (injected deps and clock):
  - Claim before send. A `false` claim skips the send.
  - Channel gate after the claim: all off counts `skipped`.
  - Run budget: wall-clock and push-target limits defer the rest.
  - Employee stages push the audience. `unclaimed` pushes schedulers and
    the poster with separate text, and emails schedulers one by one.
  - A failed send does not stop the loop. Logs hold counts and ids only.
  - The response counts.

### Task 8: Edge function entry

- Files: `supabase/functions/shift-trade-reminders/index.ts`.
- Wire real clients into the handler. Timing-safe Bearer check, 405 on
  non-POST, 500 on missing env. Run `deno check` if Deno is present.

## Frontend

### Task 9: Selector and label

- Files: `src/lib/claimableTrades.ts`, `tests/unit/claimableTrades.test.ts`.
- Test first: design A1 filters, sort, `urgent`, and each label row,
  including midnight and a restaurant zone that differs from UTC.

### Task 10: `useMarketplaceTrades` changes and `useClaimableTrades`

- Files: `src/hooks/useShiftTrades.ts`, `src/hooks/useClaimableTrades.ts`,
  `tests/unit/useClaimableTrades.test.ts`, and existing
  `tests/unit/useShiftTrades*.test.ts`.
- Test first: the hook is disabled with no employee; count and error; a
  trade drops out when the tick passes its start. The marketplace hook
  selects explicit columns, bounds the conflict read, and accepts
  `{ enabled }`.

### Task 11: `TradeCountBadge` and the nav badges

- Files: `src/components/employee/TradeCountBadge.tsx`,
  `src/components/employee/MobileTabBar.tsx`, `src/pages/EmployeeMore.tsx`,
  `src/components/AppSidebar.nav.ts`, `src/components/AppSidebar.tsx`,
  `tests/unit/TradeCountBadge.test.tsx`, `tests/unit/MobileTabBar.test.tsx`.
- Test first: `9+`, `aria-hidden`, the "More" tab accessible name with 0,
  1 and 2, and the new `staffNav` item.

### Task 12: `UpForGrabsCard` on the home screen

- Files: `src/components/employee/UpForGrabsCard.tsx`,
  `src/pages/EmployeeSchedule.tsx`, `tests/unit/UpForGrabsCard.test.tsx`.
- Test first: nothing on loading or empty; error with "Try again"; at most
  3 rows; urgent chip; link href and `aria-label`.

### Task 13: Marketplace deep link and error state

- Files: `src/hooks/useAvailableShifts.ts`, `src/pages/AvailableShiftsPage.tsx`,
  `src/lib/tradeDeepLink.ts` (pure decision helper),
  `tests/unit/tradeDeepLink.test.ts`.
- Test first (pure helper): decide `scroll`, `gone`, `switch-restaurant`
  or `foreign-restaurant` from the params, the load state and the items.
- Build: the error state, the param copy and delete, the scroll and focus,
  the highlight timeout, and the `highlighted` prop with the memo compare.

### Task 14: E2E

- Files: `tests/e2e/shift-trade-up-for-grabs.spec.ts`.
- Two employees in one restaurant. A posts a trade. B sees the card and
  the badge, taps "View", sees the highlighted trade, and accepts it.
  Follow `tests/e2e/shift-trade-accept.spec.ts` for the setup.

## Verify

- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- `npm run test:db` and `npm run test:e2e` need local Supabase. If the
  container cannot start it, say so in the PR and let CI run them.
- `.claude/skills/run-tla/tlc.sh all`.
