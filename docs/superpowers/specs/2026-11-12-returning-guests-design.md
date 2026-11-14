# Returning guests — design

Date: 2026-11-12. Branch: `feature/returning-guests`. Status: draft for review.

Writing standard: STE-aligned (ASD-STE100 rules in `CLAUDE.md`).

## 1. Problem

An owner starts a marketing campaign. The owner wants to know if existing
guests spend more or less after the campaign starts. The POS data has no
customer ID. Card payments have card digits. This page uses a card match key
as a guest proxy and shows a group trend, not a per-guest list.

## 2. Goals and non-goals

Goals:

- One page, `/returning-guests`, for all restaurants.
- The owner enters a campaign start date and a period length (4, 8 or 12 weeks).
- Three before/after numbers for returning cards:
  1. Spend per week.
  2. Visits per returning card.
  3. Average check.
- A weekly line chart: returning-card spend and new-card spend, with a dashed
  marker at the campaign start.
- An estimate note that tells the owner how the match works.
- All aggregation in one SQL RPC. The RPC returns aggregates only.

Non-goals (v1):

- No per-guest list. No "top repeat cards" list.
- No storage of a campaign record. The date lives in the URL only.
- No change to any POS sync. No new column, no backfill.
- No statistical significance test.

## 3. Facts from the code and from prod (read-only)

Code facts:

- Toast writes `payment_date` from `paidBusinessDate` (the restaurant business
  day) and keeps the full payment in `raw_json`
  (`supabase/functions/_shared/toastOrderProcessor.ts:188-199`).
- Toast `amount` and `tip_amount` are separate fields
  (`toastOrderProcessor.ts:195-196`).
- `toast_payments.payment_date` is a `DATE`
  (`supabase/migrations/20251116100100_toast_integration.sql:79`).
  RLS is on (`:153`).
- Revel keeps `amount` and `tipAmount` separate and maps status from
  `transaction_status` (`supabase/functions/_shared/revelOrderProcessor.ts:173-175`).
  It writes the payment at `:263-264`.
- Focus parses `cardLast4` from the account (`supabase/functions/_shared/focusDatafeedParser.ts:105`, `:147`)
  and writes `card_last4`, `amount`, `tip` (`supabase/functions/_shared/focusTransactionSyncHandler.ts:258-260`).
  A CHECK holds `card_last4` to 4 digits
  (`supabase/migrations/20260701150000_focus_transactions_integrity.sql:28-29`).
- Square keeps the full Payments API object in `raw_json`
  (`supabase/functions/square-sync-data/index.ts:388-401`,
  `supabase/functions/square-webhooks/index.ts:442-455`). The Square object
  holds `card_details.card.fingerprint`, `last_4` and `card_brand` for card
  payments. **Result: no Square sync change is necessary.**
- Clover and Shift4 have no payment table.
- The tenant guard helper is `public.user_has_restaurant_access(p_restaurant_id, p_require_manager_role)`
  (`supabase/migrations/20260521222200_create_user_has_restaurant_access_helper.sql:19-41`).
  With `true` it accepts only `owner` and `manager` (`:37`).
- The pattern to copy for an analytics RPC: `get_labor_sales_analytics`
  (`supabase/migrations/20260809120000_get_labor_sales_analytics.sql:8-92`):
  `STABLE SECURITY DEFINER SET search_path = public, pg_temp`, one JSONB result.
- The pattern to copy for the hook: `src/hooks/useLaborSalesAnalytics.ts:28-47`.
- Charts use Recharts. `ReferenceLine` is in use at
  `src/components/scheduling/ShiftPlanner/SplhTimelineChart.tsx:2`.
- Routes live in `src/App.tsx:357-458`. The sidebar nav lives in
  `src/components/AppSidebar.nav.data.ts:57-110`.
- The restaurant timezone is `selectedRestaurant.restaurant.timezone`
  (`Restaurant.timezone` in `src/hooks/useRestaurants.tsx:16`; read it with `safeTz(...)`, as `src/pages/EmployeePortal.tsx:45` does).

Prod facts (2026-11-12, read-only SELECT):

| POS | Restaurants | Payments | Card digits | Brand | Extra |
|-----|-------------|----------|-------------|-------|-------|
| Toast | 3 | 33,218 | `raw_json->>'last4Digits'` on 27,020 | `cardType` | `first6Digits` on 45–100 % per restaurant |
| Focus | 2 | 28,446 | `card_last4` on 26,122 | none | none |
| Revel | 1 | 4,496 | `raw_json->>'last_4_cc_digits'` on 3,669 | `card_type` | none |
| Square | 4 | 146 | none (all 146 are `CASH`, last 2026-01-28) | — | fingerprint when card |

