import { Employee } from '@/types/scheduling';

export type TipShare = {
  employeeId: string;
  name: string;
  hours?: number;
  role?: string;
  amountCents: number;
};

const toCents = (value: number): number => Math.round(value);

/**
 * Even split when the user chooses manual/no rules.
 * Remainder goes to the last participant to preserve the total.
 */
export function calculateTipSplitEven(
  totalTipsCents: number,
  participants: Array<{ id: string; name: string }>
): TipShare[] {
  if (totalTipsCents <= 0 || participants.length === 0) {
    return participants.map(p => ({ employeeId: p.id, name: p.name, amountCents: 0 }));
  }

  const evenShare = Math.floor(totalTipsCents / participants.length);
  const shares: TipShare[] = [];
  let allocated = 0;

  participants.forEach((p, idx) => {
    if (idx === participants.length - 1) {
      const remainder = totalTipsCents - allocated;
      shares.push({ employeeId: p.id, name: p.name, amountCents: remainder });
      allocated += remainder;
      return;
    }
    shares.push({ employeeId: p.id, name: p.name, amountCents: evenShare });
    allocated += evenShare;
  });

  return shares;
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

  // Fall back to even split if no one has hours logged
  // This prevents $0 allocations when tips exist but hours don't
  if (totalHours <= 0) {
    const evenShare = Math.floor(totalTipsCents / participants.length);
    let allocated = 0;
    return participants.map((p, idx) => {
      if (idx === participants.length - 1) {
        const remainder = totalTipsCents - allocated;
        return { employeeId: p.id, name: p.name, hours: p.hours, amountCents: remainder };
      }
      allocated += evenShare;
      return { employeeId: p.id, name: p.name, hours: p.hours, amountCents: evenShare };
    });
  }

  const shares: TipShare[] = [];
  let allocated = 0;

  participants.forEach((p, idx) => {
    if (idx === participants.length - 1) {
      const remainder = totalTipsCents - allocated;
      shares.push({ employeeId: p.id, name: p.name, hours: p.hours, amountCents: remainder });
      allocated += remainder;
      return;
    }

    const ratio = (p.hours || 0) / totalHours;
    const amount = toCents(totalTipsCents * ratio);
    allocated += amount;
    shares.push({ employeeId: p.id, name: p.name, hours: p.hours, amountCents: amount });
  });

  return shares;
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

  // Fall back to even split if no weights are defined
  // This prevents $0 allocations when tips exist but weights don't
  if (totalWeight <= 0) {
    const evenShare = Math.floor(totalTipsCents / participants.length);
    let allocated = 0;
    return participants.map((p, idx) => {
      if (idx === participants.length - 1) {
        const remainder = totalTipsCents - allocated;
        return { employeeId: p.id, name: p.name, role: p.role, amountCents: remainder };
      }
      allocated += evenShare;
      return { employeeId: p.id, name: p.name, role: p.role, amountCents: evenShare };
    });
  }

  const shares: TipShare[] = [];
  let allocated = 0;

  participants.forEach((p, idx) => {
    if (idx === participants.length - 1) {
      const remainder = totalTipsCents - allocated;
      shares.push({ employeeId: p.id, name: p.name, role: p.role, amountCents: remainder });
      allocated += remainder;
      return;
    }

    const ratio = (p.weight || 0) / totalWeight;
    const amount = toCents(totalTipsCents * ratio);
    allocated += amount;
    shares.push({ employeeId: p.id, name: p.name, role: p.role, amountCents: amount });
  });

  return shares;
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

  const adjusted: TipShare[] = [];
  let allocated = 0;
  others.forEach((a, idx) => {
    if (idx === others.length - 1) {
      const remainder = Math.max(0, remaining - allocated);
      adjusted.push({ ...a, amountCents: remainder });
      allocated += remainder;
      return;
    }
    const ratio = a.amountCents / currentOtherTotal;
    const amt = toCents(remaining * ratio);
    allocated += amt;
    adjusted.push({ ...a, amountCents: amt });
  });

  const remainder = remaining - allocated;
  if (adjusted.length > 0 && remainder !== 0) {
    adjusted[adjusted.length - 1].amountCents += remainder;
  }

  return [
    ...adjusted,
    {
      ...allocations.find(a => a.employeeId === changedEmployeeId)!,
      amountCents: clamped,
    },
  ];
}

// ── Percentage Contribution Types ─────────────────────────────────────────────

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

// ── Percentage Contribution Functions ────────────────────────────────────────

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
