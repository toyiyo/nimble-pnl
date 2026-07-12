import { describe, it, expect } from 'vitest';
import {
  aggregateTipDistribution,
  paymentStatus,
  type EmployeeDistribution,
} from '@/utils/tipDistribution';
import type { TipSplitWithItems } from '@/hooks/useTipSplits';
import type { TipPayout } from '@/hooks/useTipPayouts';

const employee1 = '11111111-1111-1111-1111-111111111111';
const employee2 = '22222222-2222-2222-2222-222222222222';
const employee3 = '33333333-3333-3333-3333-333333333333';

/** Minimal split builder — only the fields aggregateTipDistribution reads. */
function makeSplit(overrides: Partial<TipSplitWithItems>): TipSplitWithItems {
  return {
    id: 'split-1',
    restaurant_id: 'restaurant-1',
    split_date: '2026-07-06',
    total_amount: 0,
    status: 'approved',
    share_method: null,
    tip_source: null,
    notes: null,
    created_by: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    items: [],
    ...overrides,
  };
}

function makePayout(overrides: Partial<TipPayout>): TipPayout {
  return {
    id: 'payout-1',
    restaurant_id: 'restaurant-1',
    employee_id: employee1,
    payout_date: '2026-07-06',
    amount: 0,
    tip_split_id: null,
    notes: null,
    paid_by: null,
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    ...overrides,
  };
}

describe('aggregateTipDistribution', () => {
  it('returns a zeroed result for empty input', () => {
    const result = aggregateTipDistribution([], []);
    expect(result.employees).toEqual([]);
    expect(result.totalEarnedCents).toBe(0);
    expect(result.totalPaidCents).toBe(0);
    expect(result.totalUnpaidCents).toBe(0);
  });

  it('excludes draft splits, includes approved and archived', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        id: 'draft-split',
        status: 'draft',
        items: [
          {
            id: 'item-draft',
            tip_split_id: 'draft-split',
            employee_id: employee1,
            amount: 5000,
            hours_worked: 5,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
        ],
      }),
      makeSplit({
        id: 'approved-split',
        status: 'approved',
        items: [
          {
            id: 'item-approved',
            tip_split_id: 'approved-split',
            employee_id: employee1,
            amount: 8000,
            hours_worked: 6,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
        ],
      }),
      makeSplit({
        id: 'archived-split',
        status: 'archived',
        items: [
          {
            id: 'item-archived',
            tip_split_id: 'archived-split',
            employee_id: employee1,
            amount: 2000,
            hours_worked: 2,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
        ],
      }),
    ];

    const result = aggregateTipDistribution(splits, []);

    expect(result.employees).toHaveLength(1);
    // draft's 5000 must NOT be included; only approved (8000) + archived (2000)
    expect(result.employees[0].earnedCents).toBe(10000);
    expect(result.totalEarnedCents).toBe(10000);
  });

  it('sums amounts and hours per employee across multiple days/splits', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        id: 'split-day-1',
        split_date: '2026-07-06',
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-day-1',
            employee_id: employee1,
            amount: 4000,
            hours_worked: 4,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
          {
            id: 'item-2',
            tip_split_id: 'split-day-1',
            employee_id: employee2,
            amount: 3000,
            hours_worked: 3,
            role: 'Cook',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Alex Kim', position: 'Cook' },
          },
        ],
      }),
      makeSplit({
        id: 'split-day-2',
        split_date: '2026-07-07',
        items: [
          {
            id: 'item-3',
            tip_split_id: 'split-day-2',
            employee_id: employee1,
            amount: 5000,
            hours_worked: 5,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-07T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
        ],
      }),
    ];

    const result = aggregateTipDistribution(splits, []);

    const maria = result.employees.find((e) => e.employeeId === employee1);
    expect(maria).toBeDefined();
    expect(maria!.earnedCents).toBe(9000); // 4000 + 5000
    expect(maria!.hoursWorked).toBe(9); // 4 + 5

    const alex = result.employees.find((e) => e.employeeId === employee2);
    expect(alex).toBeDefined();
    expect(alex!.earnedCents).toBe(3000);
    expect(alex!.hoursWorked).toBe(3);

    expect(result.totalEarnedCents).toBe(12000);
  });

  it('computes paidCents from payouts and clamps unpaidCents at zero on overpayment', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 5000,
            hours_worked: 5,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
        ],
      }),
    ];
    // Overpayment: paid more than earned.
    const payouts: TipPayout[] = [
      makePayout({ employee_id: employee1, amount: 7000 }),
    ];

    const result = aggregateTipDistribution(splits, payouts);
    const maria = result.employees[0];
    expect(maria.earnedCents).toBe(5000);
    expect(maria.paidCents).toBe(7000);
    expect(maria.unpaidCents).toBe(0); // clamped, never negative
    expect(result.totalUnpaidCents).toBe(0);
  });

  it('sums multiple payouts for the same employee within the period', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 10000,
            hours_worked: 5,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
        ],
      }),
    ];
    const payouts: TipPayout[] = [
      makePayout({ employee_id: employee1, amount: 3000 }),
      makePayout({ employee_id: employee1, amount: 2000 }),
    ];

    const result = aggregateTipDistribution(splits, payouts);
    const maria = result.employees[0];
    expect(maria.paidCents).toBe(5000);
    expect(maria.unpaidCents).toBe(5000);
    expect(result.totalPaidCents).toBe(5000);
    expect(result.totalUnpaidCents).toBe(5000);
  });

  it('computes sharePct against the total, guarding divide-by-zero', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 7500,
            hours_worked: 5,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
          {
            id: 'item-2',
            tip_split_id: 'split-1',
            employee_id: employee2,
            amount: 2500,
            hours_worked: 3,
            role: 'Cook',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Alex Kim', position: 'Cook' },
          },
        ],
      }),
    ];

    const result = aggregateTipDistribution(splits, []);
    const maria = result.employees.find((e) => e.employeeId === employee1)!;
    const alex = result.employees.find((e) => e.employeeId === employee2)!;
    expect(maria.sharePct).toBeCloseTo(75, 5);
    expect(alex.sharePct).toBeCloseTo(25, 5);
    // Shares sum to ~100 (rounding tolerant).
    expect(maria.sharePct + alex.sharePct).toBeCloseTo(100, 5);
  });

  it('returns sharePct of 0 for all employees when total earned is zero', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 0,
            hours_worked: 2,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
        ],
      }),
    ];

    const result = aggregateTipDistribution(splits, []);
    expect(result.employees[0].sharePct).toBe(0);
  });

  it('sorts by earnedCents desc, tie-breaking by name asc', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 3000,
            hours_worked: 3,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Zed Adams', position: 'Server' },
          },
          {
            id: 'item-2',
            tip_split_id: 'split-1',
            employee_id: employee2,
            amount: 3000,
            hours_worked: 3,
            role: 'Cook',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Alex Kim', position: 'Cook' },
          },
          {
            id: 'item-3',
            tip_split_id: 'split-1',
            employee_id: employee3,
            amount: 9000,
            hours_worked: 6,
            role: 'Bartender',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Sam Lee', position: 'Bartender' },
          },
        ],
      }),
    ];

    const result = aggregateTipDistribution(splits, []);
    expect(result.employees.map((e) => e.name)).toEqual([
      'Sam Lee', // 9000, highest earner
      'Alex Kim', // tie at 3000, name asc
      'Zed Adams', // tie at 3000
    ]);
  });

  it('handles null hours_worked as zero', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 1000,
            hours_worked: null,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
        ],
      }),
    ];

    const result = aggregateTipDistribution(splits, []);
    expect(result.employees[0].hoursWorked).toBe(0);
  });

  it('falls back to "Unknown" name and null role when the employee join is missing', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 1000,
            hours_worked: 1,
            role: null,
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            // no `employee` field — join missing
          },
        ],
      }),
    ];

    const result = aggregateTipDistribution(splits, []);
    expect(result.employees[0].name).toBe('Unknown');
    expect(result.employees[0].role).toBeNull();
  });

  it('sets totalPaidCents/totalUnpaidCents as sums across all employees', () => {
    const splits: TipSplitWithItems[] = [
      makeSplit({
        items: [
          {
            id: 'item-1',
            tip_split_id: 'split-1',
            employee_id: employee1,
            amount: 10000,
            hours_worked: 5,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Maria Santos', position: 'Server' },
          },
          {
            id: 'item-2',
            tip_split_id: 'split-1',
            employee_id: employee2,
            amount: 5000,
            hours_worked: 3,
            role: 'Cook',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-06T00:00:00Z',
            employee: { name: 'Alex Kim', position: 'Cook' },
          },
        ],
      }),
    ];
    const payouts: TipPayout[] = [
      makePayout({ employee_id: employee1, amount: 10000 }), // fully paid
      makePayout({ employee_id: employee2, amount: 1000 }), // partially paid
    ];

    const result = aggregateTipDistribution(splits, payouts);
    expect(result.totalEarnedCents).toBe(15000);
    expect(result.totalPaidCents).toBe(11000);
    expect(result.totalUnpaidCents).toBe(4000); // (5000-1000) + (10000-10000)
  });
});

