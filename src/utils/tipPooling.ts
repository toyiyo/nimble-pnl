import type { Employee } from '@/types/scheduling';

export type TipShare = {
  employeeId: string;
  name: string;
  hours?: number;
  role?: string;
  amountCents: number;
};

/**
 * Distribute totalCents among items by ratio, assigning rounding remainder to last item.
 * Returns an array of allocated amounts in the same order as `ratios`.
 */
function distributeByRatio(totalCents: number, ratios: number[]): number[] {
  const totalRatio = ratios.reduce((sum, r) => sum + r, 0);
  const amounts: number[] = [];
  let allocated = 0;

  for (let i = 0; i < ratios.length; i++) {
    if (i === ratios.length - 1) {
      amounts.push(totalCents - allocated);
    } else {
      const amount = totalRatio > 0
        ? Math.round(totalCents * (ratios[i] / totalRatio))
        : Math.floor(totalCents / ratios.length);
      amounts.push(amount);
      allocated += amount;
    }
  }

  return amounts;
}

/**
 * Distribute totalCents evenly among `count` items using Math.floor.
 * Remainder goes to the last item.
 */
function distributeEvenly(totalCents: number, count: number): number[] {
  const share = Math.floor(totalCents / count);
  const amounts = new Array<number>(count).fill(share);
  amounts[count - 1] = totalCents - share * (count - 1);
  return amounts;
}

/**
 * Even split when the user chooses manual/no rules.
 * Uses Math.floor per-share; remainder goes to the last participant.
 */
export function calculateTipSplitEven(
  totalTipsCents: number,
  participants: Array<{ id: string; name: string }>
): TipShare[] {
  if (totalTipsCents <= 0 || participants.length === 0) {
    return participants.map(p => ({ employeeId: p.id, name: p.name, amountCents: 0 }));
  }

  const amounts = distributeEvenly(totalTipsCents, participants.length);

  return participants.map((p, i) => ({
    employeeId: p.id,
    name: p.name,
    amountCents: amounts[i],
  }));
}

/**
 * Calculate tip splits by hours worked.
 * Rounds each share to cents and assigns any rounding remainder to the last participant.
 * Falls back to even split if no hours are recorded (prevents $0 allocations).
 */
export function calculateTipSplitByHours(
  totalTipsCents: number,
  participants: Array<{ id: string; name: string; hours: number }>
): TipShare[] {
  if (totalTipsCents <= 0 || participants.length === 0) {
    return participants.map(p => ({ employeeId: p.id, name: p.name, hours: p.hours, amountCents: 0 }));
  }

  const totalHours = participants.reduce((sum, p) => sum + (p.hours || 0), 0);
  // Fall back to even split if no hours are logged (prevents $0 allocations)
  const amounts = totalHours > 0
    ? distributeByRatio(totalTipsCents, participants.map(p => p.hours || 0))
    : distributeEvenly(totalTipsCents, participants.length);

  return participants.map((p, i) => ({
    employeeId: p.id,
    name: p.name,
    hours: p.hours,
    amountCents: amounts[i],
  }));
}

/**
 * Calculate tip splits by role weights.
 * Weight is attached to position; remainder goes to last participant.
 * Falls back to even split if no weights are defined (prevents $0 allocations).
 */
export function calculateTipSplitByRole(
  totalTipsCents: number,
  participants: Array<{ id: string; name: string; role: string; weight: number }>
): TipShare[] {
  if (totalTipsCents <= 0 || participants.length === 0) {
    return participants.map(p => ({ employeeId: p.id, name: p.name, role: p.role, amountCents: 0 }));
  }

  const totalWeight = participants.reduce((sum, p) => sum + (p.weight || 0), 0);
  // Fall back to even split if no weights are defined (prevents $0 allocations)
  const amounts = totalWeight > 0
    ? distributeByRatio(totalTipsCents, participants.map(p => p.weight || 0))
    : distributeEvenly(totalTipsCents, participants.length);

  return participants.map((p, i) => ({
    employeeId: p.id,
    name: p.name,
    role: p.role,
    amountCents: amounts[i],
  }));
}

/**
 * Rebalance allocations after manually overriding one share.
 * Keeps total constant and distributes the delta proportionally to others.
 */
