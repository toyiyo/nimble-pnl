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
  (`src/contexts/RestaurantContext.tsx:18`).

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

### 4.1 Card match key (inside the RPC only)

| Source | Key | Match quality |
|--------|-----|---------------|
| Square | `card_details.card.fingerprint` | `strong` |
| Toast, restaurant with first 6 on ≥ 95 % of card rows | brand + first 6 + last 4 | `good` |
| Toast, other restaurants | brand + last 4 | `fair` |
| Revel | brand + last 4 | `fair` |
| Focus | last 4 | `weak` |

Decision: the Toast rule is per restaurant, not per row. If one card has first 6
on some rows and not on others, a per-row rule gives two keys for one card. That
makes a returning guest look new. The per-restaurant rule gives one key for each
card.

The key is a text value inside a CTE. The RPC never returns it. The RPC never
writes it.

If one restaurant has card data from more than one source, the RPC uses all
sources and reports the weakest quality.

### 4.2 Which payments count (allow-lists)

Lesson 2026-05-03: count by an allow-list, not by "NOT bad".

- Toast: `payment_status IN ('CAPTURED', 'AUTHORIZED')`.
- Revel: `payment_status IN ('Captured', 'Accepted')`. NULL status rows do not
  count. Open question Q1 is about this rule.
- Focus: all rows.
- Square: `status = 'COMPLETED'`.
- All sources: `amount > 0` and a valid card key. Spend is `amount` without tip.

Date of a payment:

- Toast `payment_date`, Revel `payment_date`, Focus `business_date`: these are
  `DATE` values in the restaurant business day. The RPC uses them as they are.
- Square `created_at` is a timestamp. The RPC converts it with
  `AT TIME ZONE p_time_zone`. The RPC validates the zone against
  `pg_timezone_names` and uses `America/Chicago` if the zone is not valid
  (lesson 2026-07-24, tz guard).

### 4.3 Weeks and periods

- Week `k` starts at `p_campaign_start + 7k` and has 7 days. The campaign start
  is always the first day of week 0. Thus, the before and after periods never
  split a week.
- After period: weeks `0 .. n-1`. `n = min(p_weeks, complete weeks between
  p_campaign_start and the restaurant's yesterday)`.
- Before period: weeks `-n .. -1`. It has the same number of weeks.
- If `n = 0`, the RPC returns the before weeks only and `weeks_compared = 0`.
  The page says "Come back after the first full week".
- The chart shows `p_weeks` weeks before and the complete weeks after.

### 4.4 Returning and new

- `first_seen` of a key = the earliest date of that key in all history for the
  restaurant (not only the window).
- In week `k`, a payment is **returning** if `first_seen < week_start`.
  Otherwise it is **new**.
- `history_start` = the earliest card payment date for the restaurant.
- Toast imports only 90 days at the first sync. Early weeks thus show too many
  new cards. A week is a **warm-up week** if `week_start < history_start + 28 days`.
  The RPC flags it. The page shows a note when the before period has a warm-up week.

### 4.5 Metrics

For one period (before or after), with returning payments only:

- `spend_per_week` = returning spend ÷ number of weeks.
- `visits_per_card` = returning visits ÷ distinct returning keys.
  A visit is one distinct (key, date) pair.
- `avg_check` = returning spend ÷ returning visits.

The RPC also returns `new_cards` (distinct new keys) for each period. The page
does not show it as a headline number in v1. The chart uses it in the tooltip.

### 4.6 RPC contract

```sql
public.get_returning_guest_trends(
  p_restaurant_id  UUID,
  p_campaign_start DATE,
  p_weeks          INT  DEFAULT 8,     -- allowed: 1 .. 26
  p_time_zone      TEXT DEFAULT 'America/Chicago'
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
```

Guards, in this order, before any read:

1. `IF NOT public.user_has_restaurant_access(p_restaurant_id, true)` →
   `RAISE ... USING ERRCODE = 'insufficient_privilege'`. Owner and manager only.
   Open question Q2 is about this rule.
2. `p_weeks` outside 1 .. 26 → `RAISE ... USING ERRCODE = '22023'`.
3. `p_campaign_start` after the restaurant's today → `22023`.

