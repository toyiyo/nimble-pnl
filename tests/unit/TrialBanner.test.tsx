import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TrialBanner } from '@/components/subscription/TrialBanner';

const mockUseSubscription = vi.fn();
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

const base = {
  isTrialing: false,
  isTrialExpired: false,
  isGrandfathered: false,
  isPastDue: false,
  trialDaysRemaining: null,
  grandfatheredDaysRemaining: null,
};

const renderBanner = () =>
  render(
    <MemoryRouter>
      <TrialBanner />
    </MemoryRouter>,
  );

describe('TrialBanner', () => {
  beforeEach(() => mockUseSubscription.mockReset());

  it('shows the expired banner with a Choose Plan button', () => {
    mockUseSubscription.mockReturnValue({ ...base, isTrialExpired: true });
    renderBanner();
    expect(screen.getByText('Your trial ended — choose a plan')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose Plan' })).toBeTruthy();
  });

  it('says Growth trial while the trial runs', () => {
    mockUseSubscription.mockReturnValue({ ...base, isTrialing: true, trialDaysRemaining: 10 });
    renderBanner();
    expect(screen.getByText(/left in your Growth trial/)).toBeTruthy();
  });
});
