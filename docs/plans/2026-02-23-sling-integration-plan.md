# Sling Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate with Sling (getsling.com) to pull employee schedules and time punches via polling, following the proven Toast POS integration pattern.

**Architecture:** Raw Sling tables (`sling_connections`, `sling_users`, `sling_shifts`, `sling_timesheets`) store API responses verbatim. An RPC function syncs data into existing `shifts`/`time_punches` tables via `employee_integration_mappings`. Edge functions handle auth, sync, and cron. Frontend reuses `SyncComponents` and `ShiftImportEmployeeReview`.

**Tech Stack:** Supabase (PostgreSQL, Edge Functions/Deno), React + React Query, shared encryption utilities, pgTAP for SQL tests, Vitest for unit tests.

**Design doc:** `docs/plans/2026-02-23-sling-integration-design.md`

---

### Task 1: Database Migration — Core Tables

**Files:**
- Create: `supabase/migrations/20260223100000_sling_integration.sql`
- Test: `supabase/tests/sling_integration.test.sql`

**Step 1: Write the pgTAP test**

```sql
-- supabase/tests/sling_integration.test.sql
BEGIN;
SELECT plan(12);

-- Test tables exist
SELECT has_table('sling_connections');
SELECT has_table('sling_users');
SELECT has_table('sling_shifts');
SELECT has_table('sling_timesheets');
SELECT has_table('employee_integration_mappings');

-- Test unique constraints
SELECT has_index('sling_connections', 'sling_connections_restaurant_id_key');
SELECT has_index('sling_users', 'sling_users_restaurant_id_sling_user_id_key');
SELECT has_index('sling_shifts', 'sling_shifts_restaurant_id_sling_shift_id_key');
SELECT has_index('sling_timesheets', 'sling_timesheets_restaurant_id_sling_timesheet_id_key');
SELECT has_index('employee_integration_mappings', 'employee_integration_mappings_restaurant_id_integration_type_key');

-- Test RLS is enabled
SELECT has_policy('sling_connections', 'Users can view sling connections for their restaurants');
SELECT has_policy('employee_integration_mappings', 'Users can view integration mappings for their restaurants');

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — tables don't exist yet

**Step 3: Write the migration**

```sql
-- supabase/migrations/20260223100000_sling_integration.sql

-- ============================================================
-- Sling Integration Tables
-- ============================================================

-- 1. sling_connections — one row per restaurant
CREATE TABLE IF NOT EXISTS sling_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  auth_token TEXT,
  token_fetched_at TIMESTAMPTZ,
  sling_org_id BIGINT,
  sling_org_name TEXT,
  last_sync_time TIMESTAMPTZ,
  initial_sync_done BOOLEAN NOT NULL DEFAULT false,
  sync_cursor INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  connection_status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sling_connections_restaurant_id_key UNIQUE (restaurant_id)
);

-- 2. sling_users — cached user list from Sling org
CREATE TABLE IF NOT EXISTS sling_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  sling_user_id BIGINT NOT NULL,
  name TEXT,
  lastname TEXT,
  email TEXT,
  position TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sling_users_restaurant_id_sling_user_id_key UNIQUE (restaurant_id, sling_user_id)
);

-- 3. sling_shifts — raw shift data from Sling calendar API
CREATE TABLE IF NOT EXISTS sling_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  sling_shift_id BIGINT NOT NULL,
  sling_user_id BIGINT,
  shift_date DATE,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  break_duration INTEGER DEFAULT 0,
  position TEXT,
  location TEXT,
  status TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sling_shifts_restaurant_id_sling_shift_id_key UNIQUE (restaurant_id, sling_shift_id)
);

-- 4. sling_timesheets — raw clock-in/out records from Sling
CREATE TABLE IF NOT EXISTS sling_timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  sling_timesheet_id BIGINT NOT NULL,
  sling_shift_id BIGINT,
  sling_user_id BIGINT NOT NULL,
  punch_type TEXT NOT NULL,
  punch_time TIMESTAMPTZ NOT NULL,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sling_timesheets_restaurant_id_sling_timesheet_id_key UNIQUE (restaurant_id, sling_timesheet_id)
);

-- 5. employee_integration_mappings — integration-agnostic employee linking
CREATE TABLE IF NOT EXISTS employee_integration_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_user_name TEXT,
  external_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_integration_mappings_restaurant_id_integration_type_key
    UNIQUE (restaurant_id, integration_type, external_user_id)
);