Status values in prod:

- Toast `payment_status`: `CAPTURED` 32,402, `AUTHORIZED` 91, `DENIED` 399,
  `VOIDED` 310, `CANCELLED` 7, `ERROR` 6, `OPEN` 3.
- Revel `payment_status`: `Captured` 3,544, `Accepted` 37, `Declined` 1, NULL 914
  (87 of the NULL rows have card digits).
- Focus has no status column. 22 rows have a negative amount.

Collision evidence: one Toast restaurant has 11,172 card payments. They give
5,941 distinct last-4 values and 7,414 distinct brand + last-4 values.

## 4. Design

Changes after the Phase 2.5 reviews (Supabase and frontend) are in this
section. Section 9 lists them.

### 4.1 Card match key (inside the RPC only)

| Source | Key | Match quality |
|--------|-----|---------------|
| Square | `raw_json->'card_details'->'card'->>'fingerprint'` | `strong` |
| Toast, restaurant with first 6 on ≥ 95 % of card rows | brand + first 6 + last 4 | `good` |
| Toast, other restaurants | brand + last 4 | `fair` |
| Revel | brand + last 4 | `fair` |
| Focus | last 4 | `weak` |

Quality order: `weak` < `fair` < `good` < `strong`.

Key parts per source (all from `raw_json` unless a column is named):

- Toast: `cardType`, `first6Digits`, `last4Digits`.
- Revel: `card_type`, `last_4_cc_digits`.
- Focus: column `focus_payments.card_last4`.
- Square: `card_details.card.fingerprint`. No Square row has it today (all 146
  prod rows are CASH). The code path exists for future data. No sync change in v1.

Rules for each key part:

- Wrap each part in `NULLIF(btrim(part), '')`.
- Join the parts with `part1 || '|' || part2`. Do not use `concat()`. `concat()`
  hides a NULL part. With `||`, a missing part gives a NULL key.
- A row with a NULL key does not count.

Decision: the Toast rule is per restaurant, not per row. If one card has first 6
on some rows and not on others, a per-row rule gives two keys for one card. That
makes a returning guest look new. The per-restaurant rule gives one key for each
card. The 95 % share uses the allow-listed card rows of that restaurant.

The key is a text value inside a CTE. The RPC never returns it. The RPC never
writes it.

If one restaurant has card data from more than one source, the RPC uses all
sources (`source = 'mixed'`) and reports the weakest quality.

### 4.2 Which payments count (allow-lists)

Lesson 2026-05-03: count by an allow-list, not by "NOT bad".

| Source | Table | Status rule | Amount | Date |
|--------|-------|-------------|--------|------|
| Toast | `toast_payments` | `payment_status IN ('CAPTURED','AUTHORIZED')` | `amount` | `payment_date` (DATE) |
| Revel | `revel_payments` | `payment_status IN ('Captured','Accepted')` | `amount` | `payment_date` (DATE) |
| Focus | `focus_payments` | all rows | `amount` | `business_date` (DATE) |
| Square | `square_payments` | `status = 'COMPLETED'` | `amount_money` (DECIMAL, dollars) | `(created_at AT TIME ZONE v_tz)::date` |

The build step confirms each column name against the migrations before it
writes SQL.

- All sources: amount `> 0` and a non-NULL key. Spend is the amount without tip.
- Revel NULL status (87 card rows in prod): v1 excludes them (Q1 is closed).
  A test proves it.
- Square date is the calendar day in the restaurant zone, not the business day.
  A payment at 23:30 local time counts on that local day. A test proves it.
- Refunds: v1 does not subtract refunds. A refund row has amount `<= 0` or a
  status outside the allow-list, so it does not count. The page note says
  "Estimate".

### 4.3 Time zone, weeks and periods

Time zone: the RPC reads `restaurants.timezone`. It validates the value against
`pg_timezone_names` and uses `America/Chicago` if the value is NULL or not
valid (lesson 2026-07-24). The RPC has no time-zone parameter. Thus the client
cannot send a wrong zone.

