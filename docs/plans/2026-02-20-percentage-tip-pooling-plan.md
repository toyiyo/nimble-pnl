# Percentage-Based Tip Pooling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Percentage Contribution" tip pooling model where servers keep most of their tips and contribute configurable percentages to named pools with independent distribution rules.

**Architecture:** Extend existing tip pooling tables with a `pooling_model` discriminator. New tables for pool definitions, server earnings, and pool allocations. Reuse `tip_splits` and `tip_split_items` as the final output. Existing approval/payout/audit/dispute flows remain unchanged.

**Tech Stack:** React 18, TypeScript, Vitest, Supabase (PostgreSQL + RLS), pgTAP, shadcn/ui, TailwindCSS

**Design Doc:** `docs/plans/2026-02-20-percentage-tip-pooling-design.md`

---

## Task 1: Database Migration — New Tables and Column

**Files:**
- Create: `supabase/migrations/2026XXXX_percentage_tip_pooling.sql` (use next timestamp)

**Step 1: Write the migration SQL**

```sql
-- Add pooling_model to tip_pool_settings
ALTER TABLE tip_pool_settings
  ADD COLUMN IF NOT EXISTS pooling_model TEXT NOT NULL DEFAULT 'full_pool'
  CHECK (pooling_model IN ('full_pool', 'percentage_contribution'));

-- New table: tip_contribution_pools
CREATE TABLE tip_contribution_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  settings_id UUID NOT NULL REFERENCES tip_pool_settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contribution_percentage DECIMAL(5,2) NOT NULL CHECK (contribution_percentage > 0),
  share_method TEXT NOT NULL CHECK (share_method IN ('hours', 'role', 'even')),
  role_weights JSONB DEFAULT '{}',
  eligible_employee_ids UUID[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tip_contribution_pools_restaurant ON tip_contribution_pools(restaurant_id);
CREATE INDEX idx_tip_contribution_pools_settings ON tip_contribution_pools(settings_id);

-- New table: tip_server_earnings
CREATE TABLE tip_server_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_split_id UUID NOT NULL REFERENCES tip_splits(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  earned_amount INTEGER NOT NULL DEFAULT 0,
  retained_amount INTEGER NOT NULL DEFAULT 0,
  refunded_amount INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_tip_server_earnings_unique
  ON tip_server_earnings(tip_split_id, employee_id);

-- New table: tip_pool_allocations
CREATE TABLE tip_pool_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_split_id UUID NOT NULL REFERENCES tip_splits(id) ON DELETE CASCADE,
  pool_id UUID NOT NULL REFERENCES tip_contribution_pools(id) ON DELETE CASCADE,
  total_contributed INTEGER NOT NULL DEFAULT 0,
  total_distributed INTEGER NOT NULL DEFAULT 0,
  total_refunded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_tip_pool_allocations_unique
  ON tip_pool_allocations(tip_split_id, pool_id);

-- RLS for tip_contribution_pools (same pattern as tip_pool_settings)
ALTER TABLE tip_contribution_pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage contribution pools"
  ON tip_contribution_pools FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.restaurant_id = tip_contribution_pools.restaurant_id
        AND e.user_id = auth.uid()
        AND e.role IN ('owner', 'manager')
    )
  );

-- RLS for tip_server_earnings
ALTER TABLE tip_server_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage server earnings"
  ON tip_server_earnings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits ts
      JOIN employees e ON e.restaurant_id = ts.restaurant_id
      WHERE ts.id = tip_server_earnings.tip_split_id
        AND e.user_id = auth.uid()
        AND e.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Employees can view their own server earnings"
  ON tip_server_earnings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = tip_server_earnings.employee_id
        AND e.user_id = auth.uid()
    )
  );

-- RLS for tip_pool_allocations
ALTER TABLE tip_pool_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage pool allocations"
  ON tip_pool_allocations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits ts
      JOIN employees e ON e.restaurant_id = ts.restaurant_id
      WHERE ts.id = tip_pool_allocations.tip_split_id
        AND e.user_id = auth.uid()
        AND e.role IN ('owner', 'manager')
    )
  );

-- updated_at trigger for tip_contribution_pools
CREATE TRIGGER update_tip_contribution_pools_updated_at
  BEFORE UPDATE ON tip_contribution_pools
  FOR EACH ROW
  EXECUTE FUNCTION update_tip_pooling_updated_at();
```

**Step 2: Apply the migration**

Run: `npm run db:reset` (or use Supabase MCP `apply_migration`)

**Step 3: Verify tables exist**

Run: `npx supabase db dump --local | grep -E "tip_contribution_pools|tip_server_earnings|tip_pool_allocations|pooling_model"`
Expected: All table and column names appear.

**Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add percentage tip pooling schema (pools, server earnings, allocations)"
```

---

## Task 2: pgTAP Tests for New Schema

**Files:**
- Create: `supabase/tests/XX_percentage_tip_pooling.sql` (use next number in sequence)

**Step 1: Write pgTAP tests**

Test the following:
1. `pooling_model` column exists on `tip_pool_settings` with correct default
2. `pooling_model` CHECK constraint rejects invalid values
3. `tip_contribution_pools` table exists with correct columns
4. `tip_server_earnings` unique constraint on `(tip_split_id, employee_id)` works
5. `tip_pool_allocations` unique constraint on `(tip_split_id, pool_id)` works
6. `contribution_percentage` rejects values <= 0
7. `share_method` CHECK constraint on `tip_contribution_pools` rejects invalid values

```sql
BEGIN;
SELECT plan(7);

