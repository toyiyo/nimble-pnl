# Keep open shift trades visible until someone takes them

Date: 2026-09-25
Status: Draft for review
Branch: `claude/quirky-dijkstra-ksy4au`

## Problem

An employee posts a shift for trade. The app sends one email and one web
push at that time. After that, nothing happens. As the shift date gets
closer, no employee sees the trade again unless they open the marketplace.
The marketplace is under the "More" tab. Many trades stay open until the
shift starts, and the poster must work the shift or the shift has no one.

## Current behavior (with citations)

- The client calls `send-shift-trade-notification` with `action:'created'`
  after the insert (`src/hooks/useShiftTrades.ts:73-84`).
- For an open trade, the function reads all active employees with an email
  (`supabase/functions/send-shift-trade-notification/index.ts:82-101`).
- The function sends a web push to all active employees except the poster
  (`supabase/functions/send-shift-trade-notification/index.ts:563-592`).
- Every trade notification links to `/employee/shifts`
  (`supabase/functions/send-shift-trade-notification/index.ts:20`).
- No cron job sends a reminder for an open trade. The trade cron that
  exists only expires trades, and only when `trade_auto_expire` is on
  (`supabase/migrations/20260903035000_shift_protection_auto_expire.sql:17-41`,
  `supabase/migrations/20260903034500_shift_protection_settings.sql:22`).
- The employee home screen is `/employee/schedule`. It shows a
  "Browse Available Shifts" button and the employee's own trades only
  (`src/pages/EmployeeSchedule.tsx:352-372`).
- The tab bar has Schedule, Pay, Clock and More. It shows no count
  (`src/components/employee/MobileTabBar.tsx:6-11`).
- The marketplace is a row under "More"
  (`src/pages/EmployeeMore.tsx:16`).
- `useMarketplaceTrades` returns every `open` trade with no target or with
  the caller as target (`src/hooks/useShiftTrades.ts:648-682`).
- The hook has no date filter, and it does not exclude the caller's own
  trades (`src/hooks/useShiftTrades.ts:659-686`).
- The hook sets `hasConflict` when the caller has an overlapping
  `scheduled` or `confirmed` shift (`src/hooks/useShiftTrades.ts:698-726`).
- `useAvailableShifts` calculates `tradeCount`. No component reads it
  (`src/hooks/useAvailableShifts.ts:58-63`).
- `accept_shift_trade` refuses an overlap with a `scheduled` or `confirmed`
  shift (`supabase/migrations/20260903034800_shift_protection_trade_functions.sql:276-290`).
- In `block` mode, `accept_shift_trade` refuses an accept inside
  `trade_deadline_hours`, except for holders of `edit:scheduling`
  (`supabase/migrations/20260903034800_shift_protection_trade_functions.sql:262-273`).
- The trade accept flow on the marketplace page checks the deadline rule
  and opens a confirm dialog before it calls the RPC
  (`src/pages/AvailableShiftsPage.tsx:347-363`).
- The notification matrix types are in `src/lib/notificationTypes.ts:10-27`
  and in `supabase/functions/_shared/resolveChannels.ts:11-28`. A CHECK
  constraint lists the same keys
  (`supabase/migrations/20260723130100_bank_reauth_notices.sql:80-100`).
- The cron-to-edge-function pattern is `cron.schedule` plus
  `net.http_post` with the service-role Bearer
  (`supabase/migrations/20260723130200_schedule_bank_reauth_notices.sql:188-210`).
- That function has `verify_jwt = false` (`supabase/config.toml:241-242`)
  and checks the Bearer with a timing-safe compare
  (`supabase/functions/bank-reauth-notices/index.ts:37-42`, `:70-80`).

## Goals

1. Show open trades that the employee can take on the employee home
   screen, with the time left before the shift.
2. Show a count badge in the employee navigation.
3. Send push reminders to eligible employees as the shift gets closer.
4. Tell managers (and the poster) when a trade is still open close to the
   shift, so a manager can assign the shift.

## Non-goals

- Reminders for open shifts (unassigned shifts that a manager posts). The
  manual `broadcast-open-shifts` flow stays as it is.
- Ranked "good fit" pushes.
- An in-app notification inbox.
- Changes to the accept, approve or expire rules.

## Design

### Part A: In-app visibility (frontend only)

#### A1. Pure selector: `src/lib/claimableTrades.ts`