- `v_today := (now() AT TIME ZONE v_tz)::date`.
- Week `k` starts at `p_campaign_start + 7k` and has 7 days.
- `n := LEAST(p_weeks, floor((v_today - p_campaign_start) / 7))`. A week is
  complete only when its last day is before `v_today`.
- After period: weeks `0 .. n-1`. Before period: weeks `-p_weeks .. -1` on the
  chart. The summary "before" uses weeks `-n .. -1`, the same count as "after".
- Campaign start = today or yesterday → `n = 0`. The RPC returns the before
  weeks only and `weeks_compared = 0`. The page says "Come back after the
  first full week".

### 4.4 Returning and new

- `first_seen` of a key = the earliest date of that key in all history for the
  restaurant. Only allow-listed rows with amount `> 0` count.
- In week `k`, a payment is **returning** if `first_seen < week_start`.
  Otherwise it is **new**.
- `history_start` = the earliest counted card payment date for the restaurant.
- Toast imports only 90 days at the first sync. Early weeks thus show too many
  new cards. A week is a **warm-up week** if `week_start < history_start + 28 days`.
  The RPC flags it. The page shows a note when the before period has a warm-up week.

### 4.5 Metrics

For one period (before or after), with returning payments only:

- `spend_per_week` = returning spend ÷ number of weeks.
- `visits_per_card` = returning visits ÷ distinct returning keys.
- A **visit** is one distinct (key, date) pair. Two payments by one card on one
  day are one visit.
- `avg_check` = returning spend ÷ returning visits.
- Division by zero gives `NULL`, not 0.
- The RPC rounds one time, at the end (`ROUND(x, 2)`). Intermediate sums are
  not rounded.

The RPC also returns `new_cards` (distinct new keys) for each period. The page
does not show it as a headline number in v1. The chart tooltip uses it.

### 4.6 RPC contract

```sql
public.get_returning_guest_trends(
  p_restaurant_id  UUID,
  p_campaign_start DATE,
  p_weeks          INT DEFAULT 8      -- allowed: 1 .. 26
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
```

Guards, in this order, before any read:

1. `IF NOT public.user_has_restaurant_access(p_restaurant_id, true)` →
   `RAISE ... USING ERRCODE = 'insufficient_privilege'`. Owner and manager only.
   A NULL `auth.uid()` gives no match in `user_restaurants`, so the helper
   returns false and the RPC denies.
2. `p_campaign_start IS NULL`, `p_weeks IS NULL`, or `p_weeks` outside
   1 .. 26 → `RAISE ... USING ERRCODE = '22023'`.
3. `p_campaign_start > v_today` → `22023`.

Grants use the full signature:

```sql
REVOKE ALL ON FUNCTION public.get_returning_guest_trends(UUID, DATE, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_returning_guest_trends(UUID, DATE, INT) TO authenticated;
```

Reads: one scan per source table, filtered by `restaurant_id` (and the date
column where an index has it). Indexes in place:
`idx_toast_payments_restaurant_date`, `focus_payments_rid_date_idx`,
`idx_revel_payments_restaurant`, `idx_square_payments_restaurant_created_at`.
`first_seen` and the window sums come from the same CTE. The RPC does not read
a table two times.

Return shape:

```json
{
  "source": "toast" | "revel" | "focus" | "square" | "mixed" | "none",
  "match_quality": "strong" | "good" | "fair" | "weak" | "none",
  "history_start": "2026-08-14",
  "weeks_compared": 8,
  "weeks": [
    { "week_start": "2026-09-17", "period": "before", "warmup": false,
      "returning_spend": 1234.50, "new_spend": 980.00,
      "returning_visits": 61, "returning_cards": 48, "new_cards": 70 }
  ],
  "summary": {
    "before": { "spend_per_week": 1200.00, "visits_per_card": 1.31, "avg_check": 19.80,
                "returning_cards": 210, "new_cards": 540 },
    "after":  { "...same keys..." }
  }
}
```

If no card payment exists, `source = 'none'`, `match_quality = 'none'`,
`history_start = null` and the arrays are empty.

### 4.7 Access (route and nav)

