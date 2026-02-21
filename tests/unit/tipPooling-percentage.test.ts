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

// ── Helpers ──

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

// ── calculatePercentageContributions ──

describe('calculatePercentageContributions', () => {
  it('calculates correct contribution amounts for each server and pool', () => {
    const servers = [server('s1', 'Maria', 20000), server('s2', 'John', 15000)];
    const pools = [pool('p1', 'Dishwashers', 5, 'hours', ['d1'])];
    const result = calculatePercentageContributions(servers, pools);

    expect(result).toEqual([
      { serverId: 's1', poolId: 'p1', amountCents: 1000 },
      { serverId: 's2', poolId: 'p1', amountCents: 750 },
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

  it('rounds fractional cents with Math.round', () => {
    const servers = [server('s1', 'Maria', 333)];
    const pools = [pool('p1', 'Pool', 5, 'hours', ['d1'])];
    const result = calculatePercentageContributions(servers, pools);
    expect(result[0].amountCents).toBe(17);
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

// ── calculatePoolRefunds ──

describe('calculatePoolRefunds', () => {
  it('refunds proportionally when pool is empty', () => {
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

  it('handles rounding — total matches pool total', () => {
    const contributions = [
      { serverId: 's1', poolId: 'p1', amountCents: 333 },
      { serverId: 's2', poolId: 'p1', amountCents: 333 },
      { serverId: 's3', poolId: 'p1', amountCents: 333 },
    ];
    const refunds = calculatePoolRefunds('p1', contributions, 999);
    const totalRefunded = refunds.reduce((s, r) => s + r.refundCents, 0);
    expect(totalRefunded).toBe(999);
  });

  it('returns zero refund for zero-amount pool', () => {
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

// ── calculatePercentagePoolAllocations (end-to-end) ──

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
    const workers: PoolWorker[] = [worker('d1', 'Dishwasher A', 6)];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    const maria = result.serverResults.find(s => s.employeeId === 's1')!;
    expect(maria.earnedAmountCents).toBe(20000);
    expect(maria.retainedAmountCents).toBe(19000);
    expect(maria.refundedAmountCents).toBe(600);

    const john = result.serverResults.find(s => s.employeeId === 's2')!;
    expect(john.earnedAmountCents).toBe(15000);
    expect(john.retainedAmountCents).toBe(14250);
    expect(john.refundedAmountCents).toBe(450);

    const dishPool = result.poolResults.find(p => p.poolId === 'p1')!;
    expect(dishPool.totalContributed).toBe(1750);
    expect(dishPool.totalDistributed).toBe(1750);
    expect(dishPool.totalRefunded).toBe(0);

    const fohPool = result.poolResults.find(p => p.poolId === 'p2')!;
    expect(fohPool.totalContributed).toBe(1050);
    expect(fohPool.totalDistributed).toBe(0);
    expect(fohPool.totalRefunded).toBe(1050);

    const items = result.splitItems;
    const mariaItem = items.find(i => i.employeeId === 's1')!;
    expect(mariaItem.amountCents).toBe(19000);
    const johnItem = items.find(i => i.employeeId === 's2')!;
    expect(johnItem.amountCents).toBe(14250);
    const d1Item = items.find(i => i.employeeId === 'd1')!;
    expect(d1Item.amountCents).toBe(1750);

    const totalIn = 20000 + 15000;
    const totalOut = items.reduce((s, i) => s + i.amountCents, 0);
    expect(totalOut).toBe(totalIn);
  });

  it('all pools empty — servers keep everything', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const pools = [pool('p1', 'Dish', 5, 'hours', ['d1'])];
    const workers: PoolWorker[] = [];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    expect(result.serverResults[0].retainedAmountCents).toBe(10000);
    expect(result.serverResults[0].refundedAmountCents).toBe(500);
    expect(result.splitItems).toHaveLength(1);
    expect(result.splitItems[0].amountCents).toBe(10000);
  });

  it('server is also pool recipient — combined amount', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const pools = [pool('p1', 'FOH', 5, 'even', ['s1', 'f1'])];
    const workers: PoolWorker[] = [
      worker('s1', 'Maria', 8),
      worker('f1', 'Host', 8),
    ];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

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
    const d1 = result.splitItems.find(i => i.employeeId === 'd1')!;
    const d2 = result.splitItems.find(i => i.employeeId === 'd2')!;
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
    expect(k1.amountCents).toBe(750);
    expect(k2.amountCents).toBe(250);
  });

  it('rounding preserves total in = total out', () => {
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
    const workers: PoolWorker[] = [];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    const maria = result.serverResults.find(s => s.employeeId === 's1')!;
    expect(maria.refundedAmountCents).toBe(500);

    const newbie = result.serverResults.find(s => s.employeeId === 's2')!;
    expect(newbie.refundedAmountCents).toBe(0);
    expect(newbie.retainedAmountCents).toBe(0);
  });

  it('multiple pools, partial refunds', () => {
    const servers = [server('s1', 'Maria', 10000)];
    const pools = [
      pool('p1', 'Dish', 5, 'hours', ['d1']),
      pool('p2', 'FOH', 3, 'even', ['f1']),
    ];
    const workers: PoolWorker[] = [worker('d1', 'Dishwasher', 6)];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    const maria = result.serverResults[0];
    expect(maria.earnedAmountCents).toBe(10000);
    // retained = earned(10000) - dishContrib(500) - fohContrib(300) + fohRefund(300) = 9500
    expect(maria.retainedAmountCents).toBe(9500);
    expect(maria.refundedAmountCents).toBe(300);

    const totalOut = result.splitItems.reduce((s, i) => s + i.amountCents, 0);
    expect(totalOut).toBe(10000);
  });

  it('simulates complete percentage contribution workflow (integration)', () => {
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
    ];

    const result = calculatePercentagePoolAllocations(servers, pools, workers);

    const totalIn = 25000 + 15000 + 10000;
    const totalOut = result.splitItems.reduce((s, i) => s + i.amountCents, 0);
    expect(totalOut).toBe(totalIn);

    for (const sr of result.serverResults) {
      expect(sr.retainedAmountCents).toBeGreaterThanOrEqual(0);
      expect(sr.retainedAmountCents).toBeLessThanOrEqual(sr.earnedAmountCents);
    }

    for (const pr of result.poolResults) {
      expect(pr.totalContributed).toBe(pr.totalDistributed + pr.totalRefunded);
    }
  });
});
