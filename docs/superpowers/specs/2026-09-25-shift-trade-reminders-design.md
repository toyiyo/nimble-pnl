# Keep open shift trades visible until someone takes them

Date: 2026-09-25
Status: Revised after Phase 2.5 design review
Branch: `claude/quirky-dijkstra-ksy4au`

## Problem

An employee posts a shift for trade. The app sends one email and one web
push at that time. After that, nothing happens. As the shift date gets
closer, no employee sees the trade again unless they open the marketplace.
On a phone, the marketplace is under the "More" tab. On a desktop, staff
have no marketplace link in the sidebar. Many trades stay open until the
shift starts. Then the poster must work the shift, or nobody works it.

## Current behavior (with citations)

- The client calls `send-shift-trade-notification` with `action:'created'`
  after the insert (`src/hooks/useShiftTrades.ts:348`, `:399`). The helper
  that calls the function is at `src/hooks/useShiftTrades.ts:73-84`.
- For an open trade, the function reads all active employees with an email
  (`supabase/functions/send-shift-trade-notification/index.ts:82-101`).
- The function sends a web push to all active employees except the poster
  (`supabase/functions/send-shift-trade-notification/index.ts:563-592`).
- Every trade notification links to `/employee/shifts`
  (`supabase/functions/send-shift-trade-notification/index.ts:20`).
- No cron job sends a reminder for an open trade. The only trade cron
  expires trades (`supabase/migrations/20260903035000_shift_protection_auto_expire.sql:17-41`,
  scheduled at `:59`). It runs only when `trade_auto_expire` is on
  (`supabase/migrations/20260903034500_shift_protection_settings.sql:22`).
- The employee home screen is `/employee/schedule`. It shows a
  "Browse Available Shifts" button and the employee's own trades only
  (`src/pages/EmployeeSchedule.tsx:352-372`).
- The mobile tab bar has Schedule, Pay, Clock and More. It shows no count
  (`src/components/employee/MobileTabBar.tsx:6-11`). Each tab sets
  `aria-label={tab.label}` (`src/components/employee/MobileTabBar.tsx:44`).
- `MobileTabBar` reads only `useLocation`
  (`src/components/employee/MobileTabBar.tsx:15-16`). It renders inside
  `RestaurantProvider` (`src/App.tsx:161-167`, `src/components/employee/MobileLayout.tsx:80`).
- `MobileLayout` mounts only for staff (or work mode) under 768 px
  (`src/App.tsx:100-103`, `src/hooks/use-mobile.tsx:3`). At 768 px and
  wider, staff get `AppSidebar` with `staffNav`
  (`src/components/AppSidebar.nav.ts:112-121`). `staffNav` has no
  `/employee/shifts` item.
- The marketplace is a row under "More" (`src/pages/EmployeeMore.tsx:16`).
  The row `<Link>` has no `aria-label` (`src/pages/EmployeeMore.tsx:31-46`).
- `useMarketplaceTrades` returns every `open` trade with no target or with
  the caller as target (`src/hooks/useShiftTrades.ts:648-682`). It selects
  `*` (`src/hooks/useShiftTrades.ts:661-662`).
- The hook has no date filter, and it does not exclude the caller's own
  trades (`src/hooks/useShiftTrades.ts:659-686`).
- The hook sets `hasConflict` when the caller has an overlapping
  `scheduled` or `confirmed` shift (`src/hooks/useShiftTrades.ts:698-726`).
  The shift read in that step has no date bound
  (`src/hooks/useShiftTrades.ts:697-701`).
- The hook uses `enabled: !!restaurantId`, the key
  `['marketplace_trades', restaurantId, currentEmployeeId]` and
  `staleTime: 30000` (`src/hooks/useShiftTrades.ts:654`, `:731-733`).
- `useAvailableShifts` calculates `tradeCount`. No component reads it
  (`src/hooks/useAvailableShifts.ts:58-63`). The hook returns no `error`.
- On the marketplace page, an empty list shows "No shifts available"
  (`src/pages/AvailableShiftsPage.tsx:418-425`). The page has no error state.
- The page reads the selected restaurant
  (`src/pages/AvailableShiftsPage.tsx:245-246`).
- `TradeCard` is a memo component with a custom compare
  (`src/pages/AvailableShiftsPage.tsx:83`, `:193-206`). It formats times in
  device local time (`src/pages/AvailableShiftsPage.tsx:77-95`).
- The page uses `useVirtualizer` (`src/pages/AvailableShiftsPage.tsx:370`).
  The scroll container is `max-h-[60vh] overflow-y-auto` and mounts only in
  the non-empty branch (`src/pages/AvailableShiftsPage.tsx:427-429`).
- The trade accept flow on that page checks the deadline rule and opens a
  confirm dialog (`src/pages/AvailableShiftsPage.tsx:347-363`). The page
  reads `useShiftProtection` and `usePermissions` for this
  (`src/pages/AvailableShiftsPage.tsx:318-320`). The area warning is at
  `src/pages/AvailableShiftsPage.tsx:146-157` and `:177-190`.
