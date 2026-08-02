import type { Employee } from '@/types/scheduling';

export type RoleAllocationMode = 'at_least' | 'exactly';

/** A per-role allocation rule. Evaluated per person, not per role. */
export type RoleAllocationRule = {
  mode: RoleAllocationMode;
  /** 0-100. Enforced by tip_pool_settings_role_percentages_check in the database. */
  percentage: number;
};

/**
 * Whether a rule actually changes an employee's share.
 *
 * `at_least 0%` is a floor nobody can fall below, so it is indistinguishable
 * from "by hours" and is treated as no rule at all. `exactly 0%` is a real
 * instruction — pay this person nothing out of the pool — so it survives.
 *
 * The allocator and every badge that advertises a rule must agree on this
 * predicate, or the UI promises a guarantee the split does not honour.
 */
export function isRuleActive(rule: RoleAllocationRule | undefined | null): rule is RoleAllocationRule {
  return !!rule && (rule.mode === 'exactly' || rule.percentage > 0);
}

/**
 * User-facing badge label for a rule, e.g. "Guaranteed 10%" / "Fixed 15%".
 * Shared between the hours-entry grid and the review screen's allocation
 * table so the two never drift in wording.
 */
export function formatAppliedRuleLabel(rule: RoleAllocationRule): string {
  return rule.mode === 'at_least'
    ? `Guaranteed ${rule.percentage}%`
    : `Fixed ${rule.percentage}%`;
}

export type TipShare = {
  employeeId: string;
  name: string;
  hours?: number;
  role?: string;
  amountCents: number;
  /** The rule in force for this employee, when one applied. */
  appliedRule?: RoleAllocationRule;
  /** True when an `at_least` floor raised this share above its base-method value. */
  lifted?: boolean;
};

/**
 * Distribute totalCents among items by ratio using the largest-remainder method.
 * Returns an array of allocated amounts in the same order as `ratios`.
 *
 * Every share is floored and the leftover cents go to the largest fractional
 * parts, so the amounts always sum to `totalCents` and none can overshoot. The
 * earlier "round each, give the remainder to the last item" approach could hand
 * the last item a *negative* share whenever rounding overshot — 2 cents across
 * four equal ratios produced `[1, 1, 1, -1]`.
 */