-- ============================================================
-- Source tracking on existing tables (for dedup across integrations)
-- ============================================================

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual';
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS source_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_source_dedup
  ON shifts(restaurant_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual';
ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS source_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_punches_source_dedup
  ON time_punches(restaurant_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sling_connections_restaurant ON sling_connections(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sling_users_restaurant ON sling_users(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sling_users_sling_user_id ON sling_users(restaurant_id, sling_user_id);
CREATE INDEX IF NOT EXISTS idx_sling_shifts_restaurant ON sling_shifts(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sling_shifts_date ON sling_shifts(restaurant_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_sling_timesheets_restaurant ON sling_timesheets(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sling_timesheets_punch_time ON sling_timesheets(restaurant_id, punch_time);
CREATE INDEX IF NOT EXISTS idx_employee_integration_mappings_restaurant ON employee_integration_mappings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_employee_integration_mappings_employee ON employee_integration_mappings(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_integration_mappings_lookup ON employee_integration_mappings(restaurant_id, integration_type);

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE sling_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sling_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sling_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sling_timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_integration_mappings ENABLE ROW LEVEL SECURITY;

-- sling_connections: view/insert/update/delete for owners+managers
CREATE POLICY "Users can view sling connections for their restaurants"
  ON sling_connections FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = sling_connections.restaurant_id AND ur.user_id = auth.uid())
  );
CREATE POLICY "Managers can manage sling connections"
  ON sling_connections FOR ALL USING (
    EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = sling_connections.restaurant_id AND ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager'))
  );

-- sling_users: view for all restaurant members
CREATE POLICY "Users can view sling users for their restaurants"
  ON sling_users FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = sling_users.restaurant_id AND ur.user_id = auth.uid())
  );

-- sling_shifts: view for all restaurant members
CREATE POLICY "Users can view sling shifts for their restaurants"
  ON sling_shifts FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = sling_shifts.restaurant_id AND ur.user_id = auth.uid())
  );

-- sling_timesheets: view for all restaurant members
CREATE POLICY "Users can view sling timesheets for their restaurants"
  ON sling_timesheets FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = sling_timesheets.restaurant_id AND ur.user_id = auth.uid())
  );

-- employee_integration_mappings: view for all, manage for owners+managers
CREATE POLICY "Users can view integration mappings for their restaurants"
  ON employee_integration_mappings FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = employee_integration_mappings.restaurant_id AND ur.user_id = auth.uid())
  );
CREATE POLICY "Managers can manage integration mappings"
  ON employee_integration_mappings FOR ALL USING (
    EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = employee_integration_mappings.restaurant_id AND ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager'))
  );

-- Service role bypass for edge functions (INSERT/UPDATE/DELETE from cron/sync)
CREATE POLICY "Service role can manage sling_users" ON sling_users FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage sling_shifts" ON sling_shifts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage sling_timesheets" ON sling_timesheets FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage sling_connections" ON sling_connections FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage integration_mappings" ON employee_integration_mappings FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- Triggers for updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_sling_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sling_connections_updated_at BEFORE UPDATE ON sling_connections FOR EACH ROW EXECUTE FUNCTION update_sling_updated_at();
CREATE TRIGGER update_sling_users_updated_at BEFORE UPDATE ON sling_users FOR EACH ROW EXECUTE FUNCTION update_sling_updated_at();
CREATE TRIGGER update_sling_shifts_updated_at BEFORE UPDATE ON sling_shifts FOR EACH ROW EXECUTE FUNCTION update_sling_updated_at();
CREATE TRIGGER update_sling_timesheets_updated_at BEFORE UPDATE ON sling_timesheets FOR EACH ROW EXECUTE FUNCTION update_sling_updated_at();
CREATE TRIGGER update_employee_integration_mappings_updated_at BEFORE UPDATE ON employee_integration_mappings FOR EACH ROW EXECUTE FUNCTION update_sling_updated_at();
```

**Step 4: Apply migration and run test**

Run: `npm run db:reset && npm run test:db`
Expected: All 12 pgTAP tests PASS

**Step 5: Commit**

```bash
git add supabase/migrations/20260223100000_sling_integration.sql supabase/tests/sling_integration.test.sql
git commit -m "feat(sling): add database schema for Sling integration"
```

---

### Task 2: Database Migration — Sync RPC Function

**Files:**
- Create: `supabase/migrations/20260223100100_sling_sync_rpc.sql`
- Test: `supabase/tests/sling_sync_rpc.test.sql`

**Step 1: Write the pgTAP test**

```sql
-- supabase/tests/sling_sync_rpc.test.sql
BEGIN;
SELECT plan(4);

-- Test function exists
SELECT has_function('sync_sling_to_shifts_and_punches', ARRAY['uuid', 'date', 'date']);

-- Test it runs without error on empty data
SELECT lives_ok(
  $$SELECT sync_sling_to_shifts_and_punches('00000000-0000-0000-0000-000000000000'::UUID, '2026-01-01'::DATE, '2026-01-31'::DATE)$$,
  'sync function runs on empty data'
);

