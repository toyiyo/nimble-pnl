import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentSetupSheet } from '@/components/invoicing/PaymentSetupSheet';
import type { PaymentSetup } from '@/hooks/usePaymentSetup';

vi.mock('@/components/StripeEmbeddedConnect', () => ({
  StripeEmbeddedConnect: ({ restaurantId }: { restaurantId: string | null }) => (
    <div data-testid="stripe-embedded" data-restaurant-id={restaurantId ?? ''} />
  ),
}));

const makeSetup = (closeSetup: () => void, isSheetOpen = true) =>
  ({ isSheetOpen, closeSetup }) as unknown as PaymentSetup;

describe('PaymentSetupSheet', () => {
  it('renders the Stripe component when open', () => {
    render(<PaymentSetupSheet setup={makeSetup(vi.fn())} restaurantId="rest-1" />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('stripe-embedded')).toHaveAttribute('data-restaurant-id', 'rest-1');
  });

  it('renders nothing when closed', () => {
    render(<PaymentSetupSheet setup={makeSetup(vi.fn(), false)} restaurantId="rest-1" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('stripe-embedded')).toBeNull();
  });

  it('calls closeSetup one time when the user presses Escape', () => {
    const closeSetup = vi.fn();
    render(<PaymentSetupSheet setup={makeSetup(closeSetup)} restaurantId="rest-1" />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(closeSetup).toHaveBeenCalledTimes(1);
  });

  it('calls closeSetup one time when the user clicks the close button', () => {
    const closeSetup = vi.fn();
    render(<PaymentSetupSheet setup={makeSetup(closeSetup)} restaurantId="rest-1" />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(closeSetup).toHaveBeenCalledTimes(1);
  });
});