Grants: `REVOKE ALL ... FROM PUBLIC, anon`. `GRANT EXECUTE ... TO authenticated`.

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

If no card payment exists, `source = 'none'` and the arrays are empty.

Money: `ROUND(..., 2)` in SQL. Division by zero gives `NULL`, not 0.

### 4.7 Frontend

New files:

- `src/lib/returningGuests.ts` — pure helpers: percent change (NULL-safe),
  chart row mapping, quality → note text, URL param parse and validate.
- `src/hooks/useReturningGuestTrends.ts` — React Query. Query key holds every
  RPC input. `enabled` gates on `restaurantId` and a valid `campaignStart`
  (lesson 2026-07-24). `staleTime: 60000`, `refetchOnWindowFocus: true`.
- `src/components/returning-guests/ReturningGuestsSummary.tsx` — three stat
  tiles. Each tile shows before, after and the change. The change uses an arrow
  icon and text, not color only.
- `src/components/returning-guests/ReturningGuestsChart.tsx` — Recharts
  `LineChart`, two lines, a dashed `ReferenceLine` at week 0. Colors come from
  CSS tokens (`hsl(var(--primary))`, `hsl(var(--muted-foreground))`).
  The chart has an `aria-label` and a visually hidden table with the same data.
- `src/pages/ReturningGuests.tsx` — page with `PageHeader`, date input,
  period select (4 / 8 / 12), the summary, the chart and the note.

Changes:

- `src/App.tsx` — add the route `/returning-guests` in a `ProtectedRoute`.
- `src/components/AppSidebar.nav.data.ts` — add "Returning Guests" in the
  Main group after "Reviews", icon `Repeat`.

State:

- `start` and `weeks` live in the URL search params. No `localStorage`
  (CLAUDE.md "No Manual Caching").
- Default `weeks` = 8. No default date: the page asks for a date first.

Page states:

| State | What the owner sees |
|-------|---------------------|
| No date | A short prompt and the date input |
| Loading | Skeletons for tiles and chart |
| Error | An error message with a retry button |
| `source = 'none'` | "Not available for your POS. We need card digits from Toast, Square, Revel or Focus." |
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
(lesson 2026-07-22).

1. Non-member caller → `insufficient_privilege`.
2. Staff member caller → `insufficient_privilege`.
3. `p_weeks = 0` and `27` → `22023`. Future campaign date → `22023`.
4. A card seen before week 0 counts as returning in week 0. A card first seen in
   week 0 counts as new in week 0 and returning in week 1.
5. Toast `VOIDED` and `DENIED` rows do not count. A Toast `NEW_STATUS` row does
   not count (allow-list contract).
6. Tip does not count in spend.
7. Toast restaurant with first 6 on all rows → `match_quality = 'good'`.
   Same card with and without first 6 at a restaurant under 95 % → one key.
8. Focus only → `match_quality = 'weak'`.
9. Square card with a fingerprint → `strong`. Square cash → not counted.
10. No card data → `source = 'none'`, empty arrays.
11. `weeks_compared` = number of complete weeks, capped at `p_weeks`.
12. Summary math: `avg_check = spend ÷ visits`, divide by zero → NULL.
13. The JSON never contains a 4-digit card value (scan the text of the result).

Vitest:

- `tests/unit/returningGuests.test.ts` — helpers.
- `tests/unit/useReturningGuestTrends.test.ts` — RPC args, `enabled` guard for
  blank restaurant and bad date.

E2E: optional. Not in v1.

## 6. Performance

- The RPC reads all card payments of one restaurant to find `first_seen`.
  Today the largest restaurant has about 14,000 Toast payments. That is small.
- Toast and Revel keys come from `raw_json`. No expression index in v1. If a
  restaurant grows past about 200,000 payments, add a generated key column.
  This is a follow-up, not v1.

## 7. Rollout

- One migration, one RPC, one page. No data change. No backfill.
- Rollback: drop the function and remove the route.

## 8. Open questions

- Q1. Revel NULL-status rows with card digits (87 rows). v1 excludes them.
- Q2. Access: owner and manager only (`true`). Collaborator roles do not see it.
- Q3. Toast first-6 threshold: 95 %. Reviewers can change it.