```ts
export type TradeUrgency = 'urgent' | 'soon' | 'later';

export interface ClaimableTrade { trade: MarketplaceTrade; startsAt: Date; urgency: TradeUrgency; }

// Keep a trade only when:
//  - offered_by_employee_id !== employeeId (not my own trade)
//  - offered_shift.start_time > now (not started)
//  - hasConflict !== true (the RPC refuses an overlap)
// Sort by start time, soonest first.
export function selectClaimableTrades(trades, employeeId, now): ClaimableTrade[];

// urgent: starts in 24 h or less. soon: 72 h or less. later: more than 72 h.
export function tradeUrgency(startsAt: Date, now: Date): TradeUrgency;

// "Starts in 45 min", "Starts in 5 h", "Tomorrow · 5:00 PM", "Fri, Sep 26 · 5:00 PM".
// Uses the restaurant time zone.
export function tradeStartLabel(startsAt: Date, now: Date, tz: string): string;
```

#### A2. Hook: `useClaimableTrades(restaurantId, employeeId)`

- The hook wraps `useMarketplaceTrades`. It shares the same query key, so
  the home card, the badge and the marketplace page make one request.
- The hook reads `useNowTick(60_000)` so that a trade disappears when its
  shift starts. The lesson at `memory/lessons.md:806-812` requires a
  ticking `now` for time-based UI state.
- The hook returns `{ trades, count, loading, error }`.

#### A3. "Up for grabs" card on the employee home screen

- New component `src/components/employee/UpForGrabsCard.tsx`.
- Placement: in `EmployeeSchedule.tsx`, after `ScheduleStatusBanner` and
  before `MyShiftTradesCard`.
- The card shows the 3 soonest claimable trades. Each row shows the date,
  the time, the position, the poster name and the start label.
- An `urgent` row has an amber chip ("Starts in 5 h"). Other rows use the
  muted chip.
- Each row has a "View" button. The button links to
  `/employee/shifts?trade=<id>`.
- The card header shows "Shifts up for grabs" and the count. A
  "See all" link goes to `/employee/shifts`.
- States:
  - Loading: one skeleton row.
  - Error: one quiet line, "Could not load shifts up for grabs." The home
    screen stays usable.
  - Empty: the card does not render. The home screen already has the
    "Browse Available Shifts" button. An empty card adds noise to the
    screen that employees open most.
- The accept action stays on the marketplace page only. That page owns the
  deadline confirm dialog and the area warning
  (`src/pages/AvailableShiftsPage.tsx:347-363`, `:146-157`). One accept
  flow means one place to keep correct.

#### A4. Count badge

- `MobileTabBar`: the "More" tab shows a small count badge when the count
  is more than 0. The `aria-label` becomes "More, 2 shifts up for grabs".
- `EmployeeMore`: the "Shift Marketplace" row shows the same count at the
  right side.
- Both read `useClaimableTrades`. The badge uses semantic tokens
  (`bg-foreground text-background`), not direct colors.

#### A5. Deep link on the marketplace page

- `AvailableShiftsPage` reads the `trade` search param.
- When the item is in the list, the page calls
  `virtualizer.scrollToIndex(index, { align: 'center' })` one time, and
  the matching `TradeCard` gets a `ring-1 ring-foreground/40` outline.
- The page then deletes the param from the URL (`replace: true`), so a
  refresh does not scroll again.
- When the list loads and the trade is not in it, the page shows a toast:
  "That shift is no longer available." A trade leaves the list when
  someone accepts it, the poster cancels it, or it expires.
- `TradeCard` gets a new `highlighted` prop. The memo compare function
  must include it.

### Part B: Timed reminders (backend)

#### B1. Stages

`now` is the cron tick time. `h` is the hours from `now` to
`offered_shift.start_time`.

| Stage | Audience | Due when | Skip when |
|---|---|---|---|
| `72h` | eligible employees | `24 < h <= 72` | `created_at > start_time - 72h` |
| `24h` | eligible employees | `6 < h <= 24` | `created_at > start_time - 24h` |
| `6h` | eligible employees | `0 < h <= 6` | `created_at > start_time - 6h` |
| `unclaimed` | managers and the poster | `0 < h <= E` and `now - created_at >= 1h` | none |

- `E` (the escalation window) is 24 hours. When `trade_deadline_mode` is
  `block`, `E` is `GREATEST(24, trade_deadline_hours)`. Employees cannot
  accept inside the block window, so managers must hear about it before
  the window starts.
- The "skip" rule stops a reminder right after the post. The `created`
  notification already covers that window. Example: a trade posted 20 h
  before the shift gets no `24h` reminder, and it gets the `6h` reminder.
- A run sends only the one employee stage that is due now. It never sends
  an older stage that it missed.
- Employee stages are skipped when `trade_deadline_mode = 'block'` and
  `h <= trade_deadline_hours`. Employees cannot accept then.
- Quiet hours: no stage sends between 22:00 and 08:00 in the restaurant
  time zone (`restaurants.timezone`, default `America/Chicago`). A stage
  stays due. It sends at 08:00 if its window is still open.
