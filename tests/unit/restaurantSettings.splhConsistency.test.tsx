import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Stub heavy deps before importing the component under test ---
// Follows the provider/mocking pattern from tests/unit/StaffingOverlay.wiring.test.tsx.

// supabase client — RestaurantSettings fetches `overtime_rules` directly in a
// useEffect on mount; a chainable no-op mock keeps that from throwing/hanging.
vi.mock('@/integrations/supabase/client', () => {
  type EmptyResult = { data: null; error: null };
  interface QueryChain extends PromiseLike<EmptyResult> {
    select: () => QueryChain;
    eq: () => QueryChain;
    order: () => QueryChain;
    maybeSingle: () => Promise<EmptyResult>;
    single: () => Promise<EmptyResult>;
    upsert: () => Promise<EmptyResult>;
  }
  const empty = (): Promise<EmptyResult> => Promise.resolve({ data: null, error: null });
  function makeChain(): QueryChain {
    return {
      select: makeChain,
      eq: makeChain,
      order: makeChain,
      maybeSingle: empty,
      single: empty,
      upsert: empty,
      then: (resolve, reject) => empty().then(resolve, reject),
    };
  }
  return {
    supabase: {
      from: () => makeChain(),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'manager@example.com' } }),
}));

// role: 'manager' (not 'owner') keeps canEdit true while isOwner stays false —
// isOwner also gates <TrialBanner> and the 'subscription' tab, which pull in
// useSubscription() and its own Supabase reads we don't need for this test.
const mockUserRestaurant = {
  id: 'ur-1',
  user_id: 'user-1',
  restaurant_id: 'r1',
  role: 'manager',
  created_at: '2026-01-01T00:00:00Z',
  restaurant: {
    id: 'r1',
    name: 'Test Restaurant',
    timezone: 'America/Chicago',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
};

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: mockUserRestaurant,
    restaurants: [mockUserRestaurant],
    setSelectedRestaurant: vi.fn(),
    loading: false,
    createRestaurant: vi.fn(),
    canCreateRestaurant: false,
  }),
}));

vi.mock('@/hooks/useRestaurants', () => ({
  useRestaurants: () => ({
    updateRestaurant: vi.fn(),
    restaurants: [mockUserRestaurant],
    loading: false,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// useStaffingSettings — fixed effective settings: target_splh: 30, target_labor_pct: 25.
vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: () => ({
    effectiveSettings: {
      target_splh: 30,
      avg_ticket_size: 8,
      target_labor_pct: 25,
      min_staff: 1,
      lookback_weeks: 4,
      manual_projections: null,
      min_crew: null,
      open_shifts_enabled: false,
      require_shift_claim_approval: false,
    },
    updateSettings: vi.fn(),
    isSaving: false,
    isLoading: false,
  }),
}));

// useEmployees — two active hourly employees at $10/hr (1000 cents) by default,
// overridable per test via mockEmployeesReturn.
const HOURLY_EMPLOYEES = [
  {
    id: 'e1',
    restaurant_id: 'r1',
    name: 'Alex',
    position: 'Server',
    status: 'active',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'e2',
    restaurant_id: 'r1',
    name: 'Sam',
    position: 'Cook',
    status: 'active',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

let mockEmployeesReturn: unknown[] = HOURLY_EMPLOYEES;
vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ employees: mockEmployeesReturn, loading: false, error: null }),
}));

import RestaurantSettings from '@/pages/RestaurantSettings';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={['/settings?tab=labor-planning']}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
};

const renderLaborPlanningTab = (overrides: { employees?: unknown[] } = {}) => {
  mockEmployeesReturn = overrides.employees ?? HOURLY_EMPLOYEES;
  return render(<RestaurantSettings />, { wrapper });
};

describe('<RestaurantSettings> Labor Planning tab — SPLH consistency hint', () => {
  beforeEach(() => {
    mockEmployeesReturn = HOURLY_EMPLOYEES;
  });

  it('should warn under both the SPLH and the labor % fields', async () => {
    renderLaborPlanningTab();
    const warnings = await screen.findAllByText(/33% labor at your current average wage/);
    expect(warnings).toHaveLength(2);
    warnings.forEach((w) => {
      expect(w).toHaveClass('text-warning');
      expect(w).toHaveTextContent('Try $40 to hit it.');
    });
  });

  it('should hide the hint when the roster has no hourly employees', async () => {
    renderLaborPlanningTab({ employees: [] });
    expect(await screen.findByLabelText(/Target SPLH/i)).toBeInTheDocument();
    expect(screen.queryByText(/labor at your current average wage/)).not.toBeInTheDocument();
  });

  it('should hide the hint when the SPLH field is cleared', async () => {
    renderLaborPlanningTab();
    await screen.findAllByText(/33% labor at your current average wage/);
    await userEvent.clear(screen.getByLabelText(/Target SPLH/i));
    expect(screen.queryByText(/labor at your current average wage/)).not.toBeInTheDocument();
  });
});