export function rebalanceAllocations(
  totalTipsCents: number,
  allocations: TipShare[],
  changedEmployeeId: string,
  newAmountCents: number
): TipShare[] {
  const clamped = Math.max(0, Math.min(newAmountCents, totalTipsCents));
  const others = allocations.filter(a => a.employeeId !== changedEmployeeId);
  const remaining = totalTipsCents - clamped;
  const currentOtherTotal = others.reduce((sum, a) => sum + a.amountCents, 0) || 1;

  const ratios = others.map(a => a.amountCents / currentOtherTotal);
  const amounts = others.length > 0
    ? distributeByRatio(remaining, ratios)
    : [];

  const adjusted = others.map((a, i) => ({
    ...a,
    amountCents: Math.max(0, amounts[i]),
  }));

  return [
    ...adjusted,
    {
      ...allocations.find(a => a.employeeId === changedEmployeeId)!,
      amountCents: clamped,
    },
  ];
}

export type ServerEarning = {
  employeeId: string;
  name: string;
  earnedAmountCents: number;
};

export type ContributionPool = {
  id: string;
  name: string;
  contributionPercentage: number;
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

/**
 * Calculate how much each server contributes to each pool.
 * Returns one Contribution per (server, pool) pair.
 */
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

/**
 * Calculate proportional refunds when a pool is empty (no eligible workers).
 * Each server gets back proportional to what they contributed.
 * Remainder assigned to last server to preserve total.
 */
export function calculatePoolRefunds(
  poolId: string,
  contributions: Contribution[],
  poolTotal: number,
): Refund[] {
  const poolContributions = contributions.filter(c => c.poolId === poolId);

  if (poolTotal <= 0) {
    return poolContributions.map(c => ({ serverId: c.serverId, poolId, refundCents: 0 }));
  }

  const ratios = poolContributions.map(c => c.amountCents);
  const amounts = distributeByRatio(poolTotal, ratios);

  return poolContributions.map((c, i) => ({
    serverId: c.serverId,
    poolId,
    refundCents: amounts[i],
  }));
}

/**
 * Distribute a pool's total among active workers using the pool's configured share method.
 */
function distributePoolShares(
  poolTotal: number,
  pool: ContributionPool,
  activeWorkers: PoolWorker[],
): TipShare[] {
  switch (pool.shareMethod) {
    case 'hours':
      return calculateTipSplitByHours(
        poolTotal,
        activeWorkers.map(w => ({ id: w.employeeId, name: w.name, hours: w.hoursWorked })),
      );
    case 'role':
      return calculateTipSplitByRole(
        poolTotal,
        activeWorkers.map(w => ({
          id: w.employeeId,
          name: w.name,
          role: w.role,
          weight: pool.roleWeights[w.role] ?? 0,
        })),
      );
    default:
      return calculateTipSplitEven(
        poolTotal,
        activeWorkers.map(w => ({ id: w.employeeId, name: w.name })),
      );
  }
}

/**
 * End-to-end percentage pool allocation.
 * 1. Calculate contributions (server × pool)
 * 2. For each pool, check if any eligible employees worked
 * 3. Active pools: distribute using existing split functions
 * 4. Empty pools: refund proportionally to servers
 * 5. Build combined split items (server retained + pool distributions)
 */
export function calculatePercentagePoolAllocations(
  servers: ServerEarning[],
  pools: ContributionPool[],
  workers: PoolWorker[],
): PercentageAllocationResult {
  const contributions = calculatePercentageContributions(servers, pools);
  const poolResults: PoolResult[] = [];
  const allRefunds: Refund[] = [];

  for (const p of pools) {
    const poolContribs = contributions.filter(c => c.poolId === p.id);
    const poolTotal = poolContribs.reduce((s, c) => s + c.amountCents, 0);
    const activeWorkers = workers.filter(w => p.eligibleEmployeeIds.includes(w.employeeId));

    if (activeWorkers.length === 0) {
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
      const shares = distributePoolShares(poolTotal, p, activeWorkers);
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

  // Build server results
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

  // Build combined split items (server retained + pool distributions)
  const itemMap = new Map<string, TipShare>();

  for (const sr of serverResults) {
    itemMap.set(sr.employeeId, {
      employeeId: sr.employeeId,
      name: sr.name,
      amountCents: sr.retainedAmountCents,
    });
  }

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

  const splitItems = Array.from(itemMap.values()).filter(
    item => item.amountCents > 0 || servers.some(s => s.employeeId === item.employeeId),
  );

  return { serverResults, poolResults, splitItems };
}

export function formatCurrencyFromCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function filterTipEligible(employees: Employee[]): Employee[] {
  return employees.filter(
    e =>
      e.status === 'active' &&
      e.compensation_type !== 'salary' &&
      (e.tip_eligible ?? true)
  );
}
