

## Fix: Use `jsonb` instead of `json` for `net.http_post` calls

### Problem

`net.http_post()` from the `pg_net` extension accepts `jsonb` parameters for `headers` and `body`, not `json`. The current function casts both to `::json`, which causes PostgreSQL to report "function does not exist" because no overload matches that signature.

### Change

One migration that replaces `process_weekly_brief_queue()` with a single correction: remove the `::json` casts. `jsonb_build_object()` already returns `jsonb`, which is exactly what `net.http_post` expects -- no cast needed at all.

### Technical detail

```text
-- BEFORE (broken)
PERFORM net.http_post(
  url := ...,
  headers := jsonb_build_object(...)::json,   -- wrong type
  body := jsonb_build_object(...)::json        -- wrong type
);

-- AFTER (fixed)
PERFORM net.http_post(
  url := ...,
  headers := jsonb_build_object(...),          -- jsonb, matches signature
  body := jsonb_build_object(...)              -- jsonb, matches signature
);
```

### What stays the same

Everything else in the function: key extraction (`brief_week_end`), invalid payload guard, dead-letter logic, vault lookup, iteration pattern.

### Risk

Minimal -- removes unnecessary casts that were causing the type mismatch. The `pg_net` extension is already enabled (the error is about argument types, not a missing extension).