- The RPC allows owner and manager only (Q2 is closed).
- `tests/unit/areas.test.ts` requires one area for each sidebar page (the
  "drift alarm"). Thus the new nav item needs a new area:
  - New migration: `INSERT INTO public.area_catalog` a row `returning_guests`,
    path `/returning-guests`, ui group `Main`, after `reviews`, no manage tier,
    `max_level_collaborator = 'view'`. Copy the column list from
    `20260805120000_page_areas.sql`. Use `ON CONFLICT DO NOTHING`.
  - `src/lib/permissions/areaData.ts`: add the matching `PAGE_AREA_ROWS` row
    after `reviews`. Add `'returning_guests'` to the `AreaKey` union in
    `src/lib/permissions/areas.ts`.
  - No builtin role seed grants it. Thus no collaborator reaches it today
    (same as `/labor`).
- Chef and `operations_manager` get the full nav. The nav hides the item for
  every role except `owner` and `manager`.
- The page also checks the role. A caller that is not owner or manager sees a
  "no access" state. The hook does not retry on `insufficient_privilege`
  (Postgres code `42501`).

### 4.8 Frontend

New files:

- `src/lib/returningGuests.ts` — pure helpers: percent change (NULL-safe),
  chart row mapping, quality → note text, URL param parse and validate.
- `src/hooks/useReturningGuestTrends.ts` — React Query.
  - `queryKey: ['returning-guest-trends', restaurantId, campaignStart, weeks]`.
  - `enabled`: `!!restaurantId`, a valid `campaignStart`, and `weeks` in 1 .. 26
    (lesson 2026-07-24).
  - `staleTime: 60000`, `refetchOnWindowFocus: true`,
    `placeholderData: keepPreviousData`.
  - `retry`: no retry when the error code is `42501`.
- `src/components/returning-guests/ReturningGuestsSummary.tsx` — three stat
  tiles in `grid-cols-1 sm:grid-cols-3`. Each tile shows before, after and the
  change. The change uses an arrow icon and text with neutral tokens
  (`text-foreground`, `text-muted-foreground`), not green and red. An `sr-only`
  span reads "increased 12 percent". Reuse `DashboardMetricCard` if its props
  fit; if not, use the CLAUDE.md card style.
- `src/components/returning-guests/ReturningGuestsChart.tsx` — Recharts
  `LineChart`, follows `SplhTimelineChart.tsx`:
  - Wrapper `div` with `role="img"`, an `aria-label`, height `h-56`.
  - Returning line `hsl(var(--chart-1))`. New line `hsl(var(--chart-2))` with a
    dot marker on each point (not a dashed line, so the campaign marker is the
    only dashed line).
  - Dashed `ReferenceLine` at week 0 with the label "Campaign start".
  - A `Legend`. XAxis `interval="preserveStartEnd"`.
  - An `sr-only` `<table>` with a `<caption>` and `<th scope>` cells.
- `src/pages/ReturningGuests.tsx` — lazy-loaded page.
  - `PageHeader` with icon `Repeat`, title "Returning Guests". The date input
    and the period select (4 / 8 / 12) go in `actions`, in
    `flex-col sm:flex-row`.
  - Label and `SelectTrigger` use the CLAUDE.md form styles. The date input
    has `max` = the restaurant's today.
  - The note is one block with `role="note"`, `text-[13px] text-muted-foreground`.

Changes:

- `src/App.tsx` — add `const ReturningGuests = lazy(...)` and the route
  `/returning-guests` in a `ProtectedRoute`.
- `src/components/AppSidebar.nav.data.ts` — add "Returning Guests" in the
  Main group after "Reviews", icon `Repeat` (import from `lucide-react`).
  Check the mobile nav too.
- `src/components/AppSidebar.nav.ts` — hide the item for roles that are not
  owner or manager.

State:

- `start` and `weeks` live in the URL search params. No `localStorage`
  (CLAUDE.md "No Manual Caching").
- Parse rules: a `start` that is not a valid `YYYY-MM-DD` date, or is after
  today, is ignored. A `weeks` value not in {4, 8, 12} falls back to 8.
- Write with `setSearchParams(next, { replace: true })`.
- Default `weeks` = 8. No default date: the page asks for a date first.

Page states:

| State | What the owner sees |
|-------|---------------------|
| Role is not owner or manager | "Only owners and managers can see this page." No chart. |
| No date | A short prompt and the date input |
| Loading | Skeletons in the shape of three tiles and one chart |
| Error | An error message with a retry button that calls `refetch` |
| `source = 'none'` | "Not available for your POS. We need card digits from Toast, Square, Revel or Focus." No tiles, no chart. |
| `weeks_compared = 0` | Before weeks on the chart, tiles show "—", text "Come back after the first full week" |
| Data | Tiles, chart, note |

Note text by quality:

