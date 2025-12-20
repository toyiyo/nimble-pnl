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
 */
export function calculateTipSplitByHours(
  totalTipsCents: number,
  participants: Array<{ id: string; name: string; hours: number }>
): TipShare[] {
  const totalHours = participants.reduce((sum, p) => sum + (p.hours || 0), 0);
  if (totalTipsCents <= 0 || totalHours <= 0) {
    return participants.map(p => ({ employeeId: p.id, name: p.name, hours: p.hours, amountCents: 0 }));
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
 */
export function calculateTipSplitByRole(
  totalTipsCents: number,
  participants: Array<{ id: string; name: string; role: string; weight: number }>
): TipShare[] {
  const totalWeight = participants.reduce((sum, p) => sum + (p.weight || 0), 0);
  if (totalTipsCents <= 0 || totalWeight <= 0) {
    return participants.map(p => ({ employeeId: p.id, name: p.name, role: p.role, amountCents: 0 }));
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