- Only trades with `status = 'open'` get reminders. A `pending_approval`
  trade already has a taker.
- A directed trade (`target_employee_id` set) reminds only its target.

#### B2. Eligible employees

- Active employees of the restaurant with a `user_id`.
- Not the poster.
- No overlapping shift with `status IN ('scheduled','confirmed')`. This is
  the same test as `accept_shift_trade`
  (`supabase/migrations/20260903034800_shift_protection_trade_functions.sql:276-282`).
- For a directed trade: the target only, with the same overlap test.

#### B3. Channels

- New matrix type `shift_trade_reminder` (group "Trades"), channels
  `['push']`.
  - Push only. An email for each stage to the full roster is noise. Resend
    pacing (2/s, `supabase/functions/_shared/emailQueue.ts`) also makes a
    roster email too slow for a cron run.
- New matrix type `shift_trade_unclaimed` (group "Trades"), channels
  `['email','push']`.
  - The audience is small: owners, managers and the poster.
- Both types go through `resolveChannels`. An admin can turn them off in
  Settings → Notifications.
- The web push goes through `sendWebPushToUsers`
  (`supabase/functions/_shared/webPushHelper.ts:155`).
- The push URL is `/employee/shifts?trade=<id>`.
- The push `tag` is `trade-reminder-<id>`, so a new stage replaces the
  old one on the device.
- Push text:
  - `72h` and `24h`: title "Shift still up for grabs". Body
    "Fri 5:00 PM · Server. Tap to pick it up."
  - `6h`: title "Starts in 6 hours: shift needs cover". Same body shape.
  - `unclaimed` (managers): title "Nobody took this shift yet". Body
    "Maria's Fri 5:00 PM Server shift is still open."
  - `unclaimed` (poster): title "Your shift is still up for trade". Body
    "Nobody took it yet. You still work it unless a manager changes it."
- A draft shift (`is_published = false`) uses the existing
  `tentativePushBody` helper (`supabase/functions/_shared/draftTradeNote.ts`).
- Manager email: one message per recipient, through `sendPaced`, with the
  provider error redacted by `truncateError` (lesson
  `memory/lessons.md:2678-2681`).

#### B4. Database

New migration `supabase/migrations/20260925120000_shift_trade_reminders.sql`:

1. Table `public.shift_trade_reminders`:

   ```sql
   CREATE TABLE public.shift_trade_reminders (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
     shift_trade_id uuid NOT NULL REFERENCES public.shift_trades(id) ON DELETE CASCADE,
     stage text NOT NULL CHECK (stage IN ('72h','24h','6h','unclaimed')),
     sent_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (shift_trade_id, stage)
   );
   ```

   - RLS enabled. No policy for `authenticated`. `GRANT ALL` to
     `service_role` only. `REVOKE ALL` from `anon, authenticated`.
   - Index on `restaurant_id` for the FK.

