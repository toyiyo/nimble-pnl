# Weekly Brief Pipeline — Grafana Dashboard Queries

Connect these queries to your Supabase Postgres data source in Grafana at
https://easyshifthq.grafana.net/

## Panel 1: Queue Depth (Stat or Gauge)

Shows current number of pending jobs in the main queue.

```sql
SELECT queue_length AS "Pending Jobs",
       total_messages AS "Total Processed"
FROM pgmq.metrics('weekly_brief_jobs');
```

## Panel 2: Dead Letter Queue Depth (Stat — alert if > 0)

Shows jobs that failed after max retries.

```sql
SELECT queue_length AS "Dead Lettered"
FROM pgmq.metrics('weekly_brief_dead_letter');
```

## Panel 3: Completion Rate — Last Run (Pie Chart)

Breakdown of job statuses from the most recent enqueue cycle.

```sql
SELECT status, COUNT(*) AS count
FROM weekly_brief_job_log
WHERE created_at >= (
  SELECT MAX(created_at) - INTERVAL '2 hours'
  FROM weekly_brief_job_log WHERE status = 'queued'
)
GROUP BY status;
```

## Panel 4: Processing Duration — p50/p95/p99 (Time Series)

Performance histogram of completed worker durations over the past week.

```sql
SELECT
  date_trunc('hour', created_at) AS time,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms
FROM weekly_brief_job_log
WHERE status = 'completed'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1;
```

## Panel 5: Failures by Restaurant (Table)

Which restaurants fail most often — helps identify data quality issues.

```sql
SELECT
  r.name AS restaurant,
  COUNT(*) FILTER (WHERE jl.status = 'failed') AS failures,
  COUNT(*) FILTER (WHERE jl.status = 'dead_lettered') AS dead_lettered,
  MAX(jl.error_message) AS last_error
FROM weekly_brief_job_log jl
JOIN restaurants r ON r.id = jl.restaurant_id
WHERE jl.created_at >= NOW() - INTERVAL '30 days'
  AND jl.status IN ('failed', 'dead_lettered')
GROUP BY r.name
ORDER BY failures DESC
LIMIT 20;
```

## Panel 6: Weekly Throughput (Bar Chart)

Aggregate volume and success rate over past 12 weeks.

```sql
SELECT
  date_trunc('week', created_at) AS week,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
  COUNT(*) FILTER (WHERE status = 'dead_lettered') AS dead_lettered
FROM weekly_brief_job_log
WHERE created_at >= NOW() - INTERVAL '12 weeks'
GROUP BY 1
ORDER BY 1;
```

## Panel 7: Email Delivery Gap (Table — alert if any rows)

Briefs that were generated but never emailed (email_sent_at is NULL after 1 hour).

```sql
SELECT
  r.name AS restaurant,
  wb.brief_week_end,
  wb.computed_at,
  NOW() - wb.computed_at AS age
FROM weekly_brief wb
JOIN restaurants r ON r.id = wb.restaurant_id
WHERE wb.email_sent_at IS NULL
  AND wb.computed_at < NOW() - INTERVAL '1 hour'
ORDER BY wb.computed_at DESC
LIMIT 20;
```

## Alerts

| Alert | Condition | Severity |
|---|---|---|
| Queue stalled | `queue_length > 0` AND last `queued` entry > 2 hours old | Warning |
| Dead letter | `queue_length > 0` on `weekly_brief_dead_letter` | Critical |
| Slow processing | p95 `duration_ms > 60000` | Warning |
| Email gap | Any row from Panel 7 | Warning |
