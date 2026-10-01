import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The Expenses page cards split open outflows by the 60-day rule
// (design §3.4, §4.2): the Uncommitted Expenses card and the Book Balance
// card use only the in-window amount, and a note line shows the older
// amount when it is not zero. Mock pattern copied from
// `tests/unit/expensesPrintChecksHeaderGate.test.tsx:13-72`.
const hasCapabilityMock = vi.fn();
let isResolvedMock = true;
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasCapability: hasCapabilityMock,
    isResolved: isResolvedMock,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({ selectedRestaurant: { id: 'r1', restaurant_id: 'r1' } }),
}));

let pendingOutflowsRows: Array<{ amount: number; status: string; issue_date: string }> = [];
vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflows: () => ({ data: pendingOutflowsRows }),
}));

let totalBalanceMock = 0;
vi.mock('@/hooks/useStripeFinancialConnections', () => ({
  useStripeFinancialConnections: () => ({
    connectedBanks: [],
    loading: false,
    totalBalance: totalBalanceMock,
    createFinancialConnectionsSession: vi.fn(),
    verifyConnectionSession: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/components/pending-outflows/PendingOutflowsList', () => ({
  PendingOutflowsList: () => <div data-testid="pending-outflows-list" />,
}));
vi.mock('@/components/pending-outflows/AddExpenseSheet', () => ({
  AddExpenseSheet: () => null,
}));
vi.mock('@/components/pending-outflows/EditExpenseSheet', () => ({
  EditExpenseSheet: () => null,
}));
vi.mock('@/components/banking/BankReauthBanner', () => ({
  BankReauthBanner: () => null,
  toReauthBannerBanks: () => [],
}));
vi.mock('@/components/MetricIcon', () => ({
  MetricIcon: () => <div />,
}));
vi.mock('@/components/subscription', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Expenses from '@/pages/Expenses';

describe('Expenses page – book balance 60-day rule', () => {
  beforeEach(() => {
    hasCapabilityMock.mockReset();
    hasCapabilityMock.mockImplementation(() => true);
    isResolvedMock = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('splits the cards by the 60-day window and shows the older note', () => {
    totalBalanceMock = 10000;
    pendingOutflowsRows = [
      { amount: 500, status: 'pending', issue_date: '2026-09-20' },
      { amount: 2000, status: 'stale_90', issue_date: '2026-05-01' },
      { amount: 300, status: 'cleared', issue_date: '2026-09-25' },
    ];

    render(<Expenses />);

    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('$9,500.00')).toBeInTheDocument();
    expect(
      screen.getByText('+$2,000.00 older than 60 days, not counted'),
    ).toBeInTheDocument();
  });

  it('shows no note when no row is older than 60 days', () => {
    totalBalanceMock = 10000;
    pendingOutflowsRows = [
      { amount: 500, status: 'pending', issue_date: '2026-09-20' },
    ];

    render(<Expenses />);

    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('$9,500.00')).toBeInTheDocument();
    expect(
      screen.queryByText(/older than 60 days, not counted/i),
    ).not.toBeInTheDocument();
  });
});