- `strong`: "Estimate. We match guests by a card ID from Square. Cash payments are not included."
- `good` / `fair`: "Estimate. We match guests by card brand and card digits. Some different cards share these digits, so numbers can be a little high. Cash payments are not included."
- `weak`: "Rough estimate. Your POS gives only the last 4 card digits. Many different cards share them, so the returning numbers are high. Use the trend, not the exact number. Cash payments are not included."
- Warm-up: "Your card history starts on {date}. Weeks near that date show too many new guests."

PCI: the page never shows a card digit. The RPC never returns one.

## 5. Tests

pgTAP `supabase/tests/returning_guest_trends.test.sql`. All dates are relative
to `CURRENT_DATE` (lesson 2026-04-21). Callers set `request.jwt.claims`
(lesson 2026-07-22). The `plan(N)` count must equal the count of assertions.

1. Non-member caller → `insufficient_privilege`. NULL `auth.uid()` → `insufficient_privilege`.
2. Staff member and chef member → `insufficient_privilege`.
3. `p_weeks` = 0, 27 and NULL → `22023`. NULL start → `22023`. Future start → `22023`.
4. `has_function_privilege('anon', 'public.get_returning_guest_trends(uuid,date,integer)', 'EXECUTE')` is false.
5. A card seen before week 0 counts as returning in week 0. A card first seen in
   week 0 counts as new in week 0 and returning in week 1.
6. Toast `VOIDED` and `DENIED` rows do not count. A Toast `NEW_STATUS` row does
   not count (allow-list contract).
7. Revel NULL-status card row does not count.
8. Tip does not count in spend. A negative amount does not count and does not
   set `first_seen`.
9. Toast restaurant with first 6 on all rows → `match_quality = 'good'`.
   Same card with and without first 6 at a restaurant under 95 % → one key.
10. A row with an empty-string last 4 does not count.
11. Focus only → `weak`. Toast + Focus → `mixed` and `weak`.
12. Square card with a fingerprint → `strong`. Square cash → not counted.
    Square payment at 23:30 local time counts on the local day.
13. Restaurant with an invalid `timezone` value → RPC does not fail (fallback).
14. No card data → `source = 'none'`, empty arrays.
15. Campaign start = today and = yesterday → `weeks_compared = 0`.
    Start 20 days ago → `weeks_compared = 2`. Cap at `p_weeks`.
16. Summary math: `avg_check = spend ÷ visits`; two payments by one card on one
    day = one visit; divide by zero → NULL.
17. Seed card digits `7391`. The result text does not contain `7391`. No JSON
    key name contains `last4`, `first6` or `digits`.

Vitest:

- `tests/unit/returningGuests.test.ts` — helpers: percent change with NULL and
  zero, URL parse fallbacks, note text per quality, chart rows.
- `tests/unit/useReturningGuestTrends.test.ts` — RPC args, `enabled` guard for
  blank restaurant, bad date and bad weeks; no retry on `42501`.
- `tests/unit/areas.test.ts` and `tests/unit/routeAreas.test.ts` stay green
  with the new area.
- `tests/unit/AppSidebar.nav.test.ts` — the item shows for owner and manager,
  and does not show for chef.

E2E: optional. Not in v1.

## 6. Performance

- The RPC reads all counted card payments of one restaurant to find
  `first_seen`. Today the largest restaurant has about 14,000 Toast payments.
  That is small.
- Toast and Revel keys come from `raw_json`. No expression index in v1. If a
  restaurant grows past about 200,000 payments, add a generated key column.
  This is a follow-up, not v1.

## 7. Rollout

- Two migrations (the RPC and the area row), one page. No data change. No backfill.
- Rollback: drop the function, delete the area row, remove the route and nav item.

## 8. Open questions

- Q1. Closed. Revel NULL-status rows do not count.
- Q2. Closed. Owner and manager only. A new area keeps the drift test green.
- Q3. Toast first-6 threshold: 95 %. Reviewers can change it.

## 9. Changes from the Phase 2.5 reviews

- Fixed the time-zone citation. The RPC now reads `restaurants.timezone` and
  has no time-zone parameter.
- Named the columns per source. Defined NULL-safe key parts.
- Explicit weeks formula and boundary tests.
- Full-signature grants and an anon privilege test.
- Access: new area, nav hidden for non-managers, a no-access page state.
- Chart and tile accessibility, neutral tokens, URL parse rules, more page states.
