# Manager-Initiated Shift Trade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner or a manager post an employee's shift for trade from the schedule grid.

**Architecture:** A new `SECURITY DEFINER` RPC `create_shift_trade_for_employee` inserts the trade after it checks the caller is an owner or a manager. The schedule-grid shift card gets a third hover action that opens the existing `TradeRequestDialog` in a new manager mode. The trade then follows the existing accept → approve flow with no change.

**Tech Stack:** PostgreSQL (pgTAP), Supabase RPC, React 18 + TypeScript + Vite, TailwindCSS, shadcn/ui, React Query, Vitest, Playwright.

## Global Constraints

- Write every word to the user in ASD-STE100 Simplified Technical English. This covers commit messages, comments, and the PR body. Keep code identifiers and error strings exact.
- Multi-tenancy: every row filters by `restaurant_id`. RLS enforces isolation.
- Authorization audience for the new RPC is `role IN ('owner', 'manager')`. This mirrors `approve_shift_trade` on purpose. Do NOT use the `edit:scheduling` capability, which also admits `operations_manager` and would create a dead-end approval queue.
- NULL-safe role check: `IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'manager')`. A plain `NOT IN` fails open for a caller with no membership.
- Every RPC error uses `RAISE EXCEPTION` with a short plain message (default SQLSTATE `P0001`).
- New RPC signatures must be added to `src/integrations/supabase/types.ts` under `Functions` so the hook typechecks without `as any`.
- Semantic color tokens only (`bg-background`, `text-foreground`). No direct colors.
- All icon-only buttons need an `aria-label`.
- V1 is desktop-only. The mobile view (`src/components/scheduling/WeekScheduleMobile.tsx`) does NOT get the offer action, because a touch screen has no hover state.
- Local Supabase must run for pgTAP and E2E: `npm run db:start`.
- New migration timestamp must sort after `20260809120000`. Use `20260812120000`.

---

### Task 1: Backend RPC `create_shift_trade_for_employee` + pgTAP tests

**Files:**
- Create: `supabase/tests/55_create_shift_trade_for_employee.sql`
- Create: `supabase/migrations/20260812120000_create_shift_trade_for_employee.sql`

**Interfaces:**
- Consumes: existing tables `shift_trades`, `shifts`, `employees`, `user_restaurants`; existing partial unique index `idx_unique_active_trade_per_shift` on `shift_trades(offered_shift_id) WHERE status IN ('open','pending_approval')`.
- Produces: `create_shift_trade_for_employee(p_restaurant_id uuid, p_offered_shift_id uuid, p_offered_by_employee_id uuid, p_target_employee_id uuid DEFAULT NULL, p_reason text DEFAULT NULL) RETURNS uuid`. On success it returns the new `shift_trades.id`. On any failure it raises `P0001`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/55_create_shift_trade_for_employee.sql`:

```sql
-- ============================================================================
-- Test: create_shift_trade_for_employee authorization and validation.
--
-- create_shift_trade_for_employee(p_restaurant_id, p_offered_shift_id,
--   p_offered_by_employee_id, p_target_employee_id DEFAULT NULL,
--   p_reason DEFAULT NULL) RETURNS uuid is SECURITY DEFINER + GRANTed to
-- authenticated. It lets an owner or a manager post an employee's shift for
-- trade. It must reject any other caller (staff, no membership, wrong
-- restaurant), reject a non-tradeable shift status, reject an invalid directed
-- target, and reject a second active trade on the same shift.
--
-- This test impersonates callers via `SET LOCAL ROLE authenticated` +
-- request.jwt.claims so it exercises the real authenticated-role GRANT
-- boundary (the same pattern as 54_accept_shift_trade_authz.sql).
--
-- Fixture namespace: UUIDs starting with 55000000-...
--   Restaurants: R1 (owner O, staff ST); R2 (manager M2).
--   Employees on R1: empA (offerer), empB (active coworker),
--                    empBInactive (inactive coworker). Employee on R2: empX.
--   Shifts owned by empA on R1: shift1..shift4 (shift3 is 'cancelled').
--   Every allow scenario uses its own shift so an earlier insert never
--   changes a later scenario's starting state.
-- ============================================================================

BEGIN;
SELECT plan(10);

-- ============================================================================
-- Setup (as postgres/superuser — bypasses RLS regardless of enable state)
-- ============================================================================
SET LOCAL role TO postgres;

