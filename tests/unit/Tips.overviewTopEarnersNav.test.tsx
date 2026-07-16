import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Phase 4 task 3/3: the "View all earners in Distribution" affordance inside
// the Overview tab's TipPeriodSummary must switch Tips.tsx's viewMode to
// 'distribution' — i.e. `onViewDistribution={() => setViewMode('distribution')}`
// is actually passed down, not just accepted as an optional prop.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ loading: false }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'restaurant-1' },
  }),
}));

// Stable (module-level) empty arrays — see memory/lessons.md ref-instability note.
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

vi.mock('@/hooks/useTipSplits', () => ({
  useTipSplits: () => ({
    splits: [],
    isLoading: false,
    error: null,
    saveTipSplit: vi.fn(),
    isSaving: false,
  }),
}));

vi.mock('@/hooks/useTipPayouts', () => ({
  useTipPayouts: () => ({
    payouts: [],
    createPayouts: vi.fn(),
    isCreating: false,
    deletePayout: vi.fn(),
    isLoading: false,
    error: null,
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

// Stub TipDistribution so we can assert Distribution-view is what mounts
// after clicking "View all" from Overview, without depending on its internals.
vi.mock('@/components/tips/TipDistribution', () => ({
  TipDistribution: () => <div data-testid="tip-distribution-stub" />,
}));

// Imported AFTER the mocks above so Tips.tsx picks up the mocked modules.
import { Tips } from '../../src/pages/Tips';

describe('Tips page — Overview top-earners "View all" navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches to the Distribution view when "View all earners in Distribution" is clicked from Overview', async () => {
    const user = userEvent.setup();
    render(<Tips />);

    // Overview is the default view — Distribution stub is not mounted yet.
    expect(screen.queryByTestId('tip-distribution-stub')).not.toBeInTheDocument();

    const viewAllButton = screen.getByRole('button', { name: 'View all earners in Distribution' });
    await user.click(viewAllButton);

    expect(screen.getByTestId('tip-distribution-stub')).toBeInTheDocument();
  });
});