-- Test with valid data (insert test fixtures first)
-- Insert a test restaurant
INSERT INTO restaurants (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Test Restaurant');

-- Insert a test employee
INSERT INTO employees (id, restaurant_id, name, position, hourly_rate)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'John Doe', 'Server', 1500);

-- Insert integration mapping
INSERT INTO employee_integration_mappings (restaurant_id, employee_id, integration_type, external_user_id, external_user_name)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'sling', '99001', 'John Doe');

-- Insert a sling shift
INSERT INTO sling_shifts (restaurant_id, sling_shift_id, sling_user_id, shift_date, start_time, end_time, break_duration, position, status)
VALUES ('11111111-1111-1111-1111-111111111111', 50001, 99001, '2026-01-15', '2026-01-15 09:00:00', '2026-01-15 17:00:00', 30, 'Server', 'published');

-- Insert a sling timesheet (clock_in)
INSERT INTO sling_timesheets (restaurant_id, sling_timesheet_id, sling_shift_id, sling_user_id, punch_type, punch_time)
VALUES ('11111111-1111-1111-1111-111111111111', 60001, 50001, 99001, 'clock_in', '2026-01-15 08:55:00');

-- Run sync
SELECT lives_ok(
  $$SELECT sync_sling_to_shifts_and_punches('11111111-1111-1111-1111-111111111111'::UUID, '2026-01-01'::DATE, '2026-01-31'::DATE)$$,
  'sync function processes test data'
);

-- Verify shift was synced
SELECT is(
  (SELECT COUNT(*) FROM shifts WHERE restaurant_id = '11111111-1111-1111-1111-111111111111' AND source_type = 'sling')::INTEGER,
  1,
  'shift was synced from sling_shifts'
);

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — function doesn't exist

**Step 3: Write the RPC function**

```sql
-- supabase/migrations/20260223100100_sling_sync_rpc.sql

CREATE OR REPLACE FUNCTION sync_sling_to_shifts_and_punches(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_start DATE := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '90 days')::DATE);
  v_end DATE := COALESCE(p_end_date, CURRENT_DATE);
BEGIN
  -- Step 1: Sync shifts from sling_shifts → shifts
  -- Only for users that have an employee mapping
  INSERT INTO shifts (
    restaurant_id, employee_id, start_time, end_time, break_duration,
    position, status, notes, source_type, source_id
  )
  SELECT
    ss.restaurant_id,
    eim.employee_id,
    ss.start_time,
    ss.end_time,
    COALESCE(ss.break_duration, 0),
    COALESCE(ss.position, 'Unassigned'),
    CASE ss.status
      WHEN 'published' THEN 'scheduled'
      WHEN 'planning' THEN 'scheduled'
      ELSE 'scheduled'
    END,
    'Synced from Sling',  -- notes
    'sling',
    ss.sling_shift_id::TEXT
  FROM sling_shifts ss
  INNER JOIN employee_integration_mappings eim
    ON eim.restaurant_id = ss.restaurant_id
    AND eim.integration_type = 'sling'
    AND eim.external_user_id = ss.sling_user_id::TEXT
  WHERE ss.restaurant_id = p_restaurant_id
    AND ss.shift_date BETWEEN v_start AND v_end
    AND ss.sling_user_id IS NOT NULL
  ON CONFLICT (restaurant_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET
    employee_id = EXCLUDED.employee_id,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    break_duration = EXCLUDED.break_duration,
    position = EXCLUDED.position,
    status = EXCLUDED.status,
    updated_at = NOW();

  -- Step 2: Sync timesheets from sling_timesheets → time_punches
  INSERT INTO time_punches (
    restaurant_id, employee_id, shift_id, punch_type, punch_time,
    notes, source_type, source_id
  )
  SELECT
    st.restaurant_id,
    eim.employee_id,
    s.id,  -- matched shift (may be NULL)
    st.punch_type,
    st.punch_time,
    'Synced from Sling',
    'sling',
    st.sling_timesheet_id::TEXT
  FROM sling_timesheets st
  INNER JOIN employee_integration_mappings eim
    ON eim.restaurant_id = st.restaurant_id
    AND eim.integration_type = 'sling'
    AND eim.external_user_id = st.sling_user_id::TEXT
  LEFT JOIN shifts s
    ON s.restaurant_id = st.restaurant_id
    AND s.source_type = 'sling'
    AND s.source_id = st.sling_shift_id::TEXT
  WHERE st.restaurant_id = p_restaurant_id
    AND st.punch_time::DATE BETWEEN v_start AND v_end
  ON CONFLICT (restaurant_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET
    employee_id = EXCLUDED.employee_id,
    shift_id = EXCLUDED.shift_id,
    punch_type = EXCLUDED.punch_type,
    punch_time = EXCLUDED.punch_time,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated and service_role
GRANT EXECUTE ON FUNCTION sync_sling_to_shifts_and_punches(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_sling_to_shifts_and_punches(UUID, DATE, DATE) TO service_role;
```