2. `get_shift_trade_reminder_candidates(p_now timestamptz, p_limit int)`
   - `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
   - `REVOKE EXECUTE` from `PUBLIC, anon, authenticated`. `GRANT` to
     `service_role`.
   - Returns one row for each `(trade, stage)` that is due, with the stage
     rules in B1 applied in SQL. Columns: `shift_trade_id`,
     `restaurant_id`, `stage`, `start_time`, `end_time`, `position`,
     `is_published`, `offered_by_employee_id`, `offered_by_name`,
     `offered_by_user_id`, `target_employee_id`, `restaurant_name`,
     `restaurant_timezone`.
   - Excludes a `(trade, stage)` that already has a row in
     `shift_trade_reminders`.
   - Reads `staffing_settings` with a LEFT JOIN. A missing row uses the
     column defaults (`off`, 24).
   - `ORDER BY start_time ASC LIMIT p_limit`.

3. `claim_shift_trade_reminder(p_trade_id uuid, p_stage text) RETURNS boolean`
   - One statement:
     `INSERT ... SELECT ... FROM shift_trades WHERE id = p_trade_id AND status = 'open' ON CONFLICT (shift_trade_id, stage) DO NOTHING RETURNING id`.
   - Returns `true` only when the insert wrote a row.
   - Same security settings as item 2.

4. `get_shift_trade_reminder_audience(p_trade_id uuid)`
   - Returns `user_id` for the eligible employees in B2.
   - Same security settings as item 2.

5. `get_shift_trade_unclaimed_recipients(p_trade_id uuid)`
   - Returns `user_id` and `email` for `owner` and `manager` rows in
     `user_restaurants` of the trade's restaurant. It reads the email from
     `auth.users` inside the definer function. It does not use a
     PostgREST embed (lesson `memory/lessons.md:138-139`).
   - Same security settings as item 2.

6. Replace the `notification_channel_settings_type_check` constraint.
   Add `shift_trade_reminder` and `shift_trade_unclaimed` to the 17 keys.

7. `cron.schedule('shift-trade-reminders', '*/15 * * * *', ...)` with the
   `net.http_post` pattern. Unschedule first, so the migration can run
   again.

#### B5. Edge function `shift-trade-reminders`

- `supabase/functions/shift-trade-reminders/index.ts`: wires real clients.
- `supabase/functions/_shared/shiftTradeRemindersHandler.ts`: pure
  orchestration with injected dependencies, tested by vitest. This copies
  the `bankReauthNoticesHandler.ts` layout.
- `verify_jwt = false` in `supabase/config.toml`. The function checks the
  service-role Bearer with a timing-safe compare. It takes no input from
  the request body.
- Order for each candidate:
  1. `resolveChannels(restaurant, type)`. If all channels are off, skip
     the candidate and do not claim it.
  2. `claim_shift_trade_reminder`. If it returns `false`, skip. Another
     run sent it, or the trade is no longer open.
  3. Read the audience. Send the push (and the email for `unclaimed`).
  4. Log counts only. Never log an email address.
- The claim comes before the send. A crash after the claim loses that one
  reminder. A crash never sends the same stage twice. For a reminder, a
  lost message is better than a duplicate.
- One run handles at most 50 candidates (`p_limit = 50`). The rest stay
  due for the next tick, 15 minutes later.
- The function returns `{ candidates, claimed, pushed, emailed, skipped }`.

### Decision on shared state (TLA+ check)

The cron runs every 15 minutes. pg_cron does not wait for the edge
function, so two runs can overlap. An employee can accept the trade during
a run. These actors write the same `(trade, stage)` state.

- Spec: `specs/tla/shift-trade-reminders/ShiftTradeReminders.tla`.
- Invariants: `AtMostOneSendPerStage` (`sends <= 1`) and
  `NoClaimForClosedTrade`.
- Design config (`ClaimFirst = TRUE`): pass, 35 distinct states.
- Counterfactual (`ShiftTradeReminders_SendThenRecord.cfg`, the
  bank-reauth order): violation. Two runs read the candidate, both send,
  then both record.

```text
OK    ShiftTradeReminders: pass (expected pass; 35 distinct states found)
OK    ShiftTradeReminders_SendThenRecord: violation (expected violation; 26 distinct states found)
OK    ToastRollupWatermark: pass (expected pass; 275 distinct states found)
OK    ToastRollupWatermark_NoLastSync: violation (expected violation; 150 distinct states found)
---- 4/4 configs matched their EXPECT
```

The model allows one benign case. A run claims the stage, then an
employee accepts, then the run sends. The push links to the marketplace.
The deep link then shows "That shift is no longer available." We accept
this case.

## Testing

- Unit (`tests/unit/`):
  - `claimableTrades.test.ts`: selector filters (own, past, conflict),
    sort, urgency bounds, start labels across time zones and midnight.
  - `useClaimableTrades.test.ts`: count, loading, error, tick removal.
  - `shiftTradeRemindersHandler.test.ts`: channel gate, claim-before-send
    order, a lost claim skips the send, poster excluded, counts-only
    logs, `unclaimed` email per recipient.
  - `notificationTypes.test.ts` and `notificationActionTypes.test.ts`:
    extend for the two new keys.
- pgTAP (`supabase/tests/`):
  - Stage windows and the created-at skip rule.
  - Quiet hours in the restaurant time zone.
  - Block mode: employee stages skipped, escalation window widened.
  - Only `open` trades. A directed trade reminds only its target.
  - Audience excludes the poster, inactive employees and overlaps.
  - Claim returns `true` one time, then `false`. Claim returns `false`
    for a non-open trade.
  - `authenticated` cannot execute the RPCs or read the table.
  - The CHECK constraint accepts the two new keys.
- E2E (`tests/e2e/`):
  - `shift-trade-up-for-grabs.spec.ts`: employee A posts a trade.
    Employee B sees the "Shifts up for grabs" card and the More badge.
    B taps "View", the marketplace scrolls to the highlighted trade, and
    B accepts it.

## Rollout

- The migration schedules the cron. The first tick can send `72h`,
  `24h` or `6h` reminders for trades that are already open. That is the
  wanted result, and each stage sends at most one time.
- Admins can turn off both new types in Settings → Notifications.
- After deploy, check that `shift_trade_reminders` gets rows and that the
  function logs show `claimed > 0` when due trades exist (lesson
  `memory/lessons.md:933-936`).

## Decided trade-offs

- Employee reminders are push only. Employees without push get no
  reminder, but the home card and the badge still reach them.
- The home card does not accept in place. It deep-links to the one accept
  flow.
- An empty "Up for grabs" card does not render.
