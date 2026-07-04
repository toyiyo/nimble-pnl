// tests/unit/EmployeeTips.nullHours.test.tsx
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EmployeeTips from '@/pages/EmployeeTips';
import type { TipSplitWithItems } from '@/hooks/useTipSplits';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r1' },
  }),
}));

vi.mock('@/hooks/useCurrentEmployee', () => ({
  useCurrentEmployee: () => ({
    currentEmployee: { id: 'emp1', name: 'Test Employee' },
    loading: false,
  }),
}));

vi.mock('@/hooks/useTipPayouts', () => ({
  useTipPayouts: () => ({
    payouts: [],
  }),
}));

vi.mock('@/hooks/usePeriodNavigation', () => ({
  usePeriodNavigation: () => ({
    periodType: 'current_week',
    setPeriodType: vi.fn(),
    startDate: new Date('2026-06-29T00:00:00Z'),
    endDate: new Date('2026-07-05T00:00:00Z'),
    handlePreviousWeek: vi.fn(),
    handleNextWeek: vi.fn(),
    handleToday: vi.fn(),
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
    },
  },
}));

// Mutable holder so each test can configure the splits returned by the mock.
let mockSplits: TipSplitWithItems[] = [];

vi.mock('@/hooks/useTipSplits', () => ({
  useTipSplits: () => ({
    splits: mockSplits,
    isLoading: false,
  }),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSplit(overrides: Partial<TipSplitWithItems> = {}): TipSplitWithItems {
  return {
    id: 'split1',
    restaurant_id: 'r1',
    split_date: '2026-07-01',
    total_amount: 1500,
    status: 'approved',
    share_method: 'manual',
    tip_source: null,
    notes: null,
    created_by: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    items: [],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EmployeeTips />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function openHistoryTab() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'History' }));
}

describe('EmployeeTips - null hours_worked (BUG-002)', () => {
  beforeEach(() => {
    mockSplits = [];
  });

  it('Case A: renders History tab without throwing when hours_worked is null, and shows no hours text', async () => {
    mockSplits = [
      makeSplit({
        items: [
          {
            id: 'item1',
            tip_split_id: 'split1',
            employee_id: 'emp1',
            amount: 1500,
            hours_worked: null,
            role: 'Server',
            role_weight: null,
            manually_edited: true,
            created_at: '2026-07-01T00:00:00Z',
          },
        ],
      }),
    ];

    renderPage();
    await openHistoryTab();

    const historyCard = screen.getByText('Tip History').closest('.rounded-xl') as HTMLElement;
    expect(within(historyCard).queryByText(/hours/i)).not.toBeInTheDocument();
  });

  it('Case B: renders "5.3 hours" in History tab (and guarded Breakdown tab) when hours_worked is a real number', async () => {
    mockSplits = [
      makeSplit({
        items: [
          {
            id: 'item2',
            tip_split_id: 'split1',
            employee_id: 'emp1',
            amount: 1500,
            hours_worked: 5.25,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-01T00:00:00Z',
          },
        ],
      }),
    ];

    renderPage();

    // Breakdown tab (default) already guards with Boolean(tip.hours)
    expect(screen.getByText(/5\.3 hours/)).toBeInTheDocument();

    await openHistoryTab();
    expect(screen.getByText(/5\.3 hours/)).toBeInTheDocument();
  });

  it('Case C: aggregate reduce treats null hours_worked as 0 in the period summary', async () => {
    mockSplits = [
      makeSplit({
        items: [
          {
            id: 'item3',
            tip_split_id: 'split1',
            employee_id: 'emp1',
            amount: 1500,
            hours_worked: null,
            role: 'Server',
            role_weight: null,
            manually_edited: true,
            created_at: '2026-07-01T00:00:00Z',
          },
          {
            id: 'item4',
            tip_split_id: 'split1',
            employee_id: 'emp2',
            amount: 1500,
            hours_worked: 4,
            role: 'Server',
            role_weight: null,
            manually_edited: false,
            created_at: '2026-07-01T00:00:00Z',
          },
        ],
      }),
    ];

    renderPage();

    // Current employee (emp1) has null hours -> period summary "Hours worked" is 0.0
    expect(screen.getByText('Hours worked')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
  });
});