ALTER TABLE shift_trades DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Restaurants
INSERT INTO restaurants (id, name) VALUES
  ('55000000-0000-0000-0000-000000000001', 'Manager Trade Restaurant'),
  ('55000000-0000-0000-0000-000000000002', 'Other Restaurant (Manager Trade)')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Auth users: O (owner R1), ST (staff R1), NM (no membership), M2 (manager R2)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('55000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mtrade-o-55@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('55000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mtrade-st-55@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('55000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mtrade-nm-55@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('55000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mtrade-m2-55@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Employees: empA/empB/empBInactive on R1; empX on R2
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('55000000-0000-0000-0000-000000000021', '55000000-0000-0000-0000-000000000001', NULL, 'Offerer A', 'mtrade-a-55@test.com', 'Server', true),
  ('55000000-0000-0000-0000-000000000022', '55000000-0000-0000-0000-000000000001', NULL, 'Coworker B', 'mtrade-b-55@test.com', 'Server', true),
  ('55000000-0000-0000-0000-000000000023', '55000000-0000-0000-0000-000000000001', NULL, 'Inactive B2', 'mtrade-b2-55@test.com', 'Server', false),
  ('55000000-0000-0000-0000-000000000024', '55000000-0000-0000-0000-000000000002', NULL, 'Other Restaurant X', 'mtrade-x-55@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

-- Memberships: O owner of R1, ST staff of R1, M2 manager of R2. NM has none.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('55000000-0000-0000-0000-000000000011', '55000000-0000-0000-0000-000000000001', 'owner'),
  ('55000000-0000-0000-0000-000000000012', '55000000-0000-0000-0000-000000000001', 'staff'),
  ('55000000-0000-0000-0000-000000000014', '55000000-0000-0000-0000-000000000002', 'manager')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Four shifts owned by empA on R1. shift3 is cancelled (non-tradeable).
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status) VALUES
  ('55000000-0000-0000-0000-000000000041', '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000021', '2026-09-01 09:00:00+00', '2026-09-01 17:00:00+00', 'Server', 30, 'scheduled'),
  ('55000000-0000-0000-0000-000000000042', '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000021', '2026-09-02 09:00:00+00', '2026-09-02 17:00:00+00', 'Server', 30, 'scheduled'),
  ('55000000-0000-0000-0000-000000000043', '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000021', '2026-09-03 09:00:00+00', '2026-09-03 17:00:00+00', 'Server', 30, 'cancelled'),
  ('55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000021', '2026-09-04 09:00:00+00', '2026-09-04 17:00:00+00', 'Server', 30, 'scheduled')
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

DELETE FROM shift_trades WHERE restaurant_id IN (
  '55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000002'
);

-- CRITICAL: re-enable RLS on every table before switching to authenticated.
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;

RESET ROLE;

-- ============================================================================
-- Scenario 1 (assertions 1-2): Owner O posts a marketplace trade for empA's
-- shift1. Must succeed and create one OPEN trade with a NULL target.
-- ============================================================================
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000041', '55000000-0000-0000-0000-000000000021') $$,
  'Scenario 1: owner can post a marketplace trade for an employee'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT count(*)::int FROM shift_trades WHERE offered_shift_id = '55000000-0000-0000-0000-000000000041' AND status = 'open' AND target_employee_id IS NULL),
  1,
  'Scenario 1: one open marketplace trade exists for shift1'
);

-- ============================================================================
-- Scenario 2 (assertions 3-4): Owner O posts a directed trade to empB for
-- shift2. Must succeed and record target_employee_id = empB.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000042', '55000000-0000-0000-0000-000000000021', '55000000-0000-0000-0000-000000000022') $$,
  'Scenario 2: owner can post a directed trade to a coworker'
);

RESET ROLE;
SET LOCAL role TO postgres;
SELECT is(
  (SELECT target_employee_id FROM shift_trades WHERE offered_shift_id = '55000000-0000-0000-0000-000000000042'),
  '55000000-0000-0000-0000-000000000022'::uuid,
  'Scenario 2: directed trade records the target coworker'
);

-- ============================================================================
-- Scenario 3 (assertion 5): Staff ST posts for shift4 -> denied (authz).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 3: staff cannot post a trade for an employee'
);

-- ============================================================================
-- Scenario 4 (assertion 6): No-membership user NM posts for shift4 -> denied
-- (NULL-safe role check). A plain NOT IN would fail open here.
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000015","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 4: a caller with no membership cannot post a trade'
);

-- ============================================================================
-- Scenario 5 (assertion 7): Owner O posts for shift3 (cancelled) -> denied
-- (status allow-list).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000043', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 5: a cancelled shift cannot be traded'
);

-- ============================================================================
-- Scenario 6 (assertion 8): Owner O posts a SECOND trade for shift1, which
-- already has an active trade from scenario 1 -> denied (unique_violation).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000041', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 6: a shift with an active trade cannot be posted again'
);

-- ============================================================================
-- Scenario 7 (assertion 9): Owner O posts a directed trade to empBInactive
-- for shift4 -> denied (inactive target).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000021', '55000000-0000-0000-0000-000000000023') $$,
  'P0001', NULL,
  'Scenario 7: a directed trade to an inactive coworker is rejected'
);

