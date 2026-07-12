import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// This test locks in the Phase 4 task 3 wiring:
//   1. The "History" tab is renamed to "Distribution" (and the broken
//      "locked periods" copy is gone).
//   2. The `splits` binding bug is fixed: only Daily Entry uses
//      today-scoped `dailySplits`; Distribution (like Overview) uses the
//      period-scoped `periodSplits`.
//   3. `TipDistribution` receives combined loading/error state from BOTH
//      `useTipSplits` (period) and `useTipPayouts`.
// ---------------------------------------------------------------------------

// A day inside the current period but NOT today — this is what proves the
// splits binding bug fix: if Distribution were still wired to `dailySplits`
// (today-only), this split would never appear.
const PERIOD_ONLY_SPLIT_ID = 'period-only-split-not-today';
const DAILY_ONLY_SPLIT_ID = 'daily-only-split-today';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ loading: false }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'restaurant-1' },
  }),
}));

// Stable (module-level) empty arrays — Tips.tsx has an effect that recomputes
// hours from `punches`/`eligibleEmployees` and unconditionally calls
// setState (see memory/lessons.md 2026-xx "Effect 2" ref-instability note).
// Returning a fresh `[]` literal from a mock on every render would give that
// effect a new dependency reference every render and spin it into an
// infinite loop — so these must be single shared instances.
const EMPTY_EMPLOYEES: never[] = [];
const EMPTY_PUNCHES: never[] = [];

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: EMPTY_EMPLOYEES, loading: false }),
}));

vi.mock('@/hooks/useTimePunches', () => ({
  useTimePunches: () => ({ punches: EMPTY_PUNCHES, loading: false }),
}));

vi.mock('@/hooks/useTipPoolSettings', () => ({
  useTipPoolSettings: () => ({
    settings: null,
    updateSettings: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useTipContributionPools', () => ({
  useTipContributionPools: () => ({
    pools: [],
    createPool: vi.fn(),
    updatePool: vi.fn(),
    deletePool: vi.fn(),
    totalContributionPercentage: 0,
  }),
}));

// Track the isLoading/error the test wants each `useTipSplits` invocation to
// report — set per-test via the mutable objects below so we can assert the
// combined isLoading/isError props passed into TipDistribution.
const periodSplitsState = { isLoading: false, error: null as Error | null };

vi.mock('@/hooks/useTipSplits', () => ({
  useTipSplits: (_restaurantId: string | null, startDate?: string, endDate?: string) => {
    // Daily Entry mode calls useTipSplits(restaurantId, today, today) — same
    // start/end. Overview + Distribution call it with a period range.
    const isDailyCall = !!startDate && startDate === endDate;

    if (isDailyCall) {
      return {
        splits: [
          {
            id: DAILY_ONLY_SPLIT_ID,
            restaurant_id: 'restaurant-1',
            split_date: startDate,
            total_amount: 1000,
            status: 'archived',
            share_method: 'hours',
            tip_source: 'manual',
            notes: null,
            created_by: null,
            approved_by: null,
            approved_at: null,
            created_at: '2026-07-06T00:00:00Z',
            updated_at: '2026-07-06T00:00:00Z',
            items: [],
          },
        ],
        isLoading: false,
        error: null,
        saveTipSplit: vi.fn(),
        isSaving: false,
      };
    }

    // Period call (Overview + Distribution)
    return {
      splits: [
        {
          id: PERIOD_ONLY_SPLIT_ID,
          restaurant_id: 'restaurant-1',
          split_date: startDate,
          total_amount: 2000,
          status: 'archived',
          share_method: 'hours',
          tip_source: 'manual',
          notes: null,
          created_by: null,
          approved_by: null,
          approved_at: null,
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-01T00:00:00Z',
          items: [],
        },
      ],
      isLoading: periodSplitsState.isLoading,
      error: periodSplitsState.error,
      saveTipSplit: vi.fn(),
      isSaving: false,
    };
  },
}));

const payoutsState = { isLoading: false, error: null as Error | null };

vi.mock('@/hooks/useTipPayouts', () => ({
  useTipPayouts: () => ({
    payouts: [],
    createPayouts: vi.fn(),
    isCreating: false,
    deletePayout: vi.fn(),
    isLoading: payoutsState.isLoading,
    error: payoutsState.error,
  }),
}));

vi.mock('@/hooks/usePOSTips', () => ({
  usePOSTipsForDate: () => ({ tipData: null, hasTips: false }),
}));

vi.mock('@/hooks/useAutoSaveTipSettings', () => ({
  useAutoSaveTipSettings: () => undefined,
}));

vi.mock('@/hooks/useTipServerEarnings', () => ({
  useTipServerEarnings: () => ({ saveServerEarnings: vi.fn() }),
}));

vi.mock('@/components/tips/DisputeManager', () => ({
  DisputeManager: () => null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  },
}));

const tipDistributionSpy = vi.fn();
vi.mock('@/components/tips/TipDistribution', () => ({
  TipDistribution: (props: {
    splits: Array<{ id: string }> | undefined;
    isLoading: boolean;
    isError: boolean;
  }) => {
    tipDistributionSpy(props);
    return <div data-testid="tip-distribution-stub" />;
  },
}));

// Imported AFTER the mocks above so Tips.tsx picks up the mocked modules.
import { Tips } from '../../src/pages/Tips';

describe('Tips page — Distribution tab wiring', () => {
  beforeEach(() => {
    tipDistributionSpy.mockClear();
    periodSplitsState.isLoading = false;
    periodSplitsState.error = null;
    payoutsState.isLoading = false;
    payoutsState.error = null;
  });

  it('renders a "Distribution" tab, not "History", and no locked-periods copy anywhere', async () => {
    const user = userEvent.setup();
    render(<Tips />);

    expect(screen.getByRole('button', { name: 'Distribution' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Distribution' }));

    expect(screen.queryByText(/tip history/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/locked periods/i)).not.toBeInTheDocument();
  });

  it('passes period-scoped splits to TipDistribution, not the today-only daily splits (bug fix)', async () => {
    const user = userEvent.setup();
    render(<Tips />);

    await user.click(screen.getByRole('button', { name: 'Distribution' }));

    expect(tipDistributionSpy).toHaveBeenCalled();
    const props = tipDistributionSpy.mock.calls.at(-1)![0];
    const ids = (props.splits ?? []).map((s: { id: string }) => s.id);

    expect(ids).toContain(PERIOD_ONLY_SPLIT_ID);
    expect(ids).not.toContain(DAILY_ONLY_SPLIT_ID);
  });

  it('combines isLoading from periodSplits and payouts queries', async () => {
    const user = userEvent.setup();
    periodSplitsState.isLoading = false;
    payoutsState.isLoading = true;

    render(<Tips />);
    await user.click(screen.getByRole('button', { name: 'Distribution' }));

    const props = tipDistributionSpy.mock.calls.at(-1)![0];
    expect(props.isLoading).toBe(true);
  });

  it('combines isError from periodSplits and payouts queries', async () => {
    const user = userEvent.setup();
    periodSplitsState.error = new Error('boom');
    payoutsState.error = null;

    render(<Tips />);
    await user.click(screen.getByRole('button', { name: 'Distribution' }));

    const props = tipDistributionSpy.mock.calls.at(-1)![0];
    expect(props.isError).toBe(true);
  });
});
