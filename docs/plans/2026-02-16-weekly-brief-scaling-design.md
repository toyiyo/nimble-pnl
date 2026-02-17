# Weekly Brief Pipeline Scaling Design

**Goal:** Replace the monolithic `generate-weekly-brief` edge function with a queue-based fan-out pipeline that handles 200+ restaurants reliably with automatic retry, observability, and dead-letter handling.

**Architecture:** pgmq queue + per-restaurant worker edge functions dispatched via pg_net, with a Postgres-based job log table for Grafana dashboards.

**Tech Stack:** pgmq (message queue), pg_net (async HTTP), pg_cron (scheduling), Resend batch API (email), Grafana (observability via Postgres data source)

---

## Architecture

Three components replace the current monolithic function:

### 1. Enqueue (Monday 6 AM UTC)

A `pg_cron` job calls `enqueue_weekly_brief_jobs()`, a SQL function that:
- Computes the most recent completed week (Mon–Sun)
- Queries all restaurants
- Skips restaurants that already have a `weekly_brief` row for this week
- Calls `pgmq.send('weekly_brief_jobs', ...)` per restaurant
- Logs each enqueue to `weekly_brief_job_log` with `status = 'queued'`

### 2. Process Queue (every 60s)

A `pg_cron` job calls `process_weekly_brief_queue()`, a SQL function that:
- Reads a batch of 5 messages from `weekly_brief_jobs` (visibility timeout = 5 minutes)
- For each message, calls `pg_net.http_post()` to invoke `generate-weekly-brief-worker`
- pg_net calls are non-blocking — 5 workers run in parallel

### 3. Worker (one per restaurant)

`generate-weekly-brief-worker` edge function handles exactly one restaurant:
1. Writes `status = 'processing'` to job log
2. Runs variance engine (`compute_weekly_variances`)
3. Runs anomaly detectors (uncategorized backlog, metric anomalies, reconciliation gaps)
4. Aggregates weekly metrics from `daily_pnl`
5. Builds recommendations from flagged variances
6. Generates AI narrative via `callAIWithFallback`
7. Upserts `weekly_brief` row
8. Fires `send-weekly-brief-email` via pg_net (non-blocking)
9. On success: deletes pgmq message, writes `status = 'completed'` + `duration_ms`
10. On failure: writes `status = 'failed'` + `error_message`. Message becomes visible again after 5 min timeout for auto-retry.
11. After 3 failed attempts (`read_ct >= 3`): moves to dead-letter, writes `status = 'dead_lettered'`, creates `ops_inbox_item` to alert the owner.

### Data Flow

```
pg_cron (Monday 6 AM)
  └─► enqueue_weekly_brief_jobs()
        └─► pgmq.send() per restaurant → 'weekly_brief_jobs' queue

pg_cron (every 60s)
  └─► process_weekly_brief_queue()
        └─► pgmq.read(batch=5, vt=300)
        └─► pg_net.http_post() per job → generate-weekly-brief-worker

generate-weekly-brief-worker (one restaurant)
  ├─► variance + metrics + LLM + upsert weekly_brief
  ├─► pg_net → send-weekly-brief-email
  ├─► Success: pgmq.delete(msg_id) + job_log 'completed'
  └─► Failure: job_log 'failed', message re-appears after 5 min

Dead-letter (read_ct >= 3):
  └─► pgmq.send('weekly_brief_dead_letter', msg)
  └─► pgmq.delete('weekly_brief_jobs', msg_id)
  └─► job_log 'dead_lettered' + ops_inbox_item
```

## Observability

### Job Log Table

`weekly_brief_job_log` records every state transition:

| Column | Type | Purpose |
|---|---|---|
| id | uuid PK | Row ID |
| restaurant_id | uuid FK | Which restaurant |
| brief_week_end | date | Which week |
| status | text | queued, processing, completed, failed, dead_lettered |
| attempt | int | Which retry (1, 2, 3) |
| error_message | text | Null on success |
| duration_ms | int | Worker processing time |
| created_at | timestamptz | Log entry timestamp |

### Grafana Dashboards (Postgres data source)

**Weekly Brief Pipeline** dashboard:
- **Queue depth**: `SELECT * FROM pgmq.metrics('weekly_brief_jobs')` — pending, processed counts
- **Completion rate**: completed / total over the last run
- **Processing duration**: p50/p95/p99 histogram of `duration_ms`
- **Failure rate by restaurant**: which restaurants consistently fail
- **Time to completion**: queued → completed elapsed time

**Alerts:**
- Queue depth > 0 after 2 hours past cron → stalled
- Dead-letter count > 0 → manual intervention needed
- Average duration > 60s → performance degrading

## Email Delivery at Scale

- Swap sequential Resend calls for **Resend batch API** (`POST /emails/batch`, up to 100 per call)
- Email sending stays fire-and-forget from the worker
- Idempotency preserved via `email_sent_at` check
- Grafana alert: briefs with `email_sent_at IS NULL` after 1 hour

## Migration & Rollout

### New Migration

1. `CREATE EXTENSION pgmq` — enable the extension
2. `SELECT pgmq.create('weekly_brief_jobs')` — job queue
3. `SELECT pgmq.create('weekly_brief_dead_letter')` — dead-letter queue
4. `CREATE TABLE weekly_brief_job_log(...)` — observability table with RLS
5. `CREATE FUNCTION enqueue_weekly_brief_jobs()` — enqueue all restaurants
6. `CREATE FUNCTION process_weekly_brief_queue()` — read batch + dispatch workers via pg_net
7. Reschedule crons:
   - Replace `generate-weekly-briefs` (Monday 6 AM) → calls `enqueue_weekly_brief_jobs()`
   - Add `process-weekly-brief-queue` (every 60s) → calls `process_weekly_brief_queue()`

### Edge Function Changes

1. **New:** `generate-weekly-brief-worker/index.ts` — single-restaurant worker with job log writes and pgmq message management
2. **Modify:** `send-weekly-brief-email/index.ts` — swap loop for Resend batch API
3. **Keep:** `generate-weekly-brief/index.ts` — repurpose as manual trigger / fallback

### What Stays the Same

- `weekly_brief` table schema
- `compute_weekly_variances()` SQL function
- Anomaly detector SQL functions
- Frontend `WeeklyBrief.tsx`

### Rollout

- All changes via PR
- After merge, next Monday cron fires the new enqueue function
- Monitor Grafana dashboard for first run
- Old `generate-weekly-brief` stays deployed as manual fallback

## Capacity

| Metric | Value |
|---|---|
| Restaurants per enqueue batch | Unlimited (all queued at once) |
| Workers per 60s cycle | 5 (configurable in `process_weekly_brief_queue`) |
| Worker duration | ~5-15s per restaurant |
| Time to process 200 restaurants | ~40 cycles × 60s = ~40 min |
| Time to process 500 restaurants | ~100 cycles × 60s = ~100 min |
| Max retries before dead-letter | 3 |
| Retry delay (visibility timeout) | 5 minutes |
