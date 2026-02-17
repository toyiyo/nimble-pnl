

## Fix: Correct the key name in `process_weekly_brief_queue()`

### Problem

Line 35 reads `week_end` from the message payload, but the enqueue function writes it as `brief_week_end`. This single typo causes every message to fail.

### Changes (one migration, no schema changes)

**Replace `process_weekly_brief_queue()`** with three corrections:

1. **Line 35** -- extract the correct key:
   `v_msg.message->>'brief_week_end'` instead of `->>'week_end'`

2. **Lines 38-51** -- invalid payload guard: instead of trying to INSERT a row with NULLs (which violates NOT NULL), just `RAISE WARNING`, delete the message, and `CONTINUE`. No row written, no constraint violation, and the warning is visible in Postgres logs.

3. **Line 90** -- worker dispatch body: send `'brief_week_end'` instead of `'week_end'` so the edge function receives the correct key.

Everything else (vault lookup, dead-letter after 3 attempts, ops_inbox_item, `::json` casts, iteration pattern) stays exactly the same.

### Risk

Minimal -- fixes a one-word typo in three places. The 10 queued messages have valid payloads and will process on the next cron cycle.

