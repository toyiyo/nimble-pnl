# Sling Integration Design

**Date**: 2026-02-23
**Status**: Approved
**Author**: Claude

## Overview

Integrate with [Sling](https://getsling.com) (api.getsling.com) to pull employee schedules and time punch (clock-in/out) records. Read-only polling integration following the proven Toast POS pattern: manual date-range queries, 90-day initial historical sync, and cron-driven incremental sync.

## Key Decisions

1. **Auth**: Email/password login via `/account/login` (session token)
2. **Data scope**: Raw shifts (schedules) + clock-in/out records only; our system computes hours
3. **Architecture**: Raw Sling tables + RPC sync into existing `shifts`/`time_punches` tables (mirrors Toast pattern)
4. **Employee mapping**: Integration-agnostic `employee_integration_mappings` table (supports future 7shifts, Square, etc.)
5. **Dedup**: `source_type`/`source_id` columns on `shifts` and `time_punches` (integration-agnostic)
6. **Org mapping**: One Sling org per restaurant connection
7. **Sync cadence**: 90-day initial sync (daily batches), 6-hour cron incremental, manual custom range

## Sling API Reference

- **Base URL**: `https://api.getsling.com`
- **Auth**: `POST /account/login` with `{email, password}` → `Authorization` header token
- **Tokens expire unpredictably** — refresh on 401
- **Date format**: ISO 8601 intervals for `dates` param (e.g., `2026-01-01T00:00:00/2026-01-02T00:00:00`)
- **Timezone**: Use naive timestamps (no timezone) per Sling docs; interpreted based on location timezone

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/account/login` | POST | Get auth token |
| `/users/concise` | GET | List org users (performant) |
| `/{org_id}/calendar/{user_id}` | GET | Shifts/schedule for user in date range |
| `/reports/timesheets?dates=...` | GET | Timesheet records for date range |
| `/calendar/summaries?dates=...` | GET | Hours/cost tallies (future use) |

## Database Schema

### New Tables

#### `sling_connections`
```sql
id UUID PK DEFAULT gen_random_uuid()
restaurant_id UUID FK restaurants(id) UNIQUE
email TEXT NOT NULL
password_encrypted TEXT NOT NULL
auth_token TEXT
token_fetched_at TIMESTAMPTZ
sling_org_id BIGINT
sling_org_name TEXT
last_sync_time TIMESTAMPTZ
initial_sync_done BOOLEAN DEFAULT false
sync_cursor INTEGER DEFAULT 0        -- days completed (0-90)
is_active BOOLEAN DEFAULT true
connection_status TEXT DEFAULT 'pending'  -- pending/connected/error
last_error TEXT
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
```

#### `sling_users`
```sql
id UUID PK DEFAULT gen_random_uuid()
restaurant_id UUID FK restaurants(id)
sling_user_id BIGINT NOT NULL
name TEXT
lastname TEXT
email TEXT
position TEXT
is_active BOOLEAN DEFAULT true
raw_json JSONB
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE(restaurant_id, sling_user_id)
```

#### `sling_shifts`
```sql
id UUID PK DEFAULT gen_random_uuid()
restaurant_id UUID FK restaurants(id)
sling_shift_id BIGINT NOT NULL
sling_user_id BIGINT
shift_date DATE
start_time TIMESTAMPTZ
end_time TIMESTAMPTZ
break_duration INTEGER           -- minutes
position TEXT
location TEXT
status TEXT                      -- published/planning
raw_json JSONB
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE(restaurant_id, sling_shift_id)
```

#### `sling_timesheets`
```sql
id UUID PK DEFAULT gen_random_uuid()
restaurant_id UUID FK restaurants(id)
sling_timesheet_id BIGINT NOT NULL
sling_shift_id BIGINT            -- nullable link to shift
sling_user_id BIGINT NOT NULL
punch_type TEXT NOT NULL          -- clock_in/clock_out/break_start/break_end
punch_time TIMESTAMPTZ NOT NULL
raw_json JSONB
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE(restaurant_id, sling_timesheet_id)
```

#### `employee_integration_mappings` (integration-agnostic)
```sql
id UUID PK DEFAULT gen_random_uuid()
restaurant_id UUID FK restaurants(id)
employee_id UUID FK employees(id) ON DELETE CASCADE
integration_type TEXT NOT NULL     -- 'sling', '7shifts', 'square', etc.
external_user_id TEXT NOT NULL     -- ID in external system
external_user_name TEXT
external_metadata JSONB
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE(restaurant_id, integration_type, external_user_id)
```

### Modified Tables

#### `shifts` — Add source tracking columns
```sql
ALTER TABLE shifts ADD COLUMN source_type TEXT DEFAULT 'manual';
ALTER TABLE shifts ADD COLUMN source_id TEXT;
-- Unique constraint for dedup:
CREATE UNIQUE INDEX idx_shifts_source ON shifts(restaurant_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
```

#### `time_punches` — Add source tracking columns
```sql
ALTER TABLE time_punches ADD COLUMN source_type TEXT DEFAULT 'manual';
ALTER TABLE time_punches ADD COLUMN source_id TEXT;
CREATE UNIQUE INDEX idx_time_punches_source ON time_punches(restaurant_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
```

### RLS Policies

All new tables: standard restaurant_id-based RLS matching Toast pattern. Service role bypass for edge functions.

## Edge Functions

### 1. `sling-save-credentials` (POST)
- Auth: user JWT, owner/manager role
- Input: `{ restaurantId, email, password }`
- Encrypts password via `_shared/encryption.ts`
- Upserts `sling_connections` with status='pending'

### 2. `sling-test-connection` (POST)
- Auth: user JWT, owner/manager role
- Decrypts password, calls `POST /account/login`
- On success: caches token, fetches org list
- Returns org list for user to select (or auto-select if one)
- After org selection: fetches `/users/concise`, populates `sling_users`
- Sets connection_status='connected'

### 3. `sling-sync-data` (POST) — Manual sync, user-triggered
- Dual-client pattern (user JWT for auth check, service role for data)
- State machine (mirrors Toast):
  - `initial_sync_done=false`: 1-day batches, advance sync_cursor
  - `initial_sync_done=true`: 25-hour lookback
  - Custom date range: max 90 days
- For each time window:
  - `GET /{org_id}/calendar/{user_id}?dates=<interval>` for all users → upsert `sling_shifts`
  - `GET /reports/timesheets?dates=<interval>` → upsert `sling_timesheets`
- Calls `sync_sling_to_shifts_and_punches()` RPC for incremental/custom
- Defers RPC for initial sync (handled by cron)

### 4. `sling-bulk-sync` (cron, every 6 hours)
- Service role only
- Fetches up to 5 active connections, ordered by `last_sync_time ASC`
- For each: refresh token, 25h lookback, fetch shifts + timesheets
- Calls sync RPC, updates `last_sync_time`
- 2s delay between restaurants

### Shared: `_shared/slingApiClient.ts`
- `login(email, password)` → token
- `apiGet(token, path, params)` → JSON
- `formatDateInterval(start, end)` → ISO 8601 interval string
- Token refresh on 401 (re-login)
- Error handling with structured error types

## SQL RPC Function

### `sync_sling_to_shifts_and_punches(p_restaurant_id UUID, p_start_date DATE, p_end_date DATE)`

1. Joins `sling_shifts` with `employee_integration_mappings` (type='sling')
2. Skips unmapped users
3. Upserts into `shifts` with `source_type='sling'`, `source_id=sling_shift_id::text`
4. Joins `sling_timesheets` with `employee_integration_mappings`
5. Maps timesheet types to punch_types (clock_in→clock_in, etc.)
6. Upserts into `time_punches` with `source_type='sling'`, `source_id=sling_timesheet_id::text`

## Frontend Components

### New Components
- **`useSlingConnection.ts`** — React Query hook (mirrors `useToastConnection`)
- **`useSlingIntegration.ts`** — Simple connection status hook
- **`SlingSetupWizard.tsx`** — 3-step: credentials → org select → employee mapping
- **`SlingSync.tsx`** — Sync UI using shared `SyncComponents` with `SLING_CONFIG`

### Modified Components
- **`Integrations.tsx`** — Add Sling entry under "Scheduling" category
- **`IntegrationCard.tsx`** — Wire Sling hooks + wizard + sync
- **`ShiftImportEmployeeReview.tsx`** — May need minor refactor to support API-sourced employee lists (vs CSV-parsed)

### Reused Components
- `SyncComponents.tsx` — Progress display, mode selector, connection status
- `ShiftImportEmployeeReview.tsx` — Employee matching UI

## Sync State Machine

```
Initial Setup:
  User → SlingSetupWizard
    → sling-save-credentials (encrypt, upsert, status='pending')
    → sling-test-connection (login, select org, fetch users, status='connected')
    → Employee mapping UI (write to employee_integration_mappings)

Initial 90-Day Import:
  SlingSync.executeSyncLoop()
    → sling-sync-data (sync_cursor=N, fetch day N, advance cursor)
    → repeat until sync_cursor=90, then initial_sync_done=true
    → RPC deferred to cron

Incremental Sync (cron, every 6 hours):
  sling-bulk-sync → for each connection:
    → refresh token → fetch 25h lookback → upsert raw → RPC sync

Manual Sync:
  User clicks "Sync Now" or picks custom date range
  → sling-sync-data → fetch range → upsert raw → RPC sync
```

## Testing Strategy

| Layer | Test Type | Coverage |
|-------|-----------|----------|
| `slingApiClient.ts` | Unit (Vitest) | Token refresh, date formatting, error handling |
| `sync_sling_to_shifts_and_punches` | pgTAP | Shift/punch upsert, unmapped user skipping, dedup |
| `employee_integration_mappings` | pgTAP | CRUD, uniqueness constraints, RLS |
| Edge functions | Manual + E2E | Full sync flow |
| Frontend hooks | Unit (Vitest) | Connection state, sync loop |
| Setup wizard | E2E (Playwright) | Full setup + sync flow |

## Future Considerations

- **Sling labor cost reports**: Can pull `/reports/labor` and `/labor/cost` for scheduled vs actual labor costs
- **Real-time**: Sling has no webhooks; polling is the only option
- **Token refresh**: Tokens expire unpredictably. The bulk-sync cron re-logins each run. For manual sync, refresh on 401.
- **Multi-org**: One connection per restaurant. Users with multiple Sling orgs set up separate connections.