describe('paymentStatus', () => {
  function makeDistribution(
    overrides: Partial<EmployeeDistribution>,
  ): EmployeeDistribution {
    return {
      employeeId: employee1,
      name: 'Maria Santos',
      role: 'Server',
      hoursWorked: 5,
      earnedCents: 5000,
      paidCents: 0,
      unpaidCents: 5000,
      sharePct: 100,
      ...overrides,
    };
  }

  it('returns "paid" when earned > 0 and unpaid is 0', () => {
    const d = makeDistribution({ earnedCents: 5000, paidCents: 5000, unpaidCents: 0 });
    expect(paymentStatus(d)).toBe('paid');
  });

  it('returns "partial" when some paid but unpaid remains (e.g. $10 of $50)', () => {
    const d = makeDistribution({ earnedCents: 5000, paidCents: 1000, unpaidCents: 4000 });
    expect(paymentStatus(d)).toBe('partial');
  });

  it('returns "unpaid" when nothing paid but something earned', () => {
    const d = makeDistribution({ earnedCents: 5000, paidCents: 0, unpaidCents: 5000 });
    expect(paymentStatus(d)).toBe('unpaid');
  });

  it('returns "paid" for the zero-earned edge case (nothing owed, nothing unpaid)', () => {
    const d = makeDistribution({ earnedCents: 0, paidCents: 0, unpaidCents: 0 });
    expect(paymentStatus(d)).toBe('paid');
  });
});
