import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const ctx = vi.hoisted(() => ({ selectedRestaurant: { restaurant_id: 'r1' } as unknown }));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ctx,
}));

import { PaymentSetupCard } from '@/components/invoicing/PaymentSetupCard';

const makeSetup = (over: Record<string, unknown> = {}) =>
  ({
    state: 'not_started',
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isSheetOpen: false,
    openSetup: vi.fn(),
    closeSetup: vi.fn(),
    checkStatus: vi.fn(),
    isChecking: false,
    isStarting: false,
    ...over,
  }) as never;

const renderCard = (setup: never, canManage = true, hideWhenReady = false) =>
  render(
    <MemoryRouter>
      <PaymentSetupCard setup={setup} canManage={canManage} hideWhenReady={hideWhenReady} />
    </MemoryRouter>,
  );

describe('PaymentSetupCard', () => {
  it('shows not_started copy and calls openSetup for the owner', () => {
    const setup = makeSetup();
    renderCard(setup);
    expect(screen.getByText('Turn on payments', { selector: 'h3' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /turn on payments/i }));
    expect((setup as { openSetup: unknown }).openSetup).toHaveBeenCalled();
  });

  it('shows owner-only text for other roles', () => {
    renderCard(makeSetup(), false);
    expect(screen.getByText('Ask the restaurant owner to turn on payments.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows pending buttons for the owner', () => {
    const setup = makeSetup({ state: 'pending' });
    renderCard(setup);
    expect(screen.getByText('Finish payment setup')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /check now/i }));
    expect((setup as { checkStatus: unknown }).checkStatus).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /continue setup/i })).toBeTruthy();
  });

  it('shows ready state with a Manage link, and hides when asked', () => {
    const { unmount } = renderCard(makeSetup({ state: 'ready' }));
    expect(screen.getByText('Payments are on')).toBeTruthy();
    expect(screen.getByRole('link', { name: /manage/i }).getAttribute('href')).toBe('/stripe-account');
    unmount();
    const { container } = renderCard(makeSetup({ state: 'ready' }), true, true);
    expect(container.firstChild).toBeNull();
  });

  it('shows an error line with Retry', () => {
    const setup = makeSetup({ error: new Error('x') });
    renderCard(setup);
    expect(screen.getByText('Payment status is not available.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect((setup as { refetch: unknown }).refetch).toHaveBeenCalled();
  });

  it('disables the primary button while starting', () => {
    renderCard(makeSetup({ isStarting: true }));
    const btn = screen.getByRole('button', { name: /turn on payments/i });
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('shows nothing without a restaurant', () => {
    ctx.selectedRestaurant = null;
    const { container } = renderCard(makeSetup());
    expect(container.firstChild).toBeNull();
    ctx.selectedRestaurant = { restaurant_id: 'r1' };
  });
});