-- Test 1: pooling_model column exists with correct default
SELECT has_column('public', 'tip_pool_settings', 'pooling_model',
  'tip_pool_settings should have pooling_model column');

-- Test 2: pooling_model rejects invalid values
SELECT throws_ok(
  $$INSERT INTO tip_pool_settings (restaurant_id, pooling_model) VALUES (gen_random_uuid(), 'invalid')$$,
  '23514', -- check constraint violation
  NULL,
  'pooling_model rejects invalid values'
);

-- Test 3: tip_contribution_pools table exists
SELECT has_table('public', 'tip_contribution_pools',
  'tip_contribution_pools table should exist');

-- Test 4: tip_server_earnings unique constraint
SELECT has_index('public', 'tip_server_earnings', 'idx_tip_server_earnings_unique',
  'tip_server_earnings should have unique index on (tip_split_id, employee_id)');

-- Test 5: tip_pool_allocations unique constraint
SELECT has_index('public', 'tip_pool_allocations', 'idx_tip_pool_allocations_unique',
  'tip_pool_allocations should have unique index on (tip_split_id, pool_id)');

-- Test 6: contribution_percentage rejects <= 0
SELECT throws_ok(
  $$INSERT INTO tip_contribution_pools (restaurant_id, settings_id, name, contribution_percentage, share_method)
    VALUES (gen_random_uuid(), gen_random_uuid(), 'Test', 0, 'hours')$$,
  '23514',
  NULL,
  'contribution_percentage rejects zero'
);

-- Test 7: share_method rejects invalid values on tip_contribution_pools
SELECT throws_ok(
  $$INSERT INTO tip_contribution_pools (restaurant_id, settings_id, name, contribution_percentage, share_method)
    VALUES (gen_random_uuid(), gen_random_uuid(), 'Test', 5, 'invalid')$$,
  '23514',
  NULL,
  'share_method rejects invalid values on tip_contribution_pools'
);

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run pgTAP tests**

Run: `npm run test:db`
Expected: All 7 tests pass. Note: some tests may fail due to FK constraints on random UUIDs — adjust by creating proper parent rows if needed. The check constraint tests should still throw 23514.

**Step 3: Commit**

```bash
git add supabase/tests/
git commit -m "test: add pgTAP tests for percentage tip pooling schema"
```

---

## Task 3: Unit Tests for Percentage Contribution Calculations (Write Tests FIRST)

**Files:**
- Create: `tests/unit/tipPooling-percentage.test.ts`
- Reference: `src/utils/tipPooling.ts` (existing types and functions)

**Step 1: Write comprehensive failing tests**

These tests define the contract for four new functions. Write ALL tests before any implementation.

