import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Phase 7a finding (codex adversarial review): the Expenses page header
// rendered an unconditional "Print Checks" button that navigates to
// `/print-checks`, unlike the render-site gate applied to PrintCheckButton
// inside PendingOutflowCard (design §3.4, Task 4). A role with `books@view`
// can open `/expenses` but is excluded from `/print-checks` (`books@manage`),
// so the button sent such users into a protected route they cannot open.
// Same fix, same capability, applied at this second render site:
// `isResolved && hasCapability('edit:pending_outflows')`.
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

vi.mock('@/hooks/usePendingOutflows', () => ({
  usePendingOutflows: () => ({ data: [] }),
}));

vi.mock('@/hooks/useStripeFinancialConnections', () => ({
  useStripeFinancialConnections: () => ({
    connectedBanks: [],
    loading: false,
    totalBalance: 0,
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

describe('Expenses page – /print-checks header button capability gate', () => {
  beforeEach(() => {
    hasCapabilityMock.mockReset();
    isResolvedMock = true;
  });

  it('hides the "Print Checks" header button without edit:pending_outflows', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockImplementation((cap: string) => cap !== 'edit:pending_outflows');

    render(<Expenses />);

    expect(screen.queryByRole('button', { name: /print checks/i })).not.toBeInTheDocument();
  });

  it('hides the "Print Checks" header button while capabilities are still resolving', () => {
    isResolvedMock = false;
    hasCapabilityMock.mockImplementation(() => true);

    render(<Expenses />);

    expect(screen.queryByRole('button', { name: /print checks/i })).not.toBeInTheDocument();
  });

  it('shows the "Print Checks" header button with edit:pending_outflows', () => {
    isResolvedMock = true;
    hasCapabilityMock.mockImplementation((cap: string) => cap === 'edit:pending_outflows');

    render(<Expenses />);

    expect(screen.getByRole('button', { name: /print checks/i })).toBeInTheDocument();
  });
});