**Step 4: Apply migration and run test**

Run: `npm run db:reset && npm run test:db`
Expected: All 4 pgTAP tests PASS

**Step 5: Commit**

```bash
git add supabase/migrations/20260223100100_sling_sync_rpc.sql supabase/tests/sling_sync_rpc.test.sql
git commit -m "feat(sling): add sync_sling_to_shifts_and_punches RPC function"
```

---

### Task 3: Shared Sling API Client

**Files:**
- Create: `supabase/functions/_shared/slingApiClient.ts`
- Test: `tests/unit/slingApiClient.test.ts`

**Step 1: Write the unit test**

```typescript
// tests/unit/slingApiClient.test.ts
import { describe, it, expect } from 'vitest';
import { formatSlingDateInterval, parseSlingShiftEvents, parseSlingTimesheetReport } from './slingApiClientHelpers';

// We test the pure helper functions (not the API-calling functions which need Deno)

describe('formatSlingDateInterval', () => {
  it('formats two dates into ISO 8601 interval', () => {
    const result = formatSlingDateInterval('2026-01-15', '2026-01-16');
    expect(result).toBe('2026-01-15T00:00:00/2026-01-16T23:59:59');
  });
});

describe('parseSlingShiftEvents', () => {
  it('extracts shift data from calendar response', () => {
    const events = [
      {
        id: 12345,
        type: 'shift',
        dtstart: '2026-01-15T09:00:00',
        dtend: '2026-01-15T17:00:00',
        breakDuration: 30,
        status: 'published',
        user: { id: 99001 },
        location: { id: 1, name: 'Main Floor' },
        position: { id: 2, name: 'Server' },
      },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sling_shift_id: 12345,
      sling_user_id: 99001,
      start_time: '2026-01-15T09:00:00',
      end_time: '2026-01-15T17:00:00',
      break_duration: 30,
      position: 'Server',
      location: 'Main Floor',
      status: 'published',
    });
  });

  it('skips non-shift events', () => {
    const events = [
      { id: 1, type: 'availability', dtstart: '2026-01-15T09:00:00', dtend: '2026-01-15T17:00:00' },
    ];
    const result = parseSlingShiftEvents(events);
    expect(result).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/slingApiClient.test.ts`
Expected: FAIL — module not found

**Step 3: Write the Sling API client helpers (testable pure functions)**

Create `src/utils/slingApiClientHelpers.ts` with the pure parsing functions that can be tested in Vitest. The actual Deno edge function client will import similar logic.

```typescript
// src/utils/slingApiClientHelpers.ts

export interface ParsedSlingShift {
  sling_shift_id: number;
  sling_user_id: number | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  break_duration: number;
  position: string;
  location: string;
  status: string;
  raw_json: Record<string, unknown>;
}

export interface ParsedSlingTimesheet {
  sling_timesheet_id: number;
  sling_shift_id: number | null;
  sling_user_id: number;
  punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  punch_time: string;
  raw_json: Record<string, unknown>;
}

export function formatSlingDateInterval(startDate: string, endDate: string): string {
  return `${startDate}T00:00:00/${endDate}T23:59:59`;
}

export function parseSlingShiftEvents(events: any[]): ParsedSlingShift[] {
  return events
    .filter((e) => e.type === 'shift')
    .map((event) => ({
      sling_shift_id: event.id,
      sling_user_id: event.user?.id ?? null,
      shift_date: event.dtstart?.split('T')[0] ?? '',
      start_time: event.dtstart,
      end_time: event.dtend,
      break_duration: event.breakDuration ?? 0,
      position: event.position?.name ?? '',
      location: event.location?.name ?? '',
      status: event.status ?? 'published',
      raw_json: event,
    }));
}

export function parseSlingTimesheetReport(
  timesheetEntries: any[]
): ParsedSlingTimesheet[] {
  const results: ParsedSlingTimesheet[] = [];
  for (const entry of timesheetEntries) {
    if (!entry.id || !entry.user?.id) continue;
    const type = entry.type as string;
    let punchType: ParsedSlingTimesheet['punch_type'];
    if (type === 'clock_in') punchType = 'clock_in';
    else if (type === 'clock_out') punchType = 'clock_out';
    else if (type === 'break_start') punchType = 'break_start';
    else if (type === 'break_end') punchType = 'break_end';
    else continue; // skip unknown types

    results.push({
      sling_timesheet_id: entry.id,
      sling_shift_id: entry.event?.id ?? null,
      sling_user_id: entry.user.id,
      punch_type: punchType,
      punch_time: entry.timestamp,
      raw_json: entry,
    });
  }
  return results;
}
```

Now create the actual Deno edge function shared client:

```typescript
// supabase/functions/_shared/slingApiClient.ts
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "./encryption.ts";

const SLING_API_BASE = "https://api.getsling.com";
const FETCH_TIMEOUT_MS = 20000;

interface SlingConnection {
  id: string;
  restaurant_id: string;
  email: string;
  password_encrypted: string;
  auth_token: string | null;
  token_fetched_at: string | null;
  sling_org_id: number | null;
  initial_sync_done: boolean;
  sync_cursor: number;
}

function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

export async function slingLogin(email: string, password: string): Promise<string> {
  const response = await fetchWithTimeout(`${SLING_API_BASE}/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Sling login failed (${response.status}): ${errorText}`);
  }

  const authToken = response.headers.get('Authorization');
  if (!authToken) {
    throw new Error('Sling login succeeded but no Authorization token in response headers');
  }

  return authToken;
}

export async function slingApiGet(
  token: string,
  path: string,
  params?: Record<string, string>
): Promise<any> {
  const url = new URL(`${SLING_API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }

  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) {
    throw new Error('SLING_TOKEN_EXPIRED');
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Sling API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function getValidSlingToken(
  connection: SlingConnection,
  supabase: SupabaseClient
): Promise<string> {
  // If we have a token fetched less than 1 hour ago, reuse it
  if (connection.auth_token && connection.token_fetched_at) {
    const tokenAge = Date.now() - new Date(connection.token_fetched_at).getTime();
    if (tokenAge < 3600000) { // 1 hour
      return connection.auth_token;
    }
  }

  // Re-login to get fresh token
  const encryption = await getEncryptionService();
  const password = await encryption.decrypt(connection.password_encrypted);
  const token = await slingLogin(connection.email, password);

  // Save the new token
  await supabase.from('sling_connections').update({
    auth_token: token,
    token_fetched_at: new Date().toISOString(),
  }).eq('id', connection.id);

  return token;
}

export function formatDateInterval(startDate: string, endDate: string): string {
  return `${startDate}T00:00:00/${endDate}T23:59:59`;
}

export async function fetchSlingUsers(
  token: string,
  orgId: number
): Promise<any[]> {
  // Use /users/concise for better performance
  const users = await slingApiGet(token, '/users/concise');
  return Array.isArray(users) ? users : [];
}

export async function fetchSlingShifts(
  token: string,
  orgId: number,
  userId: number,
  startDate: string,
  endDate: string
): Promise<any[]> {
  const dates = formatDateInterval(startDate, endDate);
  const events = await slingApiGet(token, `/${orgId}/calendar/${userId}`, { dates });
  return Array.isArray(events) ? events : [];
}

export async function fetchSlingTimesheets(
  token: string,
  startDate: string,
  endDate: string
): Promise<any> {
  const dates = formatDateInterval(startDate, endDate);
  return slingApiGet(token, '/reports/timesheets', { dates });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/slingApiClient.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/slingApiClientHelpers.ts supabase/functions/_shared/slingApiClient.ts tests/unit/slingApiClient.test.ts
git commit -m "feat(sling): add Sling API client and parsing helpers"
```

---

### Task 4: Edge Function — sling-save-credentials

**Files:**
- Create: `supabase/functions/sling-save-credentials/index.ts`

**Step 1: Write the edge function**

Follow exact pattern from `supabase/functions/toast-save-credentials/index.ts`:
- CORS handling
- Auth check (user JWT)
- Role check (owner/manager)
- Encrypt password
- Upsert `sling_connections`
- Return success

```typescript
// supabase/functions/sling-save-credentials/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { restaurantId, email, password } = await req.json();
    if (!restaurantId || !email || !password) {
      return new Response(JSON.stringify({ error: 'Missing required fields: restaurantId, email, password' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user has owner/manager role
    const { data: userRestaurant } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (!userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const encryption = await getEncryptionService();
    const encryptedPassword = await encryption.encrypt(password);

    const { data: connection, error: upsertError } = await supabase
      .from('sling_connections')
      .upsert({
        restaurant_id: restaurantId,
        email: email,
        password_encrypted: encryptedPassword,
        is_active: true,
        connection_status: 'pending',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'restaurant_id' })
      .select()
      .single();

    if (upsertError) {
      throw new Error(`Failed to save credentials: ${upsertError.message}`);
    }

    return new Response(JSON.stringify({ success: true, connection }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error saving Sling credentials:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

**Step 2: Commit**

```bash
git add supabase/functions/sling-save-credentials/index.ts
git commit -m "feat(sling): add sling-save-credentials edge function"
```

---

### Task 5: Edge Function — sling-test-connection

**Files:**
- Create: `supabase/functions/sling-test-connection/index.ts`

**Step 1: Write the edge function**

This function:
1. Decrypts password from `sling_connections`
2. Calls `POST /account/login` to get auth token
3. Fetches the user's session info to get org list
4. If `slingOrgId` provided in request, uses that org
5. Fetches `/users/concise` to populate `sling_users`
6. Updates connection_status to 'connected'

```typescript
// supabase/functions/sling-test-connection/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";
import { slingLogin, slingApiGet, fetchSlingUsers } from "../_shared/slingApiClient.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // User client for auth check
    const userSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    // Service client for privileged operations
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await userSupabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { restaurantId, slingOrgId } = await req.json();
    if (!restaurantId) {
      return new Response(JSON.stringify({ error: 'Missing restaurantId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get connection
    const { data: connection, error: connError } = await serviceSupabase
      .from('sling_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connError || !connection) {
      return new Response(JSON.stringify({ error: 'No Sling connection found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Decrypt password and login
    const encryption = await getEncryptionService();
    const password = await encryption.decrypt(connection.password_encrypted);
    const token = await slingLogin(connection.email, password);

    // Get user session info (includes org list)
    const sessionInfo = await slingApiGet(token, '/account/session');

    // The session response includes the user's orgs
    // If slingOrgId provided, use it; otherwise return org list for user to choose
    const orgs = sessionInfo?.orgs || sessionInfo?.organizations || [];

    if (!slingOrgId && orgs.length > 1) {
      // Return org list for user to select
      await serviceSupabase.from('sling_connections').update({
        auth_token: token,
        token_fetched_at: new Date().toISOString(),
      }).eq('id', connection.id);

      return new Response(JSON.stringify({
        success: true,
        needsOrgSelection: true,
        orgs: orgs.map((org: any) => ({ id: org.id, name: org.name })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const selectedOrgId = slingOrgId || orgs[0]?.id;
    const selectedOrgName = orgs.find((o: any) => o.id === selectedOrgId)?.name || 'Sling Organization';

    if (!selectedOrgId) {
      return new Response(JSON.stringify({ error: 'No Sling organization found for this account' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch users for this org
    const users = await fetchSlingUsers(token, selectedOrgId);

    // Upsert sling_users
    for (const slingUser of users) {
      await serviceSupabase.from('sling_users').upsert({
        restaurant_id: restaurantId,
        sling_user_id: slingUser.id,
        name: slingUser.name || slingUser.legalName || '',
        lastname: slingUser.lastname || '',
        email: slingUser.email || '',
        position: slingUser.position?.name || '',
        is_active: slingUser.active !== false,
        raw_json: slingUser,
      }, { onConflict: 'restaurant_id,sling_user_id' });
    }

    // Update connection
    await serviceSupabase.from('sling_connections').update({
      auth_token: token,
      token_fetched_at: new Date().toISOString(),
      sling_org_id: selectedOrgId,
      sling_org_name: selectedOrgName,
      connection_status: 'connected',
      last_error: null,
      last_error_at: null,
    }).eq('id', connection.id);

    return new Response(JSON.stringify({
      success: true,
      orgName: selectedOrgName,
      usersCount: users.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error testing Sling connection:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

**Step 2: Commit**

```bash
git add supabase/functions/sling-test-connection/index.ts
git commit -m "feat(sling): add sling-test-connection edge function"
```

---

### Task 6: Edge Function — sling-sync-data

**Files:**
- Create: `supabase/functions/sling-sync-data/index.ts`

**Step 1: Write the edge function**

This is the manual sync function that mirrors `toast-sync-data`:
- Dual-client pattern (user auth + service role)
- State machine: initial sync (daily batches advancing cursor), incremental (25h), custom range
- Fetches calendar events for all mapped users + timesheet report for date range
- Upserts into `sling_shifts` and `sling_timesheets`
- Calls `sync_sling_to_shifts_and_punches` RPC for incremental/custom syncs

The edge function should be around 200-250 lines following the toast-sync-data structure. Key differences from Toast:
- No pagination (Sling calendar API returns all events for a date range)
- Must iterate over users (one calendar request per user)
- Timesheets come from `/reports/timesheets` endpoint (one request for all users)

```typescript
// supabase/functions/sling-sync-data/index.ts
// (Full implementation — see toast-sync-data/index.ts for the structural pattern)
// Key flow:
// 1. Auth check
// 2. Get connection from sling_connections
// 3. Get valid token (refresh if needed)
// 4. Calculate sync range (initial/incremental/custom)
// 5. Fetch all sling_users for this restaurant
// 6. For each user: GET /{orgId}/calendar/{userId}?dates=<interval>
// 7. GET /reports/timesheets?dates=<interval>
// 8. Parse and upsert into sling_shifts and sling_timesheets
// 9. Update sync_cursor / initial_sync_done
// 10. Call RPC for incremental/custom syncs
```

The implementation agent should follow the toast-sync-data pattern closely but adapt for Sling's API structure. Reference files:
- `supabase/functions/toast-sync-data/index.ts` for the state machine pattern
- `supabase/functions/_shared/slingApiClient.ts` for API calls
- `src/utils/slingApiClientHelpers.ts` for parsing logic (adapt to Deno compatible code)

**Step 2: Commit**

```bash
git add supabase/functions/sling-sync-data/index.ts
git commit -m "feat(sling): add sling-sync-data edge function for manual sync"
```

---

### Task 7: Edge Function — sling-bulk-sync (Cron)

**Files:**
- Create: `supabase/functions/sling-bulk-sync/index.ts`

**Step 1: Write the edge function**

Mirrors `toast-bulk-sync/index.ts`:
- Service role only (no user JWT)
- Fetch up to 5 active connections ordered by `last_sync_time ASC`
- For each: get valid token, 25h lookback (or 72h if initial sync not done)
- Fetch shifts + timesheets, upsert raw data
- Call `sync_sling_to_shifts_and_punches` RPC
- 2s delay between restaurants

Reference: `supabase/functions/toast-bulk-sync/index.ts`

**Step 2: Commit**

```bash
git add supabase/functions/sling-bulk-sync/index.ts
git commit -m "feat(sling): add sling-bulk-sync edge function for cron sync"
```

---

### Task 8: Frontend — useSlingConnection Hook

**Files:**
- Create: `src/hooks/useSlingConnection.ts`
- Test: `tests/unit/useSlingConnection.test.ts`

**Step 1: Write the hook**

Mirror `src/hooks/useToastConnection.tsx` structure:
- React Query for connection status (`queryKey: ['sling-connection', restaurantId]`)
- `saveCredentials(restaurantId, email, password)`
- `testConnection(restaurantId, slingOrgId?)`
- `disconnectSling(restaurantId)`
- `triggerManualSync(restaurantId, options?)`
- Return: `{ isConnected, connection, loading, saveCredentials, testConnection, disconnectSling, triggerManualSync }`

**Step 2: Create useSlingIntegration hook**

Mirror `src/hooks/useToastIntegration.tsx`:
- Simple connection status check for the Integrations page
- Return: `{ isConnected, isConnecting, connection }`

```typescript
// src/hooks/useSlingIntegration.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const useSlingIntegration = (restaurantId: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connection, setConnection] = useState<any>(null);

  const checkConnectionStatus = useCallback(async () => {
    if (!restaurantId) { setIsConnected(false); setConnection(null); return; }
    try {
      const { data, error } = await supabase
        .from('sling_connections' as any)
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') return;
      if (data) { setConnection(data); setIsConnected(true); }
      else { setConnection(null); setIsConnected(false); }
    } catch { setConnection(null); setIsConnected(false); }
  }, [restaurantId]);

  useEffect(() => { if (restaurantId) checkConnectionStatus(); }, [restaurantId, checkConnectionStatus]);

  return { isConnected, isConnecting, connection, loading: isConnecting, checkConnectionStatus };
};
```

**Step 3: Commit**

```bash
git add src/hooks/useSlingConnection.ts src/hooks/useSlingIntegration.ts
git commit -m "feat(sling): add frontend hooks for Sling connection"
```

---

### Task 9: Frontend — SlingSetupWizard Component

**Files:**
- Create: `src/components/pos/SlingSetupWizard.tsx`

**Step 1: Write the setup wizard**

3-step wizard mirroring `src/components/pos/ToastSetupWizard.tsx`:
- **Step 1 (credentials)**: Email + password input fields
- **Step 2 (org)**: If multiple orgs returned from test-connection, show org picker. If one, auto-select.
- **Step 3 (employees)**: Show `ShiftImportEmployeeReview` with Sling users mapped to existing employees. Write matches to `employee_integration_mappings`. Has "Create All Unmatched" button.
- **Step 4 (complete)**: Success state with "Done" button

Uses `useSlingConnection` hook for `saveCredentials`, `testConnection`.

Reference files:
- `src/components/pos/ToastSetupWizard.tsx` for wizard structure
- `src/components/scheduling/ShiftImportEmployeeReview.tsx` for employee mapping step
- `src/utils/shiftEmployeeMatching.ts` for matching logic (reuse `matchEmployees` function)

The employee mapping step should:
1. Fetch `sling_users` for this restaurant
2. Fetch existing `employees` for this restaurant
3. Run `matchEmployees()` with Sling user names → existing employees
4. Display `ShiftImportEmployeeReview` component
5. On confirmation, write `employee_integration_mappings` entries

**Step 2: Commit**

```bash
git add src/components/pos/SlingSetupWizard.tsx
git commit -m "feat(sling): add Sling setup wizard with employee mapping"
```

---

### Task 10: Frontend — SlingSync Component

**Files:**
- Create: `src/components/SlingSync.tsx`

**Step 1: Write the sync component**

Mirror `src/components/ToastSync.tsx`:
- Import and use shared `SyncComponents` (ConnectionStatus, InitialSyncPendingAlert, SyncModeSelector, etc.)
- Define `SLING_CONFIG: POSConfig = { name: 'Sling', dataLabel: 'shifts', dataLabelSingular: 'shift', syncInterval: '6 hours' }`
- `executeSyncLoop()` with same retry/batch logic as ToastSync
- Sync modes: 'recent' (25h) and 'custom' (date picker)

Reference: `src/components/ToastSync.tsx` (copy structure, adapt for Sling)

**Step 2: Commit**

```bash
git add src/components/SlingSync.tsx
git commit -m "feat(sling): add Sling sync UI component"
```

---

### Task 11: Frontend — Wire Sling into Integrations Page

**Files:**
- Modify: `src/pages/Integrations.tsx` (lines 6-10 for imports, lines 27-100 for integrations array)
- Modify: `src/components/IntegrationCard.tsx` (lines 1-19 for imports, lines 36-69 for hooks, lines 71-148 for handlers, lines 249-315 for render)

**Step 1: Update Integrations.tsx**

Add Sling integration entry to the integrations array. Replace the existing '7shifts' placeholder or add alongside it:

```typescript
// Add import
import { useSlingIntegration } from '@/hooks/useSlingIntegration';

// Add hook call
const { isConnected: slingConnected } = useSlingIntegration(selectedRestaurant?.restaurant_id || null);

// Add to integrations array (in the Scheduling category)
{
  id: 'sling',
  name: 'Sling',
  description: 'Sync employee schedules and time clock data from Sling',
  category: 'Scheduling',
  logo: '📋',
  connected: slingConnected,
  features: ['Employee Schedules', 'Time Clock', 'Break Tracking', 'Labor Data']
},
```

**Step 2: Update IntegrationCard.tsx**

Add Sling-specific handling following the Toast pattern:
- Import `useSlingConnection`, `SlingSync`, `SlingSetupWizard`
- Add `showSlingSetup` state
- Add `isSlingIntegration` check
- Wire `handleConnect`, `handleDisconnect`, connected status
- Render `SlingSync` when connected
- Render `SlingSetupWizard` dialog when setting up

**Step 3: Commit**

```bash
git add src/pages/Integrations.tsx src/components/IntegrationCard.tsx
git commit -m "feat(sling): wire Sling integration into Integrations page"
```

---

### Task 12: Add Sling Logo to IntegrationLogo Component

**Files:**
- Modify: `src/components/IntegrationLogo.tsx`

**Step 1: Check if IntegrationLogo handles the 'sling' id**

If not, add a case for `sling` that renders the Sling logo (either an SVG or a text fallback like the existing integrations use emoji fallbacks).

**Step 2: Commit**

```bash
git add src/components/IntegrationLogo.tsx
git commit -m "feat(sling): add Sling logo to IntegrationLogo component"
```

---

### Task 13: Cron Job Setup Migration

**Files:**
- Create: `supabase/migrations/20260223100200_sling_cron_setup.sql`

**Step 1: Write the cron migration**

```sql
-- supabase/migrations/20260223100200_sling_cron_setup.sql

-- Schedule sling-bulk-sync to run every 6 hours (at 0/6/12/18)
-- This mirrors the Toast bulk sync cron pattern
SELECT cron.schedule(
  'sling-bulk-sync',
  '0 0,6,12,18 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/sling-bulk-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260223100200_sling_cron_setup.sql
git commit -m "feat(sling): add cron job for sling-bulk-sync every 6 hours"
```

---

### Task 14: Integration Tests & Verification

**Files:**
- Test: Run existing tests to verify no regressions
- Manual: Test the full flow locally

**Step 1: Run all tests**

```bash
npm run test        # Unit tests
npm run test:db     # pgTAP tests
npm run lint        # Linting
npm run build       # Build check
```

**Step 2: Manual verification checklist**

- [ ] `npm run db:reset` succeeds with new migrations
- [ ] Sling appears on Integrations page under "Scheduling"
- [ ] Clicking "Connect" opens the SlingSetupWizard
- [ ] Entering credentials calls `sling-save-credentials`
- [ ] Test connection calls `sling-test-connection` and shows org selection if needed
- [ ] Employee mapping step shows Sling users with match/create options
- [ ] After setup, SlingSync component appears with "Sync Now" button
- [ ] Manual sync initiates and shows progress

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(sling): address integration test findings"
```

---

### Task 15: Final Cleanup & PR

**Step 1: Review all changes**

```bash
git diff main...HEAD --stat
```

**Step 2: Create PR**

Use `superpowers:finishing-a-development-branch` skill to create the PR with proper description covering:
- What was built (Sling integration for schedules + time punches)
- Key architectural decisions (raw tables + RPC sync, integration-agnostic mapping)
- Files created/modified
- Testing done
- Future considerations (labor reports, more frequent cron)