- `accept_shift_trade` refuses an overlap with a `scheduled` or `confirmed`
  shift (`supabase/migrations/20260903034800_shift_protection_trade_functions.sql:276-290`).
  On success it sets `status = 'pending_approval'` (`:292-298`).
- In `block` mode, `accept_shift_trade` refuses an accept inside
  `trade_deadline_hours`, except for holders of `edit:scheduling`
  (`supabase/migrations/20260903034800_shift_protection_trade_functions.sql:262-273`).
- `staffing_settings` is unique on `restaurant_id`
  (`supabase/migrations/20260306000000_create_staffing_settings.sql:15`).
  `trade_deadline_mode` defaults to `off` and `trade_deadline_hours` to 24
  (`supabase/migrations/20260903034500_shift_protection_settings.sql:16-20`).
- `restaurants.timezone` is nullable text with default `America/Chicago`
  (`supabase/migrations/20251001022351_2147ffdb-edc4-4d22-8812-8120871aaf6f.sql:3`).
- `shift_trades.created_at` is nullable
  (`supabase/migrations/20260104120000_create_shift_trades.sql:41`).
- Shift status values are `scheduled`, `confirmed`, `completed` and
  `cancelled` (`supabase/migrations/20251114100000_create_scheduling_tables.sql:27`).
- `edit:scheduling` covers `owner`, `manager`, `operations_manager` and
  `collaborator_operations_manager`
  (`supabase/migrations/20260723120000_add_collaborator_operations_manager_role.sql:135`).
- The notification matrix types are in `src/lib/notificationTypes.ts:10-27`
  and in `supabase/functions/_shared/resolveChannels.ts:11-28`. A CHECK
  constraint lists the same 17 keys
  (`supabase/migrations/20260723130100_bank_reauth_notices.sql:80-100`).
- `notification_channel_settings` has `email_enabled` and `push_enabled`,
  unique on `(restaurant_id, notification_type)`
  (`supabase/migrations/20260719120000_notification_channel_settings.sql:12-23`).
  `resolveChannels` treats a missing row as "on"
  (`supabase/functions/_shared/resolveChannels.ts:81-83`).
- The cron-to-edge-function pattern is `cron.schedule` plus an async
  `net.http_post` with the service-role Bearer
  (`supabase/migrations/20260723130200_schedule_bank_reauth_notices.sql:188-210`).
  pg_cron does not wait for the edge function (`:197-209`).
- That function has `verify_jwt = false` (`supabase/config.toml:241-242`)
  and checks the Bearer with a timing-safe compare
  (`supabase/functions/bank-reauth-notices/index.ts:37-42`, `:70-80`).
- Helpers to reuse:
  - `sendWebPushToUsers` (`supabase/functions/_shared/webPushHelper.ts:155`),
    which caps each call at 500 targets (`:26`).
  - `tentativePushBody` (`supabase/functions/_shared/draftTradeNote.ts:17`).
  - `sendPaced` (`supabase/functions/_shared/emailQueue.ts:152`), with
    Resend pacing at 500 ms (`:26`) and a 90 s budget for each call (`:76`).
  - `truncateError` (`supabase/functions/_shared/emailSendSummary.ts:38`).
  - `useNowTick` (`src/hooks/useNowTick.ts:15`).
  - The time zone fallback pattern with `EXCEPTION WHEN invalid_parameter_value`
    (`supabase/migrations/20260820210000_bank_txn_entry_day.sql:25-41`).
- The service worker opens the push `url` with its query string
  (`public/sw.js:28-46`).

## Goals

1. Show open trades that the employee can accept on the employee home
   screen, with the time left before the shift.
2. Show a count badge in the employee navigation, on phone and desktop.
3. Send push reminders to eligible employees as the shift gets closer.
4. Tell schedulers (and the poster) when a trade is still open close to
   the shift, so a scheduler can assign the shift.

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
export interface ClaimableTrade {
  trade: MarketplaceTrade;
  startsAt: Date;
  urgent: boolean; // starts in 24 h or less
}

export interface ClaimableOptions {
  employeeId: string;
  now: Date;
  protection: ShiftProtectionSettings;   // from useShiftProtection
  isExemptFromBlock: boolean;            // hasCapability('edit:scheduling')
}

// Keep a trade only when all are true:
//  - offered_by_employee_id !== employeeId (not my own trade)
//  - offered_shift.start_time > now (not started)
//  - hasConflict !== true (the RPC refuses an overlap)
//  - NOT (protection.trade_deadline_mode === 'block'
//         && start - now <= trade_deadline_hours
//         && !isExemptFromBlock)       (the RPC refuses it)
// Sort by start time, soonest first.
export function selectClaimableTrades(trades, opts): ClaimableTrade[];