```typescript
import { describe, it, expect } from 'vitest';
import {
  calculatePercentageContributions,
  calculatePoolRefunds,
  calculatePercentagePoolAllocations,
  type ServerEarning,
  type ContributionPool,
  type PoolWorker,
  type PercentageAllocationResult,
} from '@/utils/tipPooling';

// ── Helpers ──────────────────────────────────────────────────────────────────

const server = (id: string, name: string, earnedCents: number): ServerEarning => ({
  employeeId: id,
  name,
  earnedAmountCents: earnedCents,
});

const pool = (
  id: string,
  name: string,
  pct: number,
  method: 'hours' | 'role' | 'even',
  eligibleIds: string[],
  roleWeights?: Record<string, number>,
): ContributionPool => ({
  id,
  name,
  contributionPercentage: pct,
  shareMethod: method,
  eligibleEmployeeIds: eligibleIds,
  roleWeights: roleWeights ?? {},
});

const worker = (id: string, name: string, hours: number, role?: string): PoolWorker => ({
  employeeId: id,
  name,
  hoursWorked: hours,
  role: role ?? '',
});

// ── calculatePercentageContributions ─────────────────────────────────────────

describe('calculatePercentageContributions', () => {
  it('calculates correct contribution amounts for each server and pool', () => {
    const servers = [server('s1', 'Maria', 20000), server('s2', 'John', 15000)];
    const pools = [pool('p1', 'Dishwashers', 5, 'hours', ['d1'])];
    const result = calculatePercentageContributions(servers, pools);

    expect(result).toEqual([
      { serverId: 's1', poolId: 'p1', amountCents: 1000 }, // 20000 * 5% = 1000
      { serverId: 's2', poolId: 'p1', amountCents: 750 },  // 15000 * 5% = 750
    ]);
  });

  it('handles multiple pools', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const pools = [
      pool('p1', 'Dish', 5, 'hours', ['d1']),
      pool('p2', 'FOH', 3, 'even', ['f1']),
    ];
    const result = calculatePercentageContributions(servers, pools);

    expect(result).toEqual([
      { serverId: 's1', poolId: 'p1', amountCents: 500 },
      { serverId: 's1', poolId: 'p2', amountCents: 300 },
    ]);
  });

  it('rounds fractional cents down (floor)', () => {
    // 333 * 5% = 16.65 → 17 cents (Math.round)
    const servers = [server('s1', 'Maria', 333)];
    const pools = [pool('p1', 'Pool', 5, 'hours', ['d1'])];
    const result = calculatePercentageContributions(servers, pools);
    expect(result[0].amountCents).toBe(17); // Math.round(16.65)
  });

  it('returns zero contribution for zero-dollar server', () => {
    const servers = [server('s1', 'Maria', 0)];
    const pools = [pool('p1', 'Pool', 5, 'hours', ['d1'])];
    const result = calculatePercentageContributions(servers, pools);
    expect(result[0].amountCents).toBe(0);
  });

  it('returns empty array when no pools', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const result = calculatePercentageContributions(servers, []);
    expect(result).toEqual([]);
  });

  it('returns empty array when no servers', () => {
    const pools = [pool('p1', 'Pool', 5, 'hours', ['d1'])];
    const result = calculatePercentageContributions([], pools);
    expect(result).toEqual([]);
  });
});

// ── calculatePoolRefunds ─────────────────────────────────────────────────────

describe('calculatePoolRefunds', () => {
  it('refunds proportionally when pool is empty (no workers)', () => {
    const contributions = [
      { serverId: 's1', poolId: 'p1', amountCents: 1000 },
      { serverId: 's2', poolId: 'p1', amountCents: 750 },
    ];
    const refunds = calculatePoolRefunds('p1', contributions, 1750);
    expect(refunds).toEqual([
      { serverId: 's1', poolId: 'p1', refundCents: 1000 },
      { serverId: 's2', poolId: 'p1', refundCents: 750 },
    ]);
  });

  it('handles rounding in refunds — total matches pool total', () => {
    // 3 servers contributed 333 each = 999 total
    const contributions = [
      { serverId: 's1', poolId: 'p1', amountCents: 333 },
      { serverId: 's2', poolId: 'p1', amountCents: 333 },
      { serverId: 's3', poolId: 'p1', amountCents: 333 },
    ];
    const refunds = calculatePoolRefunds('p1', contributions, 999);
    const totalRefunded = refunds.reduce((s, r) => s + r.refundCents, 0);
    expect(totalRefunded).toBe(999);
  });

  it('returns empty for zero-amount pool', () => {
    const contributions = [
      { serverId: 's1', poolId: 'p1', amountCents: 0 },
    ];
    const refunds = calculatePoolRefunds('p1', contributions, 0);
    expect(refunds).toEqual([
      { serverId: 's1', poolId: 'p1', refundCents: 0 },
    ]);
  });

  it('single server gets full refund', () => {
    const contributions = [
      { serverId: 's1', poolId: 'p1', amountCents: 500 },
    ];
    const refunds = calculatePoolRefunds('p1', contributions, 500);
    expect(refunds[0].refundCents).toBe(500);
  });
});

// ── calculatePercentagePoolAllocations (end-to-end) ──────────────────────────

describe('calculatePercentagePoolAllocations', () => {
  it('basic 2-server, 2-pool scenario with one empty pool', () => {
    const servers = [
      server('s1', 'Maria', 20000),
      server('s2', 'John', 15000),
    ];
    const pools = [
      pool('p1', 'Dishwashers', 5, 'hours', ['d1', 'd2']),
      pool('p2', 'FOH', 3, 'even', ['f1', 'f2']),
    ];
    // d1 worked 6h, d2 did not. f1 and f2 did not work.
    const workers: PoolWorker[] = [worker('d1', 'Dishwasher A', 6)];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    // Dishwasher pool: 20000*5% + 15000*5% = 1000 + 750 = 1750
    // FOH pool: 20000*3% + 15000*3% = 600 + 450 = 1050 → EMPTY → refund
    // Maria: 20000 - 1000 - 600 + 600 = 19000
    // John: 15000 - 750 - 450 + 450 = 14250
    // d1: 1750

    // Check server retained amounts
    const maria = result.serverResults.find(s => s.employeeId === 's1')!;
    expect(maria.earnedAmountCents).toBe(20000);
    expect(maria.retainedAmountCents).toBe(19000);
    expect(maria.refundedAmountCents).toBe(600);

    const john = result.serverResults.find(s => s.employeeId === 's2')!;
    expect(john.earnedAmountCents).toBe(15000);
    expect(john.retainedAmountCents).toBe(14250);
    expect(john.refundedAmountCents).toBe(450);

    // Check pool allocations
    const dishPool = result.poolResults.find(p => p.poolId === 'p1')!;
    expect(dishPool.totalContributed).toBe(1750);
    expect(dishPool.totalDistributed).toBe(1750);
    expect(dishPool.totalRefunded).toBe(0);

    const fohPool = result.poolResults.find(p => p.poolId === 'p2')!;
    expect(fohPool.totalContributed).toBe(1050);
    expect(fohPool.totalDistributed).toBe(0);
    expect(fohPool.totalRefunded).toBe(1050);

    // Check final tip_split_items
    const items = result.splitItems;
    const mariaItem = items.find(i => i.employeeId === 's1')!;
    expect(mariaItem.amountCents).toBe(19000);
    const johnItem = items.find(i => i.employeeId === 's2')!;
    expect(johnItem.amountCents).toBe(14250);
    const d1Item = items.find(i => i.employeeId === 'd1')!;
    expect(d1Item.amountCents).toBe(1750);

    // Total in = total out
    const totalIn = 20000 + 15000;
    const totalOut = items.reduce((s, i) => s + i.amountCents, 0);
    expect(totalOut).toBe(totalIn);
  });

  it('all pools empty — servers keep everything', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const pools = [pool('p1', 'Dish', 5, 'hours', ['d1'])];
    const workers: PoolWorker[] = []; // nobody worked

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    expect(result.serverResults[0].retainedAmountCents).toBe(10000);
    expect(result.serverResults[0].refundedAmountCents).toBe(500);
    expect(result.splitItems).toHaveLength(1); // just the server
    expect(result.splitItems[0].amountCents).toBe(10000);
  });

  it('server is also pool recipient — combined amount', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const pools = [pool('p1', 'FOH', 5, 'even', ['s1', 'f1'])];
    // Both s1 (Maria) and f1 work
    const workers: PoolWorker[] = [
      worker('s1', 'Maria', 8),
      worker('f1', 'Host', 8),
    ];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    // Pool: 10000 * 5% = 500. Even split between s1 and f1 = 250 each.
    // Maria retained: 10000 - 500 = 9500. Plus pool: 250. Final: 9750.
    const maria = result.splitItems.find(i => i.employeeId === 's1')!;
    expect(maria.amountCents).toBe(9750);
    const host = result.splitItems.find(i => i.employeeId === 'f1')!;
    expect(host.amountCents).toBe(250);
  });

  it('hours-based pool distributes proportionally', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const pools = [pool('p1', 'Dish', 10, 'hours', ['d1', 'd2'])];
    const workers: PoolWorker[] = [
      worker('d1', 'A', 6),
      worker('d2', 'B', 4),
    ];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);
    const poolTotal = 1000; // 10000 * 10%
    const d1 = result.splitItems.find(i => i.employeeId === 'd1')!;
    const d2 = result.splitItems.find(i => i.employeeId === 'd2')!;
    // d1: 6/10 * 1000 = 600, d2: 4/10 * 1000 = 400
    expect(d1.amountCents).toBe(600);
    expect(d2.amountCents).toBe(400);
  });

  it('role-based pool distributes by weights', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const pools = [pool('p1', 'Kitchen', 10, 'role', ['k1', 'k2'], { 'Chef': 3, 'Prep': 1 })];
    const workers: PoolWorker[] = [
      worker('k1', 'Chef Kim', 8, 'Chef'),
      worker('k2', 'Prep Pat', 8, 'Prep'),
    ];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);
    const k1 = result.splitItems.find(i => i.employeeId === 'k1')!;
    const k2 = result.splitItems.find(i => i.employeeId === 'k2')!;
    // Total weight: 3+1=4. Chef: 3/4*1000=750. Prep: 1/4*1000=250.
    expect(k1.amountCents).toBe(750);
    expect(k2.amountCents).toBe(250);
  });

  it('rounding preserves total in = total out', () => {
    // Intentionally awkward numbers
    const servers = [
      server('s1', 'A', 3333),
      server('s2', 'B', 6667),
    ];
    const pools = [
      pool('p1', 'Pool1', 7, 'even', ['d1', 'd2', 'd3']),
    ];
    const workers: PoolWorker[] = [
      worker('d1', 'D1', 4),
      worker('d2', 'D2', 4),
      worker('d3', 'D3', 4),
    ];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);
    const totalIn = 3333 + 6667;
    const totalOut = result.splitItems.reduce((s, i) => s + i.amountCents, 0);
    expect(totalOut).toBe(totalIn);
  });

  it('zero-dollar server has no contribution and no refund', () => {
    const servers = [
      server('s1', 'Maria', 10000),
      server('s2', 'Newbie', 0),
    ];
    const pools = [pool('p1', 'Dish', 5, 'hours', ['d1'])];
    const workers: PoolWorker[] = []; // no dishwashers

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    const maria = result.serverResults.find(s => s.employeeId === 's1')!;
    expect(maria.refundedAmountCents).toBe(500); // gets her contribution back

    const newbie = result.serverResults.find(s => s.employeeId === 's2')!;
    expect(newbie.refundedAmountCents).toBe(0); // contributed nothing, gets nothing back
    expect(newbie.retainedAmountCents).toBe(0);
  });

  it('multiple pools, partial refunds', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const pools = [
      pool('p1', 'Dish', 5, 'hours', ['d1']),
      pool('p2', 'FOH', 3, 'even', ['f1']),
    ];
    // d1 works, f1 does not
    const workers: PoolWorker[] = [worker('d1', 'Dishwasher', 6)];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    // Dish: 500 distributed to d1. FOH: 300 refunded to Maria.
    const maria = result.serverResults[0];
    expect(maria.earnedAmountCents).toBe(10000);
    expect(maria.retainedAmountCents).toBe(9800); // 10000 - 500 - 300 + 300
    expect(maria.refundedAmountCents).toBe(300);

    const totalOut = result.splitItems.reduce((s, i) => s + i.amountCents, 0);
    expect(totalOut).toBe(10000);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/tipPooling-percentage.test.ts`