function distributeByRatio(totalCents: number, ratios: number[]): number[] {
  const count = ratios.length;
  if (count === 0) return [];

  const totalRatio = ratios.reduce((sum, r) => sum + r, 0);
  // No ratios at all (everyone at zero hours/weight) splits the pool evenly.
  const weights = totalRatio > 0 ? ratios : ratios.map(() => 1);
  const weightTotal = totalRatio > 0 ? totalRatio : count;

  const exact = weights.map(w => (totalCents * w) / weightTotal);
  const amounts = exact.map(Math.floor);
  let remainder = totalCents - amounts.reduce((sum, a) => sum + a, 0);

  // Ties break toward the *last* item, preserving the long-standing "the last
  // person absorbs the rounding remainder" behaviour for the common case of
  // equal shares — this only changes who gets the odd cent when the fractions
  // genuinely differ, and it can no longer take a share below zero.
  const byLargestFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || b.index - a.index);

  for (let k = 0; remainder > 0; k++, remainder--) {
    amounts[byLargestFraction[k % count].index] += 1;
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

export type GuaranteedParticipant = {
  id: string;
  name: string;
  hours?: number;
  role?: string;
  rule?: RoleAllocationRule;
};

export type GuaranteedSplitResult = {
  shares: TipShare[];
  /** Set when guarantees exceeded the pool and every rule was scaled down. */
  scaledDownFactor: number | null;
  /** Cents redistributed because only `exactly` participants worked. */
  redistributedLeftoverCents: number;
};

const amountsById = (shares: TipShare[]): Map<string, number> =>
  new Map(shares.map(s => [s.employeeId, s.amountCents]));

/**
 * Overlay per-role guarantees on top of any base share method.
 *
 * `exactly` participants are reserved off the top. Everyone else is water-filled
 * through `distributeRemainder`: anyone landing below their `at_least` floor is
 * locked at the floor and the pass repeats, so a floor only ever raises someone
 * and never caps them. Shares come back in the input order and always sum to
 * `totalTipsCents` exactly.
 */
export function calculateTipSplitWithGuarantees(
  totalTipsCents: number,
  participants: GuaranteedParticipant[],
  distributeRemainder: (poolCents: number, subset: GuaranteedParticipant[]) => TipShare[],
): GuaranteedSplitResult {
  if (participants.length === 0) {
    return { shares: [], scaledDownFactor: null, redistributedLeftoverCents: 0 };
  }

  const ruleOf = (p: GuaranteedParticipant): RoleAllocationRule | undefined =>
    isRuleActive(p.rule) ? p.rule : undefined;

  const toShare = (p: GuaranteedParticipant, amountCents: number): TipShare => {
    const share: TipShare = { employeeId: p.id, name: p.name, amountCents };
    if (p.hours !== undefined) share.hours = p.hours;
    if (p.role !== undefined) share.role = p.role;
    const rule = ruleOf(p);
    if (rule) share.appliedRule = rule;
    return share;
  };

  if (totalTipsCents <= 0) {
    return {
      shares: participants.map(p => toShare(p, 0)),
      scaledDownFactor: null,
      redistributedLeftoverCents: 0,
    };
  }

  // 1. Convert rules to cents.
  const guarantees = new Map<string, number>();
  let guaranteedTotal = 0;
  for (const p of participants) {
    const rule = ruleOf(p);
    if (!rule) continue;
    const cents = Math.round(totalTipsCents * (rule.percentage / 100));
    guarantees.set(p.id, cents);
    guaranteedTotal += cents;
  }

  if (guarantees.size === 0) {
    const amounts = amountsById(distributeRemainder(totalTipsCents, participants));
    return {
      shares: participants.map(p => toShare(p, amounts.get(p.id) ?? 0)),
      scaledDownFactor: null,
      redistributedLeftoverCents: 0,
    };
  }

  // 2. Feasibility — guarantees are per person, so several people in one role
  //    can overshoot even when each individual percentage is legal.
  let scaledDownFactor: number | null = null;
  if (guaranteedTotal > totalTipsCents) {
    scaledDownFactor = totalTipsCents / guaranteedTotal;
    for (const [id, cents] of guarantees) {
      guarantees.set(id, Math.floor(cents * scaledDownFactor));
    }
  }

  // 3. Reserve the `exactly` participants off the top.
  const locked = new Map<string, number>();
  let pool = totalTipsCents;
  for (const p of participants) {
    if (ruleOf(p)?.mode === 'exactly') {
      const cents = guarantees.get(p.id) ?? 0;
      locked.set(p.id, cents);
      pool -= cents;
    }
  }
  if (pool < 0) pool = 0;

  // 4. Water-fill: run the base method, lock anyone below their floor, repeat.
  const lifted = new Set<string>();
  let candidates = participants.filter(p => !locked.has(p.id));
  while (candidates.length > 0) {
    const amounts = amountsById(distributeRemainder(pool, candidates));
    const belowFloor = candidates.filter(p => {
      if (ruleOf(p)?.mode !== 'at_least') return false;
      return (amounts.get(p.id) ?? 0) < (guarantees.get(p.id) ?? 0);
    });

    if (belowFloor.length === 0) {
      for (const p of candidates) locked.set(p.id, amounts.get(p.id) ?? 0);
      break;
    }

    for (const p of belowFloor) {
      const floor = guarantees.get(p.id) ?? 0;
      locked.set(p.id, floor);
      lifted.add(p.id);
      pool -= floor;
    }
    if (pool < 0) pool = 0;
    candidates = candidates.filter(p => !locked.has(p.id));
  }

  // 5. Leftover — only reachable when every participant is locked, i.e. every
  //    rule is `exactly` and they total under 100%. Split it in proportion to
  //    the configured percentages.
  let redistributedLeftoverCents = 0;
  const allocated = participants.reduce((sum, p) => sum + (locked.get(p.id) ?? 0), 0);
  const leftover = totalTipsCents - allocated;
  if (leftover > 0) {
    // Don't report a leftover that is only the rounding dust from scaling down —
    // the scale-down advisory already explains that case, and "no hourly staff
    // worked" would be wrong.
    redistributedLeftoverCents = scaledDownFactor === null ? leftover : 0;
    const extra = distributeByRatio(
      leftover,
      participants.map(p => ruleOf(p)?.percentage ?? 0),
    );
    participants.forEach((p, i) => {
      locked.set(p.id, (locked.get(p.id) ?? 0) + extra[i]);
    });
  }

  // 6. Reconcile so the shares sum to the pool exactly — Approve is gated on it.
  const shares = participants.map(p => toShare(p, locked.get(p.id) ?? 0));
  const residual = totalTipsCents - shares.reduce((sum, s) => sum + s.amountCents, 0);
  if (residual !== 0) {
    // Prefer a rule-free participant for the residual cent so an `at_least` floor is
    // only ever touched as a last resort — matching the "a floor only ever raises
    // someone and never caps them" guarantee. `exactly` participants are excluded
    // entirely (via `all` as the final fallback) since their share is a fixed
    // promise, not a base-method result the residual is meant to nudge.
    const free: number[] = [];
    const atLeastOnly: number[] = [];
    const all: number[] = [];
    participants.forEach((p, i) => {
      all.push(i);
      const mode = ruleOf(p)?.mode;
      if (!mode) free.push(i);
      else if (mode === 'at_least') atLeastOnly.push(i);
    });
    // Walk the candidates in priority order, giving each as much of the residual
    // as it can absorb without going negative. A positive residual is always
    // taken whole by the first candidate; a negative one only spills onward when
    // the preferred candidate cannot cover it. Spilling — rather than clamping
    // at zero — is what keeps `sum(shares) === totalTipsCents` true, and Approve
    // is gated on exactly that.
    const order = [...free, ...atLeastOnly, ...all].filter((v, i, a) => a.indexOf(v) === i);
    let unassigned = residual;
    for (const i of order) {
      if (unassigned === 0) break;
      const delta = unassigned > 0 ? unassigned : Math.max(unassigned, -shares[i].amountCents);
      shares[i].amountCents += delta;
      unassigned -= delta;
    }
  }

  for (const share of shares) {
    if (lifted.has(share.employeeId)) share.lifted = true;
  }

  return { shares, scaledDownFactor, redistributedLeftoverCents };
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
