# Sales hour-by-hour comparison — design

Stacks on PR 881 (`feature/sales-daily-series-rpc`).

## Problem

The POS Sales trends panel compares the current range to a prior period on
the "Sales by day" chart and on the KPI row. The "Time of day" chart has no
comparison. It shows only the current period
(`src/components/pos-sales/SalesTrendsPanel.tsx:278-280`).

The panel loads the prior period with `get_sales_daily_series`
(`src/components/pos-sales/SalesTrendsPanel.tsx:84-94`). That RPC returns
only `pos_systems` and `by_day`
(`supabase/migrations/20261122150000_get_sales_daily_series.sql:83-110`).
It has no time zone parameter, so it cannot bucket by hour.

A production timing on the largest restaurant (90 days, 27k rows) gave:
`get_sales_trends` about 225 ms, `get_sales_daily_series` about 117 ms, and
`get_sales_daily_series` plus a `by_hour` section about 172 ms. An optional
hour section keeps the prior call cheaper than a second `get_sales_trends`.

## Decision

### RPC

Replace `get_sales_daily_series(UUID, DATE, DATE)` with
`get_sales_daily_series(p_restaurant_id UUID, p_start_date DATE,
p_end_date DATE, p_time_zone TEXT DEFAULT 'America/Chicago',
p_include_hours BOOLEAN DEFAULT false)`.

- A new migration drops the 3-argument signature and creates the
  5-argument signature. Two overloads would make a call with three named
  arguments ambiguous in PostgREST. A 3-argument call still works, because
  the two new parameters have defaults.
- `p_include_hours = false`: the payload is the same as before. There is no
  `by_hour` key, and the function does not compute the hour bucket.
- `p_include_hours = true`: the payload also has `by_hour`. The rows,
  the keys, the sort order, and `ROUND(..., 2)` are copies of the
  `by_hour` section of `get_sales_trends`
  (`supabase/migrations/20260720010000_get_sales_trends.sql:121-138`).
- The hour bucket rule is a copy of `get_sales_trends`
  (`20260720010000_get_sales_trends.sql:77-83`): `sold_at AT TIME ZONE
  v_time_zone` when `sold_at` is set, else `sale_time`, else NULL. A row with
  a NULL bucket is not in `by_hour`.
- `v_time_zone := COALESCE(p_time_zone, 'America/Chicago')`, the same as
  `get_sales_trends` (`20260720010000_get_sales_trends.sql:49`).
- Each `by_hour` row has `day_count`: the number of distinct `sale_date`
  values with sales in that hour for that POS. This is the same field as in
  `get_sales_trends` (`20260720010000_get_sales_trends.sql:133`). The pgTAP
  test then compares the two `by_hour` arrays for equality.
- The security model, the membership check, the revenue predicate, and the
  grants do not change.

### Client

- `parseSalesDailySeries` accepts an optional `by_hour` array. It uses the
  existing `parseHourRow` guard (`src/lib/salesTrends.ts:157-167`).
- `useSalesDailySeries` gets two options: `timeZone` (passed through
  `safeTz`, the same as `useSalesTrends` at `src/hooks/useSalesTrends.ts:35`)
  and `includeHours`. Both go into the query key.
- `toTrendsData` keeps `by_hour` when it is present.
- The panel asks for hours on the prior call. It passes the restaurant time
  zone, so both periods use the same hour buckets.

### Per-day comparison

The two periods can have different day counts. A month range compares to the
prior month, so Mar 1-31 compares to Feb 1-28
(`src/lib/comparisonRange.ts:63-70`). The "Time of day" bars show the total
revenue for each hour over the current range
(`src/lib/salesTrends.ts:368-394`). A raw prior total for a 28-day period is
not comparable to a 31-day total.

The chart compares per-day averages. It does not change the current bars.
It scales the prior hour totals to the length of the current range:

```text
prior_shown[h] = prior_total[h] × (current_days / prior_days)
```

`prior_shown[h] / current_days` equals `prior_total[h] / prior_days`, so
the dashed line and the bars compare the per-day average of each hour. When
the two periods have the same length, the factor is 1 and the line shows the
raw prior total. `current_days` and `prior_days` are calendar days of each
range.

The chart does not use `day_count` for the average. Two reasons:

1. `day_count` is per POS. The "All POS" view needs the distinct days over
   all POS for an hour. The per-POS counts cannot give that number when two
   POS sell on different days.
2. A per-hour denominator makes a rare hour look large. One $500 sale at
   3 AM on one day gives an "average" of $500 for 3 AM.

The calendar-day factor has neither problem. `day_count` stays in the
payload for the contract with `get_sales_trends`.

### Chart

- `TimeOfDayChart` gets `showPrior` and `priorScale`. It draws the prior
  series as a dashed `Line` on the revenue axis. The style is the same as
  the dashed prior line of `SalesByDayChart`
  (`src/components/pos-sales/SalesByDayChart.tsx:94-99`).
- The tooltip shows a "Previous period" row.
- The accessible name says that the prior period is dashed. When the factor
  is not 1, it also says that the prior period is scaled to the days of this
  period.
- If the prior period has no hour rows, the chart shows no prior line. Zeros
  would say "no sales", but the true state is "no hour data".

## Deploy order and rollback

**Deploy order.** Apply the migration before the frontend. The frontend sends
`p_time_zone` and `p_include_hours` for the prior call of the panel. Before the
migration, PostgREST returns `PGRST202` for that call, and the whole trends
panel shows an error. `deploy-supabase.yml` and Vercel both start on a push to
`main`, and their order is not fixed. Run the database deploy first, or hold
the frontend deploy until the migration is applied.

A call without `includeHours` sends only the restaurant and the two dates. That
call works before and after the migration.

**Rollback.** Revert the frontend first. A 3-argument call works on the new
function, because the two new parameters have defaults.

To revert the database, add a new migration. Do not edit
`20261122160000_get_sales_daily_series_by_hour.sql`. The new migration:

1. Drops the 5-argument function:
   `DROP FUNCTION IF EXISTS public.get_sales_daily_series(UUID, DATE, DATE, TEXT, BOOLEAN);`
2. Copies the `CREATE FUNCTION`, `REVOKE`, `GRANT`, and `COMMENT` statements
   from `20261122150000_get_sales_daily_series.sql` without change.

Apply the database rollback only after the frontend revert is live. The
current frontend sends 5 arguments, and the 3-argument function rejects them.

## Tests

- pgTAP: the `by_hour` array equals the `by_hour` of `get_sales_trends` for
  the same restaurant, range, and time zone. Test the `sold_at` bucket, the
  `sale_time` fallback, the NULL exclusion, a second time zone, and the
  absent key when `p_include_hours` is false.
- Unit: the parser with and without `by_hour`, the hook arguments and query
  key, the scale helper, the prior hour series, and the panel wiring.
- E2E: the existing period comparison spec waits for the prior RPC. Change it
  only if the new arguments break it.