-- ============================================================================
-- Scenario 8 (assertion 10): M2 (manager of R2 only) posts for an R1 shift
-- with p_restaurant_id = R1 -> denied (no R1 membership -> NULL role).
-- ============================================================================
RESET ROLE;
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"55000000-0000-0000-0000-000000000014","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT create_shift_trade_for_employee('55000000-0000-0000-0000-000000000001', '55000000-0000-0000-0000-000000000044', '55000000-0000-0000-0000-000000000021') $$,
  'P0001', NULL,
  'Scenario 8: a manager of another restaurant cannot post a trade here'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -f supabase/tests/55_create_shift_trade_for_employee.sql`
Expected: FAIL. Every scenario errors with `function create_shift_trade_for_employee(...) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260812120000_create_shift_trade_for_employee.sql`:

```sql
-- Manager-initiated shift trade.
--
-- Let an owner or a manager post an employee's shift for trade. The RLS INSERT
-- policy on shift_trades requires the offerer to be the caller's own employee,
-- so a manager cannot insert directly. This SECURITY DEFINER function does the
-- insert after it checks the caller is an owner or a manager of the restaurant.
--
-- The trade then follows the existing accept -> approve flow with no change:
-- a coworker accepts it, and the same owner/manager approves it.
CREATE OR REPLACE FUNCTION create_shift_trade_for_employee(
  p_restaurant_id UUID,
  p_offered_shift_id UUID,
  p_offered_by_employee_id UUID,
  p_target_employee_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_role TEXT;
  v_shift shifts;
  v_new_trade_id UUID;
BEGIN
  -- Authorization: the caller must be an owner or a manager of this restaurant.
  -- This mirrors the approve_shift_trade audience on purpose: the same person
  -- who approves the trade may post it. It is NOT the edit:scheduling
  -- capability, which also admits operations_manager and would create a
  -- dead-end approval queue.
  SELECT role INTO v_user_role
  FROM user_restaurants
  WHERE user_id = auth.uid()
    AND restaurant_id = p_restaurant_id
  LIMIT 1;

  -- v_user_role is NULL when the caller has no membership for this restaurant.
  -- `NULL NOT IN (...)` evaluates to NULL, not TRUE, so a plain NOT IN check
  -- would fail OPEN and let any authenticated user post a trade. Reject NULL
  -- first.
  IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Only an owner or a manager can post a trade for an employee';
  END IF;

  -- Load the offered shift.
  SELECT * INTO v_shift
  FROM shifts
  WHERE id = p_offered_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  -- The shift must belong to this restaurant.
  IF v_shift.restaurant_id != p_restaurant_id THEN
    RAISE EXCEPTION 'Shift does not belong to this restaurant';
  END IF;

  -- The shift must belong to the employee named as the offerer.
  IF v_shift.employee_id IS DISTINCT FROM p_offered_by_employee_id THEN
    RAISE EXCEPTION 'Shift does not belong to this employee';
  END IF;

  -- Only a live shift can be traded (allow-list, not deny-list).
  IF v_shift.status NOT IN ('scheduled', 'confirmed') THEN
    RAISE EXCEPTION 'Only a scheduled or confirmed shift can be traded';
  END IF;

  -- Directed trade: the target must be a different, active employee of this
  -- restaurant.
  IF p_target_employee_id IS NOT NULL THEN
    IF p_target_employee_id = p_offered_by_employee_id THEN
      RAISE EXCEPTION 'Cannot direct a trade to the same employee';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM employees
      WHERE id = p_target_employee_id
        AND restaurant_id = p_restaurant_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Target employee not found or inactive';
    END IF;
  END IF;

  -- Insert the trade. The partial unique index
  -- idx_unique_active_trade_per_shift blocks a second active trade on the same
  -- shift; translate that into a clear message instead of a raw 23505.
  BEGIN
    INSERT INTO shift_trades (
      restaurant_id,
      offered_shift_id,
      offered_by_employee_id,
      target_employee_id,
      reason,
      status
    ) VALUES (
      p_restaurant_id,
      p_offered_shift_id,
      p_offered_by_employee_id,
      p_target_employee_id,
      p_reason,
      'open'
    )
    RETURNING id INTO v_new_trade_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'This shift already has an active trade';
  END;

  RETURN v_new_trade_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_shift_trade_for_employee(UUID, UUID, UUID, UUID, TEXT) TO authenticated;
```

- [ ] **Step 4: Apply the migration and re-run the test**

Run: `npm run db:reset`
Expected: the reset applies all migrations, including `20260812120000_create_shift_trade_for_employee.sql`, with no error.

Run: `PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -f supabase/tests/55_create_shift_trade_for_employee.sql`
Expected: PASS. `# Looks like you passed 10 tests` (all 10 `ok`).

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/55_create_shift_trade_for_employee.sql supabase/migrations/20260812120000_create_shift_trade_for_employee.sql
git commit -m "feat(shift-trades): add create_shift_trade_for_employee RPC for managers"
```

---

### Task 2: `useCreateShiftTradeForEmployee` hook + generated type

**Files:**
- Modify: `src/integrations/supabase/types.ts` (add the RPC to `Functions`)
- Modify: `src/hooks/useShiftTrades.ts` (add the hook after `useCreateShiftTrade`, which ends at line 341)
- Test: `tests/unit/useCreateShiftTradeForEmployee.test.ts`

**Interfaces:**
- Consumes: `create_shift_trade_for_employee` RPC (Task 1); existing module helpers `sendShiftTradeNotification` and `invalidateShiftTradeQueries` in `src/hooks/useShiftTrades.ts`.
- Produces: `useCreateShiftTradeForEmployee()` — a React Query mutation. `mutationFn` takes `{ restaurant_id: string; offered_shift_id: string; offered_by_employee_id: string; target_employee_id?: string | null; reason?: string }` and returns the new trade id (`string`). It calls `supabase.rpc('create_shift_trade_for_employee', { p_... })`, then `sendShiftTradeNotification(id, 'created')`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useCreateShiftTradeForEmployee.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---- Mocks (hoisted) ----

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  functions: { invoke: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ---- Helpers ----

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const baseInput = {
  restaurant_id: 'r1',
  offered_shift_id: 's1',
  offered_by_employee_id: 'e1',
};

// ---- Import after mocks ----

import { useCreateShiftTradeForEmployee } from '@/hooks/useShiftTrades';

describe('useCreateShiftTradeForEmployee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.functions.invoke.mockResolvedValue({ data: null, error: null });
  });

  it('calls the RPC with p_-prefixed params and defaults nulls', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'trade-1', error: null });

    const { result } = renderHook(() => useCreateShiftTradeForEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(baseInput);
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_shift_trade_for_employee', {
      p_restaurant_id: 'r1',
      p_offered_shift_id: 's1',
      p_offered_by_employee_id: 'e1',
      p_target_employee_id: null,
      p_reason: null,
    });
  });

  it('passes a directed target and reason through', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'trade-2', error: null });

    const { result } = renderHook(() => useCreateShiftTradeForEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ...baseInput,
        target_employee_id: 'e2',
        reason: 'family event',
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_shift_trade_for_employee', {
      p_restaurant_id: 'r1',
      p_offered_shift_id: 's1',
      p_offered_by_employee_id: 'e1',
      p_target_employee_id: 'e2',
      p_reason: 'family event',
    });
  });

  it('sends the created notification with the returned trade id', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'trade-3', error: null });

    const { result } = renderHook(() => useCreateShiftTradeForEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(baseInput);
    });

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
      'send-shift-trade-notification',
      { body: { tradeId: 'trade-3', action: 'created' } },
    );
  });

  it('throws and shows a destructive toast on RPC error', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Only an owner or a manager can post a trade for an employee' },
    });

    const { result } = renderHook(() => useCreateShiftTradeForEmployee(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync(baseInput)),
    ).rejects.toBeTruthy();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error posting trade',
          variant: 'destructive',
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/useCreateShiftTradeForEmployee.test.ts`
Expected: FAIL. `useCreateShiftTradeForEmployee` is not exported from `@/hooks/useShiftTrades`.

- [ ] **Step 3: Add the RPC to generated types**

In `src/integrations/supabase/types.ts`, find the `accept_shift_trade` block (near line 10568):

```typescript
      accept_shift_trade: {
        Args: { p_accepting_employee_id: string; p_trade_id: string }
        Returns: Json
      }
```

Add the new function block immediately after it:

```typescript
      accept_shift_trade: {
        Args: { p_accepting_employee_id: string; p_trade_id: string }
        Returns: Json
      }
      create_shift_trade_for_employee: {
        Args: {
          p_offered_by_employee_id: string
          p_offered_shift_id: string
          p_reason?: string
          p_restaurant_id: string
          p_target_employee_id?: string
        }
        Returns: string
      }
```

- [ ] **Step 4: Write the hook**

In `src/hooks/useShiftTrades.ts`, add this hook directly after `useCreateShiftTrade` (which ends with `};` at line 341):

```typescript
/**
 * Hook for an owner or a manager to post an employee's shift for trade.
 *
 * The RLS INSERT policy on shift_trades requires the offerer to be the caller's
 * own employee, so a manager cannot insert directly. This hook calls the
 * SECURITY DEFINER RPC create_shift_trade_for_employee, which checks the caller
 * is an owner or a manager and then does the insert. The trade then follows the
 * existing accept -> approve flow.
 */
export const useCreateShiftTradeForEmployee = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (trade: {
      restaurant_id: string;
      offered_shift_id: string;
      offered_by_employee_id: string;
      target_employee_id?: string | null;
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc('create_shift_trade_for_employee', {
        p_restaurant_id: trade.restaurant_id,
        p_offered_shift_id: trade.offered_shift_id,
        p_offered_by_employee_id: trade.offered_by_employee_id,
        p_target_employee_id: trade.target_employee_id ?? null,
        p_reason: trade.reason ?? null,
      });

      if (error) throw error;

      const tradeId = data as string;

      // Send notification email (non-blocking for failures)
      await sendShiftTradeNotification(tradeId, 'created');

      return tradeId;
    },
    onSuccess: () => {
      invalidateShiftTradeQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: 'Shift posted for trade',
        description: 'The shift is now available for a coworker to claim.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error posting trade',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/useCreateShiftTradeForEmployee.test.ts`
Expected: PASS (4 tests).

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/supabase/types.ts src/hooks/useShiftTrades.ts tests/unit/useCreateShiftTradeForEmployee.test.ts
git commit -m "feat(shift-trades): add useCreateShiftTradeForEmployee hook"
```

---

### Task 3: Manager mode for `TradeRequestDialog`

**Files:**
- Modify: `src/components/schedule/TradeRequestDialog.tsx`
- Test: `tests/unit/TradeRequestDialog.managerMode.test.tsx`

**Interfaces:**
- Consumes: `useCreateShiftTradeForEmployee` (Task 2); existing `useCreateShiftTrade`; `useEmployees`.
- Produces: `TradeRequestDialog` gains an optional `onBehalfOfEmployee?: { id: string; name: string }` prop and makes `currentEmployeeId?` optional. When `onBehalfOfEmployee` is set, the dialog posts for that employee through the RPC hook; otherwise it keeps the existing self-service behavior.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/TradeRequestDialog.managerMode.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const createSelf = vi.hoisted(() => vi.fn());
const createForEmployee = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useShiftTrades', () => ({
  useCreateShiftTrade: () => ({ mutate: createSelf, isPending: false }),
  useCreateShiftTradeForEmployee: () => ({ mutate: createForEmployee, isPending: false }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({
    employees: [
      { id: 'e-a', name: 'Alex Absent', position: 'Server', is_active: true, user_id: 'u-a' },
      { id: 'e-b', name: 'Bailey Backup', position: 'Server', is_active: true, user_id: 'u-b' },
    ],
    loading: false,
  }),
}));

import { TradeRequestDialog } from '@/components/schedule/TradeRequestDialog';

const shift = {
  id: 's-1',
  start_time: '2026-09-01T16:00:00.000Z',
  end_time: '2026-09-01T22:00:00.000Z',
  position: 'Server',
  employee_id: 'e-a',
};

describe('TradeRequestDialog manager mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the employee name in the title when posting on their behalf', () => {
    render(
      <TradeRequestDialog
        open
        onOpenChange={() => {}}
        shift={shift}
        restaurantId="r-1"
        onBehalfOfEmployee={{ id: 'e-a', name: 'Alex Absent' }}
      />,
    );

    expect(screen.getByText(/Alex Absent/)).toBeInTheDocument();
  });

  it('posts a marketplace trade through the RPC hook with the offerer id', async () => {
    render(
      <TradeRequestDialog
        open
        onOpenChange={() => {}}
        shift={shift}
        restaurantId="r-1"
        onBehalfOfEmployee={{ id: 'e-a', name: 'Alex Absent' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /post trade/i }));

    await waitFor(() => {
      expect(createForEmployee).toHaveBeenCalledTimes(1);
    });
    expect(createForEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: 'r-1',
        offered_shift_id: 's-1',
        offered_by_employee_id: 'e-a',
        target_employee_id: null,
      }),
      expect.any(Object),
    );
    expect(createSelf).not.toHaveBeenCalled();
  });

  it('uses the self-service hook when currentEmployeeId is given', async () => {
    render(
      <TradeRequestDialog
        open
        onOpenChange={() => {}}
        shift={shift}
        restaurantId="r-1"
        currentEmployeeId="e-a"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /post trade/i }));

    await waitFor(() => {
      expect(createSelf).toHaveBeenCalledTimes(1);
    });
    expect(createForEmployee).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/TradeRequestDialog.managerMode.test.tsx`
Expected: FAIL. `onBehalfOfEmployee` is not a prop, and the title does not contain the employee name.

- [ ] **Step 3: Rewrite `TradeRequestDialog.tsx`**

Replace the whole file `src/components/schedule/TradeRequestDialog.tsx` with:

```tsx
import { useState } from 'react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateShiftTrade, useCreateShiftTradeForEmployee } from '@/hooks/useShiftTrades';
import { useEmployees } from '@/hooks/useEmployees';
import { ArrowRightLeft, Users, Loader2 } from 'lucide-react';

interface Shift {
  id: string;
  start_time: string;
  end_time: string;
  position: string;
  employee_id: string;
}

interface TradeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift;
  restaurantId: string;
  /** Set in self-service mode: the signed-in employee posts their own shift. */
  currentEmployeeId?: string;
  /** Set in manager mode: an owner or a manager posts this employee's shift. */
  onBehalfOfEmployee?: { id: string; name: string };
}

export const TradeRequestDialog = ({
  open,
  onOpenChange,
  shift,
  restaurantId,
  currentEmployeeId,
  onBehalfOfEmployee,
}: TradeRequestDialogProps) => {
  const [tradeType, setTradeType] = useState<'marketplace' | 'directed'>('marketplace');
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>('');
  const [reason, setReason] = useState('');

  // Both hooks must run every render (React rule of hooks). The manager mode
  // uses the SECURITY DEFINER RPC; the self-service mode uses the direct insert.
  const selfMutation = useCreateShiftTrade();
  const managerMutation = useCreateShiftTradeForEmployee();
  const isManagerMode = Boolean(onBehalfOfEmployee);
  const { mutate: createTrade, isPending } = isManagerMode ? managerMutation : selfMutation;

  const { employees, loading: employeesLoading } = useEmployees(restaurantId);

  // The offerer is the on-behalf employee in manager mode, else the signed-in
  // employee.
  const offererId = onBehalfOfEmployee?.id ?? currentEmployeeId;

  // Show every other active coworker as a directed-trade target.
  const availableEmployees = employees.filter(
    (emp) => emp.id !== offererId && emp.is_active
  );

  const handleSubmit = () => {
    if (!offererId) {
      return;
    }
    if (tradeType === 'directed' && !targetEmployeeId) {
      return;
    }

    createTrade(
      {
        restaurant_id: restaurantId,
        offered_shift_id: shift.id,
        offered_by_employee_id: offererId,
        target_employee_id: tradeType === 'directed' ? targetEmployeeId : null,
        reason: reason || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          // Reset form
          setTradeType('marketplace');
          setTargetEmployeeId('');
          setReason('');
        },
      }
    );
  };

  // Early return if the shift or the offerer is missing (dialog not ready).
  if (!shift || !offererId) {
    return null;
  }

  const shiftStart = new Date(shift.start_time);
  const shiftEnd = new Date(shift.end_time);

  const title = isManagerMode
    ? `Post ${onBehalfOfEmployee?.name}'s shift for trade`
    : 'Trade Shift';
  const description = isManagerMode
    ? 'Post this shift to the trade marketplace or offer it to a specific coworker.'
    : 'Offer your shift to the trade marketplace or a specific coworker.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                {title}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Shift Details Card */}
        <div className="rounded-lg border border-border bg-gradient-to-br from-muted/30 to-transparent p-4">
          <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Shift Details</h4>
          <div className="space-y-1 text-sm">
            <p className="text-foreground">
              <span className="font-medium">Date:</span>{' '}
              {format(shiftStart, 'EEEE, MMMM d, yyyy')}
            </p>
            <p className="text-foreground">
              <span className="font-medium">Time:</span>{' '}
              {format(shiftStart, 'h:mm a')} - {format(shiftEnd, 'h:mm a')}
            </p>
            <p className="text-foreground">
              <span className="font-medium">Position:</span> {shift.position}
            </p>
          </div>
        </div>

        {/* Trade Type Selection */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">Trade Type</Label>
          <RadioGroup value={tradeType} onValueChange={(val: 'marketplace' | 'directed') => setTradeType(val)}>
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="marketplace" id="marketplace" className="mt-1" />
              <div className="flex-1">
                <Label
                  htmlFor="marketplace"
                  className="flex cursor-pointer items-center gap-2 text-base font-medium"
                >
                  <Users className="h-4 w-4 text-primary" />
                  Marketplace (Up for Grabs)
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  Post to all employees. First to accept gets the shift.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <RadioGroupItem value="directed" id="directed" className="mt-1" />
              <div className="flex-1">
                <Label
                  htmlFor="directed"
                  className="flex cursor-pointer items-center gap-2 text-base font-medium"
                >
                  <ArrowRightLeft className="h-4 w-4 text-primary" />
                  Specific Coworker
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  Offer this shift to a specific employee.
                </p>
              </div>
            </div>
          </RadioGroup>

          {/* Target Employee Selection */}
          {tradeType === 'directed' && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-4">
              <Label htmlFor="target-employee" className="text-sm font-medium">
                Select Coworker
              </Label>
              <Select value={targetEmployeeId} onValueChange={setTargetEmployeeId}>
                <SelectTrigger id="target-employee">
                  <SelectValue placeholder="Choose an employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employeesLoading ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      Loading employees...
                    </div>
                  ) : availableEmployees.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No other employees available
                    </div>
                  ) : (
                    availableEmployees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        <div className="flex items-center gap-2">
                          <span>{employee.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({employee.position})
                          </span>
                          {!employee.user_id && (
                            <span className="text-xs text-yellow-600 dark:text-yellow-500">
                              • No account
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Reason (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="reason" className="text-sm font-medium">
              Reason <span className="text-muted-foreground">(Optional)</span>
            </Label>
            <Textarea
              id="reason"
              placeholder="Why does this shift need a trade? (e.g., family event, another commitment)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isPending || (tradeType === 'directed' && !targetEmployeeId)
            }
            className="min-w-[120px]"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                Post Trade
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/TradeRequestDialog.managerMode.test.tsx`
Expected: PASS (3 tests).

Run: `npm run typecheck`
Expected: no errors. (`EmployeeSchedule.tsx` still passes `currentEmployeeId`, which is now optional but still valid.)

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/TradeRequestDialog.tsx tests/unit/TradeRequestDialog.managerMode.test.tsx
git commit -m "feat(shift-trades): add manager mode to TradeRequestDialog"
```

---

### Task 4: Third hover action on the shift card

**Files:**
- Modify: `src/pages/SchedulingShiftCard.tsx`
- Test: `tests/unit/SchedulingShiftCard.offerTrade.test.tsx`

**Interfaces:**
- Consumes: existing `ShiftCardProps` and the hover-actions block (lines 203-231).
- Produces: `ShiftCardProps` gains `onOfferTrade?: (shift: Shift) => void`. The card shows an "Offer shift for trade" action only when `onOfferTrade` is set AND the shift status is `scheduled` or `confirmed`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/SchedulingShiftCard.offerTrade.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { Shift } from '@/types/scheduling';

vi.mock('@/hooks/useConflictDetection', () => ({
  useCheckConflicts: () => ({ conflicts: [], hasConflicts: false }),
}));

import { ShiftCard } from '@/pages/SchedulingShiftCard';

function mockShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 's-1',
    restaurant_id: 'r-1',
    employee_id: 'e-1',
    start_time: '2026-09-01T16:00:00.000Z',
    end_time: '2026-09-01T22:00:00.000Z',
    break_duration: 30,
    position: 'Server',
    notes: undefined,
    status: 'scheduled',
    is_published: true,
    locked: false,
    is_recurring: false,
    recurrence_parent_id: null,
    recurrence_pattern: null,
    published_at: null,
    published_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

describe('ShiftCard offer-trade action', () => {
  it('shows the offer action for a scheduled shift when onOfferTrade is set', () => {
    const onOfferTrade = vi.fn();
    render(
      <ShiftCard
        shift={mockShift()}
        onEdit={() => {}}
        onDelete={() => {}}
        onOfferTrade={onOfferTrade}
      />,
    );

    const button = screen.getByLabelText('Offer shift for trade');
    fireEvent.click(button);
    expect(onOfferTrade).toHaveBeenCalledTimes(1);
  });

  it('hides the offer action when onOfferTrade is not set', () => {
    render(<ShiftCard shift={mockShift()} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.queryByLabelText('Offer shift for trade')).toBeNull();
  });

  it('hides the offer action for a cancelled shift', () => {
    render(
      <ShiftCard
        shift={mockShift({ status: 'cancelled' })}
        onEdit={() => {}}
        onDelete={() => {}}
        onOfferTrade={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Offer shift for trade')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/SchedulingShiftCard.offerTrade.test.tsx`
Expected: FAIL. The `Offer shift for trade` control does not exist.

- [ ] **Step 3: Add the icon import**

In `src/pages/SchedulingShiftCard.tsx`, change the lucide import on line 8:

```typescript
import { AlertTriangle, Check, Clock, Edit, Trash2 } from 'lucide-react';
```

to:

```typescript
import { AlertTriangle, ArrowRightLeft, Check, Clock, Edit, Trash2 } from 'lucide-react';
```

- [ ] **Step 4: Add the prop**

In `src/pages/SchedulingShiftCard.tsx`, change `ShiftCardProps` (lines 37-44):

```typescript
export type ShiftCardProps = {
  shift: Shift;
  onEdit: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  isSelected?: boolean;
  selectionMode?: boolean;
  onToggleSelect?: (shiftId: string) => void;
};
```

to:

```typescript
export type ShiftCardProps = {
  shift: Shift;
  onEdit: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  isSelected?: boolean;
  selectionMode?: boolean;
  onToggleSelect?: (shiftId: string) => void;
  onOfferTrade?: (shift: Shift) => void;
};
```

Then change the component signature (line 49):

```typescript
export const ShiftCard = ({ shift, onEdit, onDelete, isSelected, selectionMode: cardSelectionMode, onToggleSelect }: ShiftCardProps) => {
```

to:

```typescript
export const ShiftCard = ({ shift, onEdit, onDelete, isSelected, selectionMode: cardSelectionMode, onToggleSelect, onOfferTrade }: ShiftCardProps) => {
```

- [ ] **Step 5: Render the third action**

In `src/pages/SchedulingShiftCard.tsx`, inside the hover-actions block, add the offer button between the Edit button and the Delete button. Change:

```tsx
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(shift);
            }}
            aria-label="Edit shift"
          >
            <Edit className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-destructive/10 hover:text-destructive shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(shift);
            }}
            aria-label="Delete shift"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
```

to:

```tsx
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(shift);
            }}
            aria-label="Edit shift"
          >
            <Edit className="h-3 w-3" />
          </Button>
          {onOfferTrade && (shift.status === 'scheduled' || shift.status === 'confirmed') && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onOfferTrade(shift);
              }}
              aria-label="Offer shift for trade"
            >
              <ArrowRightLeft className="h-3 w-3" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-destructive/10 hover:text-destructive shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(shift);
            }}
            aria-label="Delete shift"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/SchedulingShiftCard.offerTrade.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/pages/SchedulingShiftCard.tsx tests/unit/SchedulingShiftCard.offerTrade.test.tsx
git commit -m "feat(scheduling): add offer-for-trade action to the shift card"
```

---

### Task 5: Wire the offer action into `Scheduling.tsx`

**Files:**
- Modify: `src/pages/Scheduling.tsx`

**Interfaces:**
- Consumes: `TradeRequestDialog` with the `onBehalfOfEmployee` prop (Task 3); `ShiftCard` with the `onOfferTrade` prop (Task 4); existing `selectedRestaurant` from `useRestaurantContext` (which carries `role`); existing `allEmployees` (line 289).
- Produces: the schedule grid shows the offer action for an owner or a manager, and it opens `TradeRequestDialog` in manager mode.

- [ ] **Step 1: Add the import**

In `src/pages/Scheduling.tsx`, after line 21 (`import { ShiftCard } from './SchedulingShiftCard';`), add:

```typescript
import { TradeRequestDialog } from '@/components/schedule/TradeRequestDialog';
```

- [ ] **Step 2: Add the state and the role gate**

In `src/pages/Scheduling.tsx`, after line 254 (`const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);`), add:

```typescript
  const [tradeShift, setTradeShift] = useState<Shift | null>(null);
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
```

Then, directly after line 222 (`const restaurantId = selectedRestaurant?.restaurant_id || null;`), add the role gate:

```typescript
  // Only an owner or a manager can post a trade for an employee. This mirrors
  // the create_shift_trade_for_employee RPC audience, so the offer action never
  // shows for a role the RPC would reject (e.g. operations_manager).
  const canOfferTrade =
    selectedRestaurant?.role === 'owner' || selectedRestaurant?.role === 'manager';
```

- [ ] **Step 3: Add the handler**

In `src/pages/Scheduling.tsx`, after the `handleDeleteShift` function (which ends at line 691), add:

```typescript
  const handleOfferTrade = (shift: Shift) => {
    setTradeShift(shift);
    setTradeDialogOpen(true);
  };
```

- [ ] **Step 4: Pass the prop to the draggable shift card**

In `src/pages/Scheduling.tsx`, change the `ShiftCard` inside `DraggableShiftCard` (lines 1422-1426):

```tsx
                                          <ShiftCard
                                            shift={shift}
                                            onEdit={handleEditShift}
                                            onDelete={handleDeleteShift}
                                          />
```

to:

```tsx
                                          <ShiftCard
                                            shift={shift}
                                            onEdit={handleEditShift}
                                            onDelete={handleDeleteShift}
                                            onOfferTrade={canOfferTrade ? handleOfferTrade : undefined}
                                          />
```

Leave the selection-mode `ShiftCard` at lines 1406-1414 unchanged (it hides the hover actions).

- [ ] **Step 5: Render the dialog**

In `src/pages/Scheduling.tsx`, inside the `{restaurantId && (` dialog block, after the `ShiftDialog` render (which ends at line 1630 with `/>`), add:

```tsx
          {tradeShift && (
            <TradeRequestDialog
              open={tradeDialogOpen}
              onOpenChange={(open) => {
                setTradeDialogOpen(open);
                if (!open) setTradeShift(null);
              }}
              shift={tradeShift}
              restaurantId={restaurantId}
              onBehalfOfEmployee={{
                id: tradeShift.employee_id,
                name: allEmployees.find((e) => e.id === tradeShift.employee_id)?.name ?? 'this employee',
              }}
            />
          )}
```

- [ ] **Step 6: Verify the wiring**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors in `src/pages/Scheduling.tsx`.

Run: `npm run build`
Expected: the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat(scheduling): open the trade dialog for managers from the shift card"
```

---

### Task 6: Playwright E2E — a manager posts a shift for trade

**Files:**
- Create: `tests/e2e/manager-initiated-shift-trade.spec.ts`

**Interfaces:**
- Consumes: the full stack from Tasks 1-5; test helpers `signUpAndCreateRestaurant`, `exposeSupabaseHelpers`, `generateTestUser` from `tests/helpers/e2e-supabase`.
- Produces: an end-to-end proof that an owner posts an employee's shift for trade from the grid, and the trade row lands with status `open`.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/manager-initiated-shift-trade.spec.ts`:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
// `(window as any).__supabase` / `__getRestaurantId` are the e2e page-side test
// hooks exposed by exposeSupabaseHelpers — untyped by design, as in the sibling
// scheduling e2e specs.
import { test, expect, type Page, type Request } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E for manager-initiated shift trade. An owner posts an employee's shift for
 * trade from the schedule grid card, and the trade lands with status 'open'.
 *
 * The notify edge function is not served in the e2e stack, so intercept the
 * send-shift-trade-notification request (stub 200) and assert the client
 * invokes it with action 'created'.
 */

const NOTIFY_GLOB = '**/functions/v1/send-shift-trade-notification';

/** Intercept the fire-and-forget notify invoke; return the collected POST bodies. */
async function interceptNotify(page: Page): Promise<Array<Record<string, unknown>>> {
  const notifyBodies: Array<Record<string, unknown>> = [];
  await page.route(NOTIFY_GLOB, async (route) => {
    const req: Request = route.request();
    if (req.method() === 'POST') {
      try {
        notifyBodies.push(req.postDataJSON() as Record<string, unknown>);
      } catch {
        // ignore unparseable body
      }
    }
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
  return notifyBodies;
}

test.describe('Manager-initiated shift trade', () => {
  test('an owner posts an employee\'s shift for trade from the grid', async ({ page }) => {
    const owner = generateTestUser('mgr-trade');
    await signUpAndCreateRestaurant(page, owner);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed employee A and A's shift TODAY (so it renders in the current week
    // view). A is linked to the owner's user id so RLS permits the insert.
    const seed = await page.evaluate(async (restId: string) => {
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No owner session');

      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId, user_id: user.id, name: 'Alex Absent', position: 'Server',
          status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500,
        })
        .select('id, name').single();
      if (empErr) throw new Error(`employee insert: ${empErr.message}`);

      const start = new Date();
      start.setHours(16, 0, 0, 0);
      const end = new Date(start);
      end.setHours(22, 0, 0, 0);
      const { data: shift, error: sErr } = await supabase
        .from('shifts')
        .insert({
          restaurant_id: restId, employee_id: emp.id,
          start_time: start.toISOString(), end_time: end.toISOString(),
          position: 'Server', status: 'scheduled', break_duration: 30,
          is_published: true, locked: false,
        })
        .select('id').single();
      if (sErr) throw new Error(`shift insert: ${sErr.message}`);

      return { empId: emp.id as string, shiftId: shift.id as string };
    }, restaurantId as string);

    const notifyBodies = await interceptNotify(page);

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 15000 });

    // The seeded shift card renders in the grid.
    const card = page.getByTestId('shift-card').first();
    await expect(card).toBeVisible({ timeout: 20000 });

    // Reveal the hover actions and click the offer action.
    await card.hover();
    const offerButton = page.getByRole('button', { name: /offer shift for trade/i }).first();
    await offerButton.click();

    // The manager-mode dialog opens with the employee name in the title.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Alex Absent/)).toBeVisible({ timeout: 5000 });

    // Post the marketplace trade (default type).
    await dialog.getByRole('button', { name: /post trade/i }).click();

    // The dialog closes.
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Authoritative: an open trade exists for the seeded shift, offered by A.
    await expect
      .poll(
        async () =>
          page.evaluate(async (shiftId: string) => {
            const supabase = (window as any).__supabase;
            const { data } = await supabase
              .from('shift_trades')
              .select('status, offered_by_employee_id, target_employee_id')
              .eq('offered_shift_id', shiftId)
              .maybeSingle();
            return data ? `${data.status}:${data.offered_by_employee_id}:${data.target_employee_id ?? 'null'}` : null;
          }, seed.shiftId),
        { timeout: 15000 },
      )
      .toBe(`open:${seed.empId}:null`);

    // The client invoked the notification with the created action.
    await expect.poll(() => notifyBodies.length, { timeout: 10000 }).toBeGreaterThan(0);
    expect(notifyBodies.some((b) => b.action === 'created')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Warning: the E2E needs the local stack. Start it first if it is not running: `npm run db:start`.

Run: `npx playwright test --project=e2e tests/e2e/manager-initiated-shift-trade.spec.ts --reporter=line`
Expected: PASS (1 test). If the shift card does not render, confirm the seeded shift start time falls inside the current week view.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/manager-initiated-shift-trade.spec.ts
git commit -m "test(shift-trades): e2e for manager-initiated shift trade"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-08-12-manager-initiated-shift-trade-design.md`):

- Backend RPC (Option A, owner/manager audience, NULL-safe check, allow-list status, `NOT FOUND` check, `unique_violation` catch) → Task 1.
- Notification reuse (`created`) → Task 2 (hook calls `sendShiftTradeNotification(id, 'created')`).
- Entry point: shift-card action → Task 4.
- Dialog: both marketplace and directed targets, on-behalf title, loading state, header fix → Task 3.
- Hook → Task 2. Wiring + client role gate → Task 5.
- Testing: pgTAP (Task 1), Vitest (Tasks 2, 3, 4), Playwright (Task 6).
- Desktop-only V1: the mobile view keeps no offer action (Global Constraints); Task 5 wires only the desktop grid card.

**2. Placeholder scan:** No `TBD`, no "add error handling", no "similar to Task N". Every code step shows full code.

**3. Type consistency:**
- RPC name `create_shift_trade_for_employee` is identical across Task 1 (migration), Task 2 (types.ts + hook), and Task 6 (implied).
- Hook name `useCreateShiftTradeForEmployee` is identical across Task 2 (definition), Task 3 (import + use).
- Prop `onBehalfOfEmployee: { id: string; name: string }` is identical across Task 3 (definition) and Task 5 (use).
- Prop `onOfferTrade: (shift: Shift) => void` is identical across Task 4 (definition) and Task 5 (use).
- Mutation input shape `{ restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id?, reason? }` matches between the hook (Task 2) and both call sites (Task 3 dialog, Task 6 not applicable).
- `aria-label="Offer shift for trade"` string matches across Task 4 (render + test) and Task 6 (E2E selector).

## Notes for the executor

- Blast radius: the change touches `TradeRequestDialog.tsx` (shared with `EmployeeSchedule.tsx`), `SchedulingShiftCard.tsx` (shared with the mobile view), and `Scheduling.tsx`. Task 3 keeps `currentEmployeeId` working for the self-service caller. Task 4 adds an optional prop, so the mobile view and the selection-mode card are unaffected.
- UI review (Phase 6): confirm the three hover icons (Edit, Offer, Delete) fit the desktop day column (`min-w-[130px]` on md). If they collide with the time text, move the Offer action into an overflow menu — but only that action, and only if the width check fails.
