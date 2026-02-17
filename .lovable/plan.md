

## Fix: Column name mismatch in `ops_inbox_item` INSERT

### Problem

The `process_weekly_brief_queue()` function inserts into `ops_inbox_item` using columns `type, title, body, severity, source`, but the actual table schema (from the `20260214100000_ai_operator.sql` migration) uses different column names: `kind, title, description, priority, created_by`.

### Change

One migration to replace `process_weekly_brief_queue()` with the corrected column names in the dead-letter INSERT statement:

```text
-- BEFORE (wrong column names)
INSERT INTO ops_inbox_item (restaurant_id, type, title, body, severity, source)
VALUES (..., 'weekly_brief_failure', ..., ..., 'high', 'system');

-- AFTER (matches actual schema)
INSERT INTO ops_inbox_item (restaurant_id, kind, title, description, priority, created_by)
VALUES (..., 'weekly_brief_failure', ..., ..., 1, 'system');
```

Column mapping:
- `type` becomes `kind` (text)
- `body` becomes `description` (text)
- `severity` becomes `priority` (integer: 1 = high)
- `source` becomes `created_by` (text)

### What stays the same

Everything else in the function: vault lookup, `net.http_post` call (now correctly using jsonb), dead-letter logic flow, invalid payload guard.

### Risk

Minimal -- only changes column names to match the existing table schema.