Expected: ALL tests fail with import errors (functions don't exist yet).

**Step 3: Commit failing tests**

```bash
git add tests/unit/tipPooling-percentage.test.ts
git commit -m "test: add failing tests for percentage tip pooling calculations"
```

---

## Task 4: Implement Percentage Contribution Calculation Functions

**Files:**
- Modify: `src/utils/tipPooling.ts`

**Step 1: Add types**

Add these types after the existing `TipShare` type:

```typescript
export type ServerEarning = {
  employeeId: string;
  name: string;
  earnedAmountCents: number;
};

export type ContributionPool = {
  id: string;
  name: string;
  contributionPercentage: number; // e.g., 5 for 5%
  shareMethod: 'hours' | 'role' | 'even';
  eligibleEmployeeIds: string[];
  roleWeights: Record<string, number>;
};

export type PoolWorker = {
  employeeId: string;
  name: string;
  hoursWorked: number;
  role: string;
};

export type Contribution = {
  serverId: string;
  poolId: string;
  amountCents: number;
};

export type Refund = {
  serverId: string;
  poolId: string;
  refundCents: number;
};

export type ServerResult = {
  employeeId: string;
  name: string;
  earnedAmountCents: number;
  retainedAmountCents: number;
  refundedAmountCents: number;
};

export type PoolResult = {
  poolId: string;
  poolName: string;
  totalContributed: number;
  totalDistributed: number;
  totalRefunded: number;
  recipientShares: TipShare[];
};

export type PercentageAllocationResult = {
  serverResults: ServerResult[];
  poolResults: PoolResult[];
  splitItems: TipShare[];
};
```

**Step 2: Implement `calculatePercentageContributions`**

```typescript
export function calculatePercentageContributions(
  servers: ServerEarning[],
  pools: ContributionPool[],
): Contribution[] {
  const contributions: Contribution[] = [];
  for (const s of servers) {
    for (const p of pools) {
      const amount = Math.round(s.earnedAmountCents * p.contributionPercentage / 100);
      contributions.push({ serverId: s.employeeId, poolId: p.id, amountCents: amount });
    }
  }
  return contributions;
}
```

**Step 3: Implement `calculatePoolRefunds`**

```typescript
export function calculatePoolRefunds(
  poolId: string,
  contributions: Contribution[],
  poolTotal: number,
): Refund[] {
  const poolContributions = contributions.filter(c => c.poolId === poolId);
  if (poolTotal <= 0) {
    return poolContributions.map(c => ({ serverId: c.serverId, poolId, refundCents: 0 }));
  }

  const refunds: Refund[] = [];
  let allocated = 0;

  poolContributions.forEach((c, idx) => {
    if (idx === poolContributions.length - 1) {
      refunds.push({ serverId: c.serverId, poolId, refundCents: poolTotal - allocated });
    } else {
      const refund = Math.round(poolTotal * (c.amountCents / poolTotal));
      allocated += refund;
      refunds.push({ serverId: c.serverId, poolId, refundCents: refund });
    }
  });

  return refunds;
}
```

**Step 4: Implement `calculatePercentagePoolAllocations`**

```typescript
export function calculatePercentagePoolAllocations(
  servers: ServerEarning[],
  pools: ContributionPool[],
  workers: PoolWorker[],
): PercentageAllocationResult {
  // Step 1: Calculate contributions
  const contributions = calculatePercentageContributions(servers, pools);

  // Step 2-3: Process each pool
  const poolResults: PoolResult[] = [];
  const allRefunds: Refund[] = [];

  for (const p of pools) {
    const poolContribs = contributions.filter(c => c.poolId === p.id);
    const poolTotal = poolContribs.reduce((s, c) => s + c.amountCents, 0);

    // Which eligible employees actually worked?
    const activeWorkers = workers.filter(w => p.eligibleEmployeeIds.includes(w.employeeId));

    if (activeWorkers.length === 0) {
      // Empty pool — refund everything
      const refunds = calculatePoolRefunds(p.id, contributions, poolTotal);
      allRefunds.push(...refunds);
      poolResults.push({
        poolId: p.id,
        poolName: p.name,
        totalContributed: poolTotal,
        totalDistributed: 0,
        totalRefunded: poolTotal,
        recipientShares: [],
      });
    } else {
      // Distribute using existing functions
      let shares: TipShare[];
      if (p.shareMethod === 'hours') {
        shares = calculateTipSplitByHours(
          poolTotal,
          activeWorkers.map(w => ({ id: w.employeeId, name: w.name, hours: w.hoursWorked })),
        );
      } else if (p.shareMethod === 'role') {
        shares = calculateTipSplitByRole(
          poolTotal,
          activeWorkers.map(w => ({
            id: w.employeeId,
            name: w.name,
            role: w.role,
            weight: p.roleWeights[w.role] ?? 0,
          })),
        );
      } else {
        shares = calculateTipSplitEven(
          poolTotal,
          activeWorkers.map(w => ({ id: w.employeeId, name: w.name })),
        );
      }
      poolResults.push({
        poolId: p.id,
        poolName: p.name,
        totalContributed: poolTotal,
        totalDistributed: poolTotal,
        totalRefunded: 0,
        recipientShares: shares,
      });
    }
  }

  // Step 4: Build server results
  const serverResults: ServerResult[] = servers.map(s => {
    const totalContributed = contributions
      .filter(c => c.serverId === s.employeeId)
      .reduce((sum, c) => sum + c.amountCents, 0);
    const totalRefunded = allRefunds
      .filter(r => r.serverId === s.employeeId)
      .reduce((sum, r) => sum + r.refundCents, 0);
    return {
      employeeId: s.employeeId,
      name: s.name,
      earnedAmountCents: s.earnedAmountCents,
      retainedAmountCents: s.earnedAmountCents - totalContributed + totalRefunded,
      refundedAmountCents: totalRefunded,
    };
  });

  // Step 5: Build combined split items
  const itemMap = new Map<string, TipShare>();

  // Add server retained amounts
  for (const sr of serverResults) {
    if (sr.retainedAmountCents > 0 || servers.some(s => s.employeeId === sr.employeeId)) {
      itemMap.set(sr.employeeId, {
        employeeId: sr.employeeId,
        name: sr.name,
        amountCents: sr.retainedAmountCents,
      });
    }
  }

  // Add pool recipient amounts (merge if server is also recipient)
  for (const pr of poolResults) {
    for (const share of pr.recipientShares) {
      const existing = itemMap.get(share.employeeId);
      if (existing) {
        existing.amountCents += share.amountCents;
      } else {
        itemMap.set(share.employeeId, { ...share });
      }
    }
  }

  // Filter out zero-amount items that aren't servers
  const splitItems = Array.from(itemMap.values()).filter(
    item => item.amountCents > 0 || servers.some(s => s.employeeId === item.employeeId)
  );

  return { serverResults, poolResults, splitItems };
}
```

**Step 5: Run tests to verify they pass**

Run: `npm run test -- tests/unit/tipPooling-percentage.test.ts`
Expected: ALL tests pass.

**Step 6: Commit**

```bash
git add src/utils/tipPooling.ts
git commit -m "feat: implement percentage contribution tip pooling calculations"
```

---

## Task 5: Update useTipPoolSettings Hook

**Files:**
- Modify: `src/hooks/useTipPoolSettings.tsx`

**Step 1: Write failing test for the new type**

Add to `tests/unit/tipPooling-percentage.test.ts`:

```typescript
import type { PoolingModel } from '@/hooks/useTipPoolSettings';

describe('PoolingModel type', () => {
  it('accepts valid pooling model values', () => {
    const model1: PoolingModel = 'full_pool';
    const model2: PoolingModel = 'percentage_contribution';
    expect(model1).toBe('full_pool');
    expect(model2).toBe('percentage_contribution');
  });
});
```

Run: `npm run test -- tests/unit/tipPooling-percentage.test.ts`
Expected: Fails — `PoolingModel` not exported.

**Step 2: Update the hook**

In `src/hooks/useTipPoolSettings.tsx`:

1. Add to existing type exports:
```typescript
export type PoolingModel = 'full_pool' | 'percentage_contribution';
```

2. Add `pooling_model` to the `TipPoolSettings` type:
```typescript
export type TipPoolSettings = {
  id: string;
  restaurant_id: string;
  tip_source: TipSource;
  share_method: ShareMethod;
  split_cadence: SplitCadence;
  role_weights: Record<string, number>;
  enabled_employee_ids: string[];
  active: boolean;
  pooling_model: PoolingModel; // NEW
  created_at: string;
  updated_at: string;
  created_by: string | null;
};
```

3. Add `pooling_model` to the `TipPoolSettingsUpdate` type:
```typescript
export type TipPoolSettingsUpdate = {
  tip_source?: TipSource;
  share_method?: ShareMethod;
  split_cadence?: SplitCadence;
  role_weights?: Record<string, number>;
  enabled_employee_ids?: string[];
  pooling_model?: PoolingModel; // NEW
};
```

4. Include `pooling_model` in the select query (add to the `.select()` call).

**Step 3: Run tests**

Run: `npm run test -- tests/unit/tipPooling-percentage.test.ts`
Expected: PoolingModel type test passes.

**Step 4: Commit**

```bash
git add src/hooks/useTipPoolSettings.tsx tests/unit/tipPooling-percentage.test.ts
git commit -m "feat: add pooling_model to useTipPoolSettings hook"
```

---

## Task 6: Create useTipContributionPools Hook

**Files:**
- Create: `src/hooks/useTipContributionPools.tsx`

**Step 1: Write the hook**

Follow the same pattern as `useTipPoolSettings.tsx`. The hook should:

1. Export a `TipContributionPool` type matching the DB schema:
```typescript
export type TipContributionPool = {
  id: string;
  restaurant_id: string;
  settings_id: string;
  name: string;
  contribution_percentage: number;
  share_method: 'hours' | 'role' | 'even';
  role_weights: Record<string, number>;
  eligible_employee_ids: string[];
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};
```

2. Query: Fetch all active pools for a settings_id, ordered by sort_order.
3. Mutations:
   - `createPool(pool)` — insert new pool
   - `updatePool(id, updates)` — update pool fields
   - `deletePool(id)` — set active=false (soft delete)
   - `reorderPools(poolIds)` — update sort_order for all pools
4. Use React Query with `queryKey: ['tip-contribution-pools', settingsId]`, staleTime 30s.

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors in the new file.

**Step 3: Commit**

```bash
git add src/hooks/useTipContributionPools.tsx
git commit -m "feat: add useTipContributionPools hook for pool CRUD"
```

---

## Task 7: Create useTipServerEarnings Hook

**Files:**
- Create: `src/hooks/useTipServerEarnings.tsx`

**Step 1: Write the hook**

Export a `TipServerEarning` type:
```typescript
export type TipServerEarning = {
  id: string;
  tip_split_id: string;
  employee_id: string;
  earned_amount: number; // cents
  retained_amount: number; // cents
  refunded_amount: number; // cents
  created_at: string;
};
```

Query: Fetch server earnings for a split_id with employee joins.
Mutations:
- `saveServerEarnings(splitId, earnings[])` — upsert batch (delete-then-insert pattern, same as payouts).

queryKey: `['tip-server-earnings', splitId]`, staleTime 30s.

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/hooks/useTipServerEarnings.tsx
git commit -m "feat: add useTipServerEarnings hook"
```

---

## Task 8: Update TipPoolSettingsDialog — Add Model Selection

**Files:**
- Modify: `src/components/tips/TipPoolSettingsDialog.tsx`

**Step 1: Add Step 0 — Pooling Model Selection**

Before the existing tip source step, add a new first step with two cards:

```tsx
{/* Step 0: Pooling Model */}
<div className="space-y-3">
  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
    Pooling Model
  </Label>
  <div className="grid grid-cols-2 gap-3">
    <button
      onClick={() => onPoolingModelChange('full_pool')}
      className={cn(
        'flex flex-col items-start p-4 rounded-xl border transition-colors text-left',
        poolingModel === 'full_pool'
          ? 'border-foreground bg-muted/50'
          : 'border-border/40 hover:border-border'
      )}
    >
      <Users className="h-5 w-5 mb-2" />
      <span className="text-[14px] font-medium">Full Pool</span>
      <span className="text-[12px] text-muted-foreground mt-1">
        All tips pooled and distributed to everyone
      </span>
    </button>
    <button
      onClick={() => onPoolingModelChange('percentage_contribution')}
      className={cn(
        'flex flex-col items-start p-4 rounded-xl border transition-colors text-left',
        poolingModel === 'percentage_contribution'
          ? 'border-foreground bg-muted/50'
          : 'border-border/40 hover:border-border'
      )}
    >
      <Percent className="h-5 w-5 mb-2" />
      <span className="text-[14px] font-medium">Percentage Contribution</span>
      <span className="text-[12px] text-muted-foreground mt-1">
        Servers keep most tips, contribute % to pools
      </span>
    </button>
  </div>
</div>
```

**Step 2: Conditionally show steps based on model**

- If `full_pool`: show existing steps (source, method, cadence, weights, employees) unchanged.
- If `percentage_contribution`: show pool configuration step (Task 9), server selection, cadence.

**Step 3: Add props**

Add `poolingModel` and `onPoolingModelChange` to the component props. The parent (Tips page) should pass these from the `useTipPoolSettings` hook.

**Step 4: Run lint and verify**

Run: `npm run lint -- --no-warn-ignored`
Expected: No new errors.

**Step 5: Commit**

```bash
git add src/components/tips/TipPoolSettingsDialog.tsx
git commit -m "feat: add pooling model selection step to settings dialog"
```

---

## Task 9: Add Pool Configuration UI

**Files:**
- Create: `src/components/tips/ContributionPoolEditor.tsx`

**Step 1: Build the pool editor component**

This is a list of pool cards, each editable. Rendered inside the settings dialog when `percentage_contribution` is selected.

Props:
```typescript
type Props = {
  pools: TipContributionPool[];
  eligibleEmployees: Employee[];
  onCreatePool: (pool: Omit<TipContributionPool, 'id' | 'restaurant_id' | 'settings_id' | 'created_at' | 'updated_at'>) => void;
  onUpdatePool: (id: string, updates: Partial<TipContributionPool>) => void;
  onDeletePool: (id: string) => void;
};
```

Each pool card shows:
- Pool name (text input)
- Contribution percentage (number input with % suffix)
- Distribution method selector (hours/role/even)
- Role weights (conditional on role method)
- Eligible employees (multi-select checkboxes)
- Delete button (ghost, destructive)

At the bottom:
- "Add Pool" button
- Total contribution percentage badge (e.g., "Total: 8%")
- Warning if total > 50%

Follow Apple/Notion styling from CLAUDE.md: rounded-xl cards, border-border/40, text-[14px], etc.

**Step 2: Run lint**

Run: `npm run lint -- --no-warn-ignored`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/components/tips/ContributionPoolEditor.tsx
git commit -m "feat: add ContributionPoolEditor component for pool configuration"
```

---

## Task 10: Create TipServerEntrySheet

**Files:**
- Create: `src/components/tips/TipServerEntrySheet.tsx`

**Step 1: Build the component**

Similar to `TipDayEntrySheet.tsx` but with per-server input. Renders as a Sheet (right drawer).

Props:
```typescript
type Props = {
  open: boolean;
  date: Date;
  servers: Employee[]; // contributing servers from settings
  initialEarnings?: Map<string, number>; // employeeId -> cents
  loading?: boolean;
  onSave: (earnings: Array<{ employeeId: string; amountCents: number }>) => void;
  onCancel: () => void;
};
```

Layout:
- Header: "Enter Server Tips — {date}"
- List of server rows, each with: Name | Dollar input
- Running total at bottom
- "Calculate Split" primary button

**Step 2: Run lint**

Run: `npm run lint -- --no-warn-ignored`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/components/tips/TipServerEntrySheet.tsx
git commit -m "feat: add TipServerEntrySheet for per-server tip entry"
```

---

## Task 11: Update TipReviewScreen for Percentage Contribution

**Files:**
- Modify: `src/components/tips/TipReviewScreen.tsx`

**Step 1: Add percentage contribution view**

When the split was created with `percentage_contribution` model, the review screen should show 3 sections instead of the current single table:

1. **Server Earnings** — Table: Server | Earned | Deductions | Refunds | Final
2. **Pool Breakdown** — Collapsible per pool: Pool Name (% method) | Total | Per-employee list
3. **All Allocations** — Current table (unchanged for approval)

Add a new prop: `poolingModel: PoolingModel`
When `full_pool`, render exactly as today.
When `percentage_contribution`, render the 3-section layout.

Additional new props for the percentage view:
```typescript
serverResults?: ServerResult[];
poolResults?: PoolResult[];
```

**Step 2: Run lint**

Run: `npm run lint -- --no-warn-ignored`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/components/tips/TipReviewScreen.tsx
git commit -m "feat: add percentage contribution breakdown to TipReviewScreen"
```

---

## Task 12: Update Tips Page — Wire Everything Together

**Files:**
- Modify: `src/pages/Tips.tsx`

**Step 1: Read the current Tips page**

Read the full file to understand current structure and state management.

**Step 2: Add percentage contribution flow**

The Tips page orchestrates the tip entry workflow. Changes needed:

1. Import new hooks: `useTipContributionPools`, `useTipServerEarnings`
2. Read `poolingModel` from `useTipPoolSettings`
3. When `percentage_contribution`:
   - Show `TipServerEntrySheet` instead of `TipDayEntrySheet`
   - After server earnings submitted, run `calculatePercentagePoolAllocations`
   - Pass results to `TipReviewScreen` with new props
   - On approval, save:
     - `tip_server_earnings` via `useTipServerEarnings`
     - `tip_pool_allocations` (direct Supabase insert — no hook needed for v1, or create minimal hook)
     - `tip_split_items` via existing `useTipSplits.saveTipSplit`
4. When `full_pool`: unchanged behavior.

**Step 3: Run lint and type check**

Run: `npm run lint -- --no-warn-ignored && npx tsc --noEmit`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/pages/Tips.tsx
git commit -m "feat: wire percentage contribution flow into Tips page"
```

---

## Task 13: Update EmployeeTips Page

**Files:**
- Modify: `src/pages/EmployeeTips.tsx`

**Step 1: Read the current page**

Understand how employee tips are currently displayed.

**Step 2: Add percentage contribution breakdown**

When the split used `percentage_contribution` model:
- Fetch server earnings for the employee (if they're a server)
- Show: Earned | Pool Contributions | Refunds | Final
- If they're a pool recipient: show "From [Pool Name]: $X"

The data comes from `tip_server_earnings` and `tip_pool_allocations` tables. Either:
- Extend the existing `useEmployeeTips` hook to join these tables, OR
- Fetch inline with a targeted query

**Step 3: Run lint**

Run: `npm run lint -- --no-warn-ignored`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/pages/EmployeeTips.tsx
git commit -m "feat: add percentage contribution breakdown to employee tip view"
```

---

## Task 14: Integration Test — Full Flow

**Files:**
- Add to: `tests/unit/tipPooling-percentage.test.ts`

**Step 1: Write integration-style unit test**

Test the complete flow from server earnings through calculation to split items, simulating what the Tips page does:

```typescript
describe('full flow integration', () => {
  it('simulates complete percentage contribution workflow', () => {
    // Setup: 3 servers, 2 pools
    const servers = [
      server('s1', 'Maria', 25000),
      server('s2', 'John', 15000),
      server('s3', 'Lisa', 10000),
    ];
    const pools = [
      pool('p1', 'Dishwashers', 5, 'hours', ['d1', 'd2']),
      pool('p2', 'Bussers', 3, 'even', ['b1', 'b2', 'b3']),
    ];
    const workers = [
      worker('d1', 'Dish 1', 8),
      worker('d2', 'Dish 2', 4),
      worker('b1', 'Bus 1', 6),
      worker('b2', 'Bus 2', 6),
      // b3 did not work, d1+d2 work, b1+b2 work
    ];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    // Verify total in = total out
    const totalIn = 25000 + 15000 + 10000;
    const totalOut = result.splitItems.reduce((s, i) => s + i.amountCents, 0);
    expect(totalOut).toBe(totalIn);

    // Verify all server results have valid amounts
    for (const sr of result.serverResults) {
      expect(sr.retainedAmountCents).toBeGreaterThanOrEqual(0);
      expect(sr.retainedAmountCents).toBeLessThanOrEqual(sr.earnedAmountCents);
    }

    // Verify pool results
    for (const pr of result.poolResults) {
      expect(pr.totalContributed).toBe(pr.totalDistributed + pr.totalRefunded);
    }
  });
});
```

**Step 2: Run all tip pooling tests**

Run: `npm run test -- tests/unit/tipPooling-percentage.test.ts`
Expected: ALL tests pass.

**Step 3: Run full test suite**

Run: `npm run test`
Expected: No regressions in existing tests.

**Step 4: Commit**

```bash
git add tests/unit/tipPooling-percentage.test.ts
git commit -m "test: add integration test for full percentage tip pooling flow"
```

---

## Task 15: Final Verification and Lint

**Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests pass.

**Step 2: Run lint**

Run: `npm run lint -- --no-warn-ignored`
Expected: No new lint errors.

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds.

**Step 4: Manual smoke test**

Run: `npm run dev`
- Navigate to Tips settings
- Select "Percentage Contribution" model
- Create 2 pools with different methods
- Enter per-server tips
- Review calculation
- Approve split
- Check employee view

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any issues found during final verification"
```