// Urgency chip text, or null when no chip shows. The row already shows
// the date tile and the time, so the chip never repeats the date.
export function tradeUrgencyLabel(startsAt: Date, now: Date, tz: string):
  { short: string; spoken: string } | null;

// Date tile parts in the restaurant time zone: { weekday: 'Fri', day: '26', month: 'Sep' }.
export function tradeDateTile(startsAt: Date, tz: string): { weekday: string; day: string; month: string };
```

`tradeUrgencyLabel` rules (restaurant time zone, values rounded down):

| Time to start | `short` | `spoken` |
|---|---|---|
| under 1 h | `Starts in 45 min` | `Starts in 45 minutes` |
| 1 h to under 12 h | `Starts in 5 h` | `Starts in 5 hours` |
| 12 h or more, same restaurant day | `Today` | `Today` |
| next restaurant day | `Tomorrow` | `Tomorrow` |
| later | `null` (no chip) | — |

#### A2. Hook: `src/hooks/useClaimableTrades.ts`

- Signature: `useClaimableTrades(restaurantId: string | null, employeeId: string | null)`.
- It calls `useMarketplaceTrades(restaurantId, employeeId, { enabled })`
  with `enabled = !!restaurantId && !!employeeId`. This stops the extra
  request with a `null` employee.
- `useMarketplaceTrades` gets a new optional third argument
  `{ enabled?: boolean }`. The default keeps today's behavior.
- The hook reads `useShiftProtection(restaurantId)` and
  `usePermissions()` for the block rule.
- The hook reads `const nowMs = useNowTick(60_000)` and memoizes the
  selector on `[trades, nowMs, protection, isExemptFromBlock, employeeId]`.
  It passes `new Date(nowMs)` (lesson `memory/lessons.md:806-812`).
- It returns `{ trades, count, loading, error, refetch }`. While the
  employee is not known, it returns `count: 0` and `loading: true`.

Query cost changes in `useMarketplaceTrades`, because the badge now runs
the query on every employee page:

- Select explicit `shift_trades` columns in place of `*`.
- Add `.gte('end_time', new Date().toISOString())` to the conflict shift
  read. Only future shifts can overlap an open trade.

#### A3. "Teammates need cover" card on the employee home screen

The approved mockup is at https://claude.ai/artifact/WKo2q9Z1DNfcESJJV2kgAA
("Improved" set). Changes 1–5 of that page are part of this design.

- New component `src/components/employee/UpForGrabsCard.tsx`. It gets the
  data as props from `EmployeeSchedule`. It has no data hooks.
- Title: "Teammates need cover", with the count. People take a shift for
  a coworker more often than for an empty slot (change 1).
- Sub-line under the title, in `text-[12px] text-muted-foreground`, with
  a `Check` icon in `text-success`: "All 3 fit around your shifts" ("It
  fits around your shifts" for one). The selector already drops overlaps,
  so the claim is true (change 2). The text does not use `text-success`,
  because `--success` on `--background` is near 3:1, below 4.5:1 for 12 px
  text.
- The card shows the 3 soonest claimable trades as a `<ul>`. Each `<li>`
  is one `<Link>` (change 4):
  - Left: the date tile from `MyShiftTradesCard`
    (`src/components/schedule/MyShiftTradesCard.tsx:84-88`): weekday,
    day number, month, in the restaurant time zone (change 3).
  - Middle line 1: "{poster name} · {position}" and the urgency chip when
    `tradeUrgencyLabel` returns a value.
  - Middle line 2: "{start} – {end}", plus ` · “{reason}”` when the trade
    has a reason. The reason truncates to one line.
  - Right: a `ChevronRight` icon.
  - The link goes to `/employee/shifts?trade=<id>&restaurant=<restaurantId>&from=home`.
  - `aria-label="View {position} shift on {weekday, month day} from {name}"`.
  - The row is one tab stop with `min-h-[64px]`.
- Footer: "{n} open shifts too" on the left, when `openShiftCount > 0`,
  and a "Browse all {total}" link to `/employee/shifts` on the right
  (change 5).
- Placement (change 5):
  - When the card shows, `EmployeeSchedule` hides the gradient
    "Browse Available Shifts" button. The card footer takes its job.
  - When any claimable trade is `urgent` (24 h or less), the card goes
    directly under the page header, above `ScheduleStatusBanner`.
    `ScheduleStatusBanner` then gets `reserveHeight={false}`. Its fixed
    `min-h-[76px]` slot (`src/components/employee/ScheduleStatusBanner.tsx:8-10`)
    would otherwise show as an empty gap under the card. The Phase 5 UI
    review found this gap in a screenshot.
  - Otherwise the card goes after `ScheduleStatusBanner` and before
    `MyShiftTradesCard`.
- `EmployeeSchedule` reads `useClaimableTrades` for the trades, and
  `useOpenShifts` for `openShiftCount`, with the same two-week range as
  `AvailableShiftsPage` (`src/pages/AvailableShiftsPage.tsx:252-257`).
- States:
  - Loading: render nothing, and keep the gradient button. Most employees
    have no trades most days. A skeleton that then disappears moves the
    cards below it.
  - Error: one line, "Could not load shifts that need cover.", with a
    "Try again" button that calls `refetch`. The gradient button stays.
  - Empty (`count === 0`): render nothing. The gradient button stays.
  - Data: the card.
- Classes:
  - Container: `rounded-xl border border-border/40 bg-background overflow-hidden`.
  - Header: `px-4 py-3 border-b border-border/40`. Title
    `text-[17px] font-semibold text-foreground`. Count
    `text-[11px] px-1.5 py-0.5 rounded-md bg-muted`.
  - Row link: `flex items-center gap-3 px-4 py-3 min-h-[64px] transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground`.
    Line 1 `text-[14px] font-medium text-foreground`. Line 2
    `text-[13px] text-muted-foreground`.
  - Urgent chip (under 24 h): `text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium`.
  - Other chip ("Tomorrow" at more than 24 h): `text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground`.
  - Each chip has `aria-label={spoken}`.
  - Footer: `flex items-center justify-between px-4 py-2.5 border-t border-border/40 text-[13px] text-muted-foreground`.
  - Error line: `text-[13px] text-muted-foreground`.
- The accept action stays on the marketplace page only. That page owns the
  deadline confirm dialog and the area warning. One accept flow means one
  place to keep correct.

#### A4. Count badge

- New component `src/components/employee/TradeCountBadge.tsx`: a
  presentational `<span aria-hidden="true">` with
  `min-w-[16px] h-4 px-1 rounded-full bg-foreground text-background text-[10px] font-semibold leading-4 text-center`.
  It shows `9+` for counts above 9.
- The badge takes an `urgent` prop. When any claimable trade is urgent
  (24 h or less), the badge uses `bg-amber-600 text-white dark:bg-amber-500 dark:text-amber-950`
  in place of `bg-foreground text-background` (change 5). White on
  `amber-600` is about 3.2:1, which meets the 3:1 rule for a badge
  (WCAG 1.4.11); the accessible name carries the count in words.
- `MobileTabBar`:
  - Calls `useRestaurantContext()`, `useCurrentEmployee(restaurantId)` and
    `useClaimableTrades(restaurantId, employeeId)`.
  - With no selected restaurant or no employee row (for example a manager
    in work mode), the hook is disabled. No badge and no request.
  - The "More" tab wraps its icon in a `relative` span. The badge sits at
    the top right of the icon. The tab keeps `min-w-[64px] min-h-[44px]`.
  - The `aria-label` of the "More" tab becomes
    `More, 2 shifts up for grabs` (`1 shift` for one) when the count is
    more than 0. Otherwise it stays `More`.
- `EmployeeMore`: the "Shift Marketplace" row shows the badge at the right
  side, before the chevron. The row adds an `sr-only` span
  "2 shifts up for grabs".
- Desktop (`AppSidebar`):
  - Add `{ path: '/employee/shifts', label: 'Shift Marketplace', icon: ShoppingBag }`
    to `staffNav`, after "My Schedule".
  - `AppSidebar` shows the badge after the label for that item when the
    count is more than 0. In collapsed icon mode, the badge sits on the
    icon. The button gets an `sr-only` count text.
  - `AppSidebar` calls `useClaimableTrades` only when it renders
    `staffNav`.

#### A5. Deep link on the marketplace page

- `useAvailableShifts` returns `error` (from both queries) and `refetch`.
  The page shows an error state with "Could not load shifts." and a
  "Try again" button. Today an error looks like an empty list.
- The page reads the `trade` and `restaurant` search params.
- At the start of the component (above the early returns at
  `src/pages/AvailableShiftsPage.tsx:378-380`), the page copies the
  `trade` param into `const [highlightTradeId, setHighlightTradeId] = useState<string | null>(...)`.
  It then deletes both params from the URL with `replace: true`.
- Restaurant check: if `restaurant` is set and differs from the selected
  restaurant:
  - If the user is a member of that restaurant (it is in
    `restaurants` from `useRestaurantContext`), call
    `setSelectedRestaurant` with it.
  - Otherwise, show the toast "This shift is at a restaurant you cannot
    open." and clear the highlight.
- A `useEffect` runs when `!loading && !error && parentRef.current` and a
  `useRef` guard shows it did not run yet:
  - If the trade is in `items`: call
    `parentRef.current.scrollIntoView({ block: 'nearest' })`, then
    `virtualizer.scrollToIndex(index, { align: 'center' })`. Do not use
    smooth scroll, because rows have dynamic height. After the next frame,
    focus the card root.
  - If the trade is not in `items`: show the toast with title "That shift
    is no longer open" and description "A teammate took it, or it was
    withdrawn. The shifts below are still open." Then clear the highlight.
    The copy does not name who took the shift, because RLS hides a trade
    from other employees once it leaves `open`
    (`supabase/migrations/20260713000000_restrict_directed_shift_trade_visibility.sql:24-48`).
- The highlight clears after 4 s or on the first user scroll of the list.
- The page also reads a `from` param (`reminder` or `home`) and keeps it
  in state with the highlight id. The highlighted card shows a small label
  above the "SHIFT TRADE" tag (change 6):
  - `from=reminder`: `Bell` icon and "From your reminder".
  - `from=home`: `Home` icon and "From your home screen".
  - Classes: `flex items-center gap-1.5 text-[12px] text-muted-foreground`.
- `TradeCard` gets a `highlighted` prop and a `highlightSource` prop:
  - The root gets `tabIndex={-1}`, `outline-none`, `aria-current="true"`
    and `ring-2 ring-inset ring-foreground` when highlighted. `ring-inset`
    stops the scroll container from clipping the ring.
  - The memo compare adds `prev.highlighted === next.highlighted` and
    `prev.highlightSource === next.highlightSource`.

### Part B: Timed reminders (backend)

#### B1. Stages

`now` is the cron tick time. `h` is the hours from `now` to
`offered_shift.start_time`. `created` is
`COALESCE(t.created_at, '-infinity')`.

| Stage | Audience | Due when | Skip when |
|---|---|---|---|
| `72h` | eligible employees | `24 < h <= 72` | `created > start_time - 72h` |
| `24h` | eligible employees | `6 < h <= 24` | `created > start_time - 24h` |
| `6h` | eligible employees | `0 < h <= 6` | `created > start_time - 6h` |
| `unclaimed` | schedulers and the poster | `0 < h <= E` and `now - created >= 1h` | none |

- `E` (the escalation window) is 24 hours. When `trade_deadline_mode` is
  `block`, `E` is `GREATEST(24, trade_deadline_hours + 12)`. Schedulers
  then hear about the trade 12 hours before employees can no longer
  accept it.
- The "skip" rule stops a reminder right after the post. The `created`
  notification already covers that window. Example: a trade posted 20 h
  before the shift gets no `24h` reminder. It gets the `6h` reminder.
- A run sends only the one employee stage that is due now. It never sends
  an older stage that it missed.
- Employee stages are skipped when `trade_deadline_mode = 'block'` and
  `h <= trade_deadline_hours`. Employees cannot accept then.
- Quiet hours: no stage sends between 22:00 and 08:00 in the restaurant
  time zone. A stage stays due. It sends at 08:00 if its window is still
  open.
- The restaurant time zone comes from a new helper
  `public.safe_restaurant_tz(text) RETURNS text`, `STABLE`. It returns
  `COALESCE(NULLIF(tz, ''), 'America/Chicago')`, and `America/Chicago`
  when `now() AT TIME ZONE tz` raises `invalid_parameter_value`. One bad
  zone must not stop the query for all tenants.
- Only trades with `status = 'open'` get reminders. A `pending_approval`
  trade already has a taker.
- Only trades whose offered shift has `status IN ('scheduled','confirmed')`.
  A cancelled shift gets no reminder.
- A directed trade (`target_employee_id` set) reminds only its target.
- A candidate is not returned when its channels are off in
  `notification_channel_settings` (LEFT JOIN, missing row = on):
  - Employee stages need `push_enabled` for `shift_trade_reminder`.
  - `unclaimed` needs `push_enabled` or `email_enabled` for
    `shift_trade_unclaimed`.
  - A disabled candidate therefore never fills a run's limit.

#### B2. Eligible employees

- Active employees of the restaurant with a `user_id`.
- Not the poster.
- No overlapping shift with `status IN ('scheduled','confirmed')`. This is
  the same test as `accept_shift_trade`
  (`supabase/migrations/20260903034800_shift_protection_trade_functions.sql:276-282`).
- For a directed trade: the target only, with the same overlap test.

#### B3. Channels and content

- New matrix type `shift_trade_reminder` (group "Trades",
  label "Open trade reminder"), channels `['push']`.
  - Push only. An email for each stage to the full roster is noise. Resend
    pacing also makes a roster email too slow for a cron run.
- New matrix type `shift_trade_unclaimed` (group "Trades",
  label "Open trade not taken"), channels `['email','push']`.
  - Schedulers get email and push.
  - The poster gets push only.
  - When the poster is also a scheduler, the poster gets only the poster
    push. The recipients RPC removes the poster's `user_id` from the
    scheduler set.
- Both types also go through `resolveChannels` in the edge function, as a
  second gate.
- The web push goes through `sendWebPushToUsers`.
- The employee push URL is
  `/employee/shifts?trade=<id>&restaurant=<restaurant_id>&from=reminder`.
- The scheduler push URL is `/scheduling`, and the scheduler email button
  links to `/scheduling` too. A scheduler assigns the shift there, not in
  the employee marketplace (change 7).
- The poster push URL is `/employee/schedule`, where `MyShiftTradesCard`
  shows the poster's own trade.
- The push `tag` is `trade-reminder-<id>`, so a new stage replaces the
  old one on the device.
- Push text is written like a teammate who asks for help (change 7).
  `{name}` is the poster's first name. `{day}` is "today", "tomorrow" or
  the weekday name ("Friday"), in the restaurant time zone. `{when}` is
  built from the real hours left ("in 2 hours"), so a stage that quiet
  hours delay stays true. Times use the restaurant time zone.
  - `72h` and `24h`: title "{name} needs cover {day}". Body
    "{position}, {Fri} {5–11 PM}. You're free then. Tap to take the shift."
    The audience excludes employees with an overlap, so "You're free then"
    is true for every recipient.
  - `6h`: title "{name}'s shift starts {when}". Same body.
  - `unclaimed` (schedulers): title "Nobody took {name}'s shift yet". Body
    "{position}, {Fri} {5–11 PM}, still open. Tap to assign it."
  - `unclaimed` (poster): title "Your shift is still up for trade". Body
    "Nobody took it yet. You still work it unless a manager changes it."
- A draft shift (`is_published = false`) uses `tentativePushBody`.
- Scheduler email: one message per recipient, through `sendPaced`, with
  the provider error redacted by `truncateError` (lesson
  `memory/lessons.md:2678-2681`).

#### B4. Database

New migration `supabase/migrations/20260925120000_shift_trade_reminders.sql`.
Every function sets `SET search_path = public, pg_temp`, and every
function does `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` and
`GRANT EXECUTE ... TO service_role`.

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

   - RLS enabled. No policy for `authenticated`. `REVOKE ALL` from
     `anon, authenticated`. `GRANT ALL` to `service_role`.
   - Index on `restaurant_id` for the FK.

2. `safe_restaurant_tz(p_tz text) RETURNS text` — `STABLE` (the zone table can change), see B1.

3. `get_shift_trade_reminder_candidates(p_now timestamptz, p_limit int,
   p_after_start timestamptz, p_after_trade uuid, p_after_stage text)` —
   `SECURITY INVOKER STABLE`. The caller is `service_role`, which has
   BYPASSRLS.
   - Returns one row for each `(trade, stage)` that is due, with every
     rule in B1 applied in SQL.
   - Columns: `shift_trade_id`, `restaurant_id`, `stage`, `start_time`,
     `end_time`, `position`, `is_published`, `offered_by_name`,
     `restaurant_name`, `restaurant_timezone` (after `safe_restaurant_tz`).
     The audience and recipients RPCs read the poster and the target
     themselves, so the candidates RPC does not return them.
   - Excludes a `(trade, stage)` that already has a row in
     `shift_trade_reminders`.
   - Reads `staffing_settings` with a LEFT JOIN, with `COALESCE` to the
     column defaults.
   - `ORDER BY start_time, trade id, stage LIMIT p_limit`.
   - Keyset cursor: the three `p_after_*` params default to NULL. When
     `p_after_start` is set, only rows after the cursor tuple come back.
     The worker passes the last row of the page before.

4. `claim_shift_trade_reminder(p_trade_id uuid, p_stage text) RETURNS boolean` —
   `SECURITY INVOKER VOLATILE`. One statement:

   ```sql
   WITH ins AS (
     INSERT INTO public.shift_trade_reminders (restaurant_id, shift_trade_id, stage)
     SELECT t.restaurant_id, t.id, p_stage
     FROM public.shift_trades t
     JOIN public.shifts s ON s.id = t.offered_shift_id
     WHERE t.id = p_trade_id AND t.status = 'open' AND s.start_time > now()
     ON CONFLICT (shift_trade_id, stage) DO NOTHING
     RETURNING 1
   )
   SELECT EXISTS (SELECT 1 FROM ins);
   ```

5. `get_shift_trade_reminder_audience(p_trade_id uuid)` —
   `SECURITY INVOKER STABLE`. Returns `user_id` for the eligible employees
   in B2.

6. `get_shift_trade_unclaimed_recipients(p_trade_id uuid)` —
   `SECURITY DEFINER STABLE`, because it reads `auth.users`.
   - Returns `user_id`, `email` and `kind` (`'scheduler'` or `'poster'`).
   - Schedulers: `user_restaurants` rows of the trade's restaurant with
     `role IN ('owner','manager','operations_manager','collaborator_operations_manager')`.
     A comment ties this list to `edit:scheduling`.
   - The email comes from `auth.users` (schema-qualified), with
     `email IS NOT NULL AND deleted_at IS NULL`. No PostgREST embed
     (lesson `memory/lessons.md:138-139`).
   - Poster: the poster's `user_id`, `kind = 'poster'`, `email = NULL`.
     The poster's `user_id` is removed from the scheduler rows.

7. Replace `notification_channel_settings_type_check`. Add
   `shift_trade_reminder` and `shift_trade_unclaimed` to the 17 keys.
   Update the column comment to 19 keys.

8. `dispatch_shift_trade_reminders() RETURNS bigint` — `SECURITY DEFINER VOLATILE`,
   and `cron.schedule('shift-trade-reminders', '*/15 * * * *', 'SELECT public.dispatch_shift_trade_reminders()')`.
   Unschedule first, so the migration can run again.
   - The project does not set `app.settings.supabase_url`. A read without
     `missing_ok` fails on each run
     (`supabase/migrations/20260702160000_focus_crons_gateless.sql:6-9`).
     The `bank-reauth-notices` cron has this read
     (`supabase/migrations/20260723130200_schedule_bank_reauth_notices.sql:201-205`).
   - URL: `app.settings.supabase_url` with `missing_ok`, else the project
     URL (`supabase/migrations/20260901120000_focus_backfill_cron_timeout.sql:34`).
   - Key: `app.settings.service_role_key` with `missing_ok`, else the Vault
     secret `supabase_service_role_key`
     (`supabase/migrations/20260217031454_9c95bf26-eb62-46f0-bfd1-6815d60f8c63.sql:17-23`).
   - No key: return `NULL` and send nothing. A local database has no Vault
     secret, so a local pg_cron never calls production.

#### B5. Edge function `shift-trade-reminders`

- `supabase/functions/shift-trade-reminders/index.ts`: wires real clients.
- `supabase/functions/_shared/shiftTradeRemindersHandler.ts`: pure
  orchestration with injected dependencies and an injected clock, tested
  by vitest. It copies the layout of
  `supabase/functions/_shared/bankReauthNoticesHandler.ts`.
- `verify_jwt = false` in `supabase/config.toml`. The function checks the
  service-role Bearer with a timing-safe compare. It reads no input from
  the request body.
- Run budget: 60 s wall-clock and 1,000 push targets. The handler checks
  both before each claim. When either is used up, it stops. The rest stay
  due for the next tick.
- Order for each candidate:
  1. Check the run budget. If it is used up, count the rest as
     `deferred` and stop.
  2. `claim_shift_trade_reminder`. If it returns `false`, count `skipped`.
     Another run sent it, or the trade is no longer open.
  3. `resolveChannels(restaurant, type)`. If all channels are off (a
     change after the candidate read), count `skipped`. The claim stays,
     so the candidate leaves the queue.
  4. Read the audience. Send the push (and the scheduler email for
     `unclaimed`).
  5. Log counts and ids only. Never log an email address.
- The claim comes before the send. A crash after the claim loses that one
  reminder. A crash never sends the same stage twice. For a reminder, a
  lost message is better than a duplicate.
- The candidates call uses `p_limit = 50`.
- The response is
  `{ candidates, claimed, pushed, emailed, skipped, deferred }`.

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
employee accepts, then the run sends. The push opens the marketplace, and
the deep link then shows "That shift is no longer available." We accept
this case.

## Testing

- Unit (`tests/unit/`):
  - `claimableTrades.test.ts`: filters (own, past, conflict, block window,
    exempt caller), sort, urgent bound, each `tradeUrgencyLabel` row in A1,
    `tradeDateTile`, midnight and time zone edges.
  - `useClaimableTrades.test.ts`: disabled without employee, count,
    loading, error, a trade drops out when the tick passes its start.
  - `UpForGrabsCard` and `TradeCountBadge` render tests: nothing on
    loading or empty, error with retry, fit sub-line, reason text, footer
    counts, row link href and name, `9+`, the amber badge, accessible names.
  - `shiftTradeReminderContent.test.ts`: each push title and body in B3,
    the three URLs, `{day}` and `{when}` in the restaurant time zone.
  - `shiftTradeRemindersHandler.test.ts`: claim before send, a lost claim
    skips the send, channel gate after claim, run budget defers the rest,
    poster push only, scheduler email per recipient, counts-only logs,
    `{when}` text from real hours.
  - `notificationTypes.test.ts` and `notificationActionTypes.test.ts`:
    extend for the two new keys.
- pgTAP (`supabase/tests/`):
  - Stage windows and the created-at skip rule, including NULL
    `created_at`.
  - Quiet hours in the restaurant time zone. NULL and garbage zones fall
    back and do not raise.
  - Block mode: employee stages skipped, escalation window at
    `trade_deadline_hours + 12`.
  - Only `open` trades on `scheduled`/`confirmed` shifts. A directed trade
    reminds only its target.
  - Channel settings off: no candidate. Missing row: candidate.
  - Audience excludes the poster, inactive employees and overlaps.
  - Recipients: each of the four scheduler roles, deleted users excluded,
    poster once with `kind = 'poster'`.
  - Claim returns `true` one time, then `false`. Claim returns `false`
    for a non-open trade and for a started shift.
  - `authenticated` cannot execute the RPCs or read the table.
  - The CHECK constraint accepts the two new keys.
- E2E (`tests/e2e/shift-trade-up-for-grabs.spec.ts`): employee A posts a
  trade. Employee B sees the "Teammates need cover" card and the More
  badge. B taps the trade row. The marketplace scrolls to the highlighted
  trade with the "From your home screen" label,
  and B accepts it.

## Rollout

- The migration schedules the cron. The first tick can send reminders for
  trades that are already open. That is the wanted result, and each stage
  sends at most one time.
- Admins can turn off both new types in Settings → Notifications.
- Before deploy, check in production that the Vault secret
  `supabase_service_role_key` exists and equals the edge function's
  `SUPABASE_SERVICE_ROLE_KEY`. If it does not, the function returns 401 on
  each run and no reminder sends.
- After deploy, check that `shift_trade_reminders` gets rows and that the
  function logs show `claimed > 0` when due trades exist (lesson
  `memory/lessons.md:933-936`).

## Decided trade-offs

- The UI follows the "Improved" mockup (changes 1–7) at
  https://claude.ai/artifact/WKo2q9Z1DNfcESJJV2kgAA. The user approved it
  on 2026-09-25.

- Employee reminders are push only. Employees without push get no
  reminder, but the home card and the badge still reach them.
- The home card does not accept in place. It deep-links to the one accept
  flow.
- An empty or loading "Teammates need cover" card does not render. The
  "Browse Available Shifts" button already covers the empty case.
- Quiet hours can hide the `6h` stage for a shift that starts at or before
  08:00. The `24h` stage still reaches employees the day before, and the
  `unclaimed` stage reaches schedulers.
- `TradeCard` keeps device local time. The home card uses the restaurant
  time zone. Employees are almost always in the restaurant time zone. A
  change to `TradeCard` is outside this scope.
- A signed-out user who taps a push loses the `?trade=` param at the
  sign-in redirect (`src/App.tsx:156-157`). The marketplace still opens
  after sign-in from the nav.
- A claim followed by an accept before the send gives one stale push. The
  deep link handles it.

## Phase 7 review decisions (2026-09-25)

Five reviewers (security, performance, maintainability, logic, OCR rules)
checked the branch at `e82f4b1`. These decisions change the design above.

- **Fail closed on the block rule.** `useClaimableTrades` returns no trades
  until the employee, the shift protection settings and the permissions are
  known. On a protection read error, it applies the block rule with the
  default 24 h window. It never falls back to mode `off`.
- **Marketplace query.** It downloads only trades whose shift has not ended
  (`!inner` embed plus `offered_shift.end_time > now`). The trades read and
  the conflict read run in parallel.
- **Badge.** One hook, `useClaimableTradeBadge()`, feeds all three badges.
  It shows nothing while it loads or on an error. The urgent badge is
  `bg-amber-600 dark:bg-amber-500 text-background`. `--warning-foreground`
  is white, and white on `--warning` is near 2:1, so the token pair fails.
- **Footer copy.** The footer link is "Browse all shifts", with no number.
  The marketplace header counts items that the card leaves out (own trades,
  conflicts, blocked trades), so a number in the link cannot match it.
  "{n} open shifts too" shows only when the open shifts load with no error.
- **Deep link.** The link builder lives in
  `supabase/functions/_shared/tradeDeepLinkUrl.ts`, shared by the push and
  the home card. The page logic moves into `useTradeDeepLink`. It shows each
  toast once (StrictMode), retries the focus for up to 5 frames, and ends the
  wait with the "cannot open" toast when the user has no employee row there.
- **Banner.** With `reserveHeight={false}` and no content, the banner renders
  nothing, so no empty `space-y` gap stays.
- **Push budget.** `MAX_PUSH_TARGETS` is 500, the same as
  `DEFAULT_MAX_TARGETS` (`supabase/functions/_shared/webPushHelper.ts:23-26`).
  The handler reads the audience before the claim (a read, so the TLA+
  claim-before-send rule holds) and defers a candidate that does not fit.
- **Candidate pages.** One run reads more pages of 50 candidates while the
  budget remains, up to 10 pages. A backlog at 08:00 then clears in one run.
- **Stage spacing.** An employee stage is skipped when another employee
  stage for the same trade sent in the last 6 hours.
- **Tags.** The `unclaimed` push uses `trade-unclaimed-<id>`, so it does not
  replace an employee push on a scheduler's own device.
- **Overlap test and index.** The audience RPC uses
  `o.end_time > s.start_time AND o.start_time < s.end_time` with a partial
  index on `shifts (employee_id, end_time)` for `scheduled`/`confirmed`.
- **Dispatcher URL.** `dispatch_shift_trade_reminders()` uses the constant
  project URL. A session setting cannot redirect the service-role key.
- **Shared helpers.** `isServiceRoleBearer` moves to
  `supabase/functions/_shared/cronAuth.ts`. The content module uses `safeTz`
  from `supabase/functions/_shared/timezone.ts`.
