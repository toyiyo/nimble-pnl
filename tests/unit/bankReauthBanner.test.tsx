import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { BankReauthBanner } from '@/components/banking/BankReauthBanner';

const reauthBank = {
  id: 'bank-1',
  institution_name: 'Northgate Savings & Trust',
  account_mask: '4402',
  status: 'requires_reauth' as const,
  deactivated_at: '2026-07-12T09:00:00.000Z',
  sync_error: null,
};

const errorBank = {
  id: 'bank-2',
  institution_name: 'Riverside Community Bank',
  account_mask: '9981',
  status: 'error' as const,
  deactivated_at: null,
  sync_error: 'Stripe returned invalid_request_error',
};

const connectedBank = {
  id: 'bank-3',
  institution_name: 'Healthy Bank',
  account_mask: '1234',
  status: 'connected' as const,
  deactivated_at: null,
  sync_error: null,
};

describe('BankReauthBanner', () => {
  beforeEach(() => {
    toastMock.mockClear();
  });

  it('returns null while loading, even when quarantined banks are present', () => {
    const { container } = render(
      <BankReauthBanner banks={[reauthBank]} loading={true} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when nothing is quarantined', () => {
    const { container } = render(
      <BankReauthBanner banks={[connectedBank]} loading={false} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('returns null for an empty bank list', () => {
    const { container } = render(<BankReauthBanner banks={[]} loading={false} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the institution, mask, stop date, status word and a Reconnect CTA for a requires_reauth bank', () => {
    render(<BankReauthBanner banks={[reauthBank]} loading={false} />);

    expect(screen.getByText('Northgate Savings & Trust')).toBeInTheDocument();
    expect(screen.getByText(/••4402/)).toBeInTheDocument();
    expect(screen.getByText(/Needs reauthorization/)).toBeInTheDocument();
    expect(screen.getByText(/Jul 12/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
  });

  it('has role="status" on the container', () => {
    render(<BankReauthBanner banks={[reauthBank]} loading={false} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('never encodes status by colour alone: the amber row carries an icon and the literal words', () => {
    render(<BankReauthBanner banks={[reauthBank]} loading={false} />);

    const row = screen.getByText(/Needs reauthorization/).closest('[data-bank-row]');
    expect(row).not.toBeNull();
    expect(row?.className).toMatch(/amber/);
    expect(row?.querySelector('svg')).not.toBeNull();
  });

  it('renders a destructive variant carrying sync_error for an error bank, not the amber requires_reauth copy', () => {
    render(<BankReauthBanner banks={[errorBank]} loading={false} />);

    expect(screen.getByText('Riverside Community Bank')).toBeInTheDocument();
    expect(screen.getByText(/••9981/)).toBeInTheDocument();
    expect(screen.getByText(/Stripe returned invalid_request_error/)).toBeInTheDocument();
    expect(screen.queryByText(/Needs reauthorization/)).not.toBeInTheDocument();

    const row = screen.getByText(/Stripe returned invalid_request_error/).closest('[data-bank-row]');
    expect(row?.className).toMatch(/destructive/);
    expect(row?.className).not.toMatch(/amber/);
  });

  it('renders one row per quarantined bank when both a requires_reauth and an error bank are present, skipping healthy ones', () => {
    render(
      <BankReauthBanner banks={[reauthBank, errorBank, connectedBank]} loading={false} />
    );

    expect(screen.getAllByRole('button', { name: /reconnect/i })).toHaveLength(2);
    expect(screen.queryByText('Healthy Bank')).not.toBeInTheDocument();
  });

  it('calls onReconnect with the bank id when Reconnect is clicked', async () => {
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<BankReauthBanner banks={[reauthBank]} loading={false} onReconnect={onReconnect} />);

    await user.click(screen.getByRole('button', { name: /reconnect/i }));

    expect(onReconnect).toHaveBeenCalledWith('bank-1');
  });

  it('shows an in-flight spinner on the clicked button while onReconnect is pending, then clears it', async () => {
    let resolvePromise: () => void = () => {};
    const onReconnect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve;
        })
    );
    const user = userEvent.setup();
    render(<BankReauthBanner banks={[reauthBank]} loading={false} onReconnect={onReconnect} />);

    const button = screen.getByRole('button', { name: /reconnect/i });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();

    resolvePromise();

    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('shows a destructive toast when onReconnect rejects', async () => {
    const onReconnect = vi.fn().mockRejectedValue(new Error('Stripe session failed'));
    const user = userEvent.setup();
    render(<BankReauthBanner banks={[reauthBank]} loading={false} onReconnect={onReconnect} />);

    await user.click(screen.getByRole('button', { name: /reconnect/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: expect.stringContaining('Stripe session failed'),
        })
      )
    );
  });

  it('uses a flex-col sm:flex-row responsive layout on each row', () => {
    render(<BankReauthBanner banks={[reauthBank]} loading={false} />);

    const row = screen.getByText(/Needs reauthorization/).closest('[data-bank-row]');
    expect(row?.className).toMatch(/flex-col/);
    expect(row?.className).toMatch(/sm:flex-row/);
  });

  it('truncates the institution name', () => {
    render(<BankReauthBanner banks={[reauthBank]} loading={false} />);

    const nameEl = screen.getByText('Northgate Savings & Trust');
    expect(nameEl.className).toMatch(/truncate/);
  });
});
