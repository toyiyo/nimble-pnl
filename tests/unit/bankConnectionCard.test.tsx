import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { BankConnectionCard } from '@/components/BankConnectionCard';
import type { GroupedBank, BankBalance } from '@/utils/financialConnections';

const makeBalance = (overrides: Partial<BankBalance>): BankBalance => ({
  id: 'bal-default',
  connected_bank_id: 'bank-default',
  account_name: 'Checking',
  account_type: 'checking',
  account_mask: '0000',
  current_balance: 1000,
  available_balance: 1000,
  currency: 'USD',
  as_of_date: '2026-07-20T00:00:00.000Z',
  is_active: true,
  bankStatus: 'connected',
  dataCurrentThrough: '2026-07-20T00:00:00.000Z',
  ...overrides,
});

// 1 of 3 accounts quarantined at Northgate Savings & Trust.
const oneOfThreeQuarantined: GroupedBank = {
  id: 'Northgate Savings & Trust',
  institution_name: 'Northgate Savings & Trust',
  institution_logo_url: null,
  status: 'requires_reauth',
  connected_at: '2026-06-01T00:00:00.000Z',
  last_sync_at: '2026-07-20T00:00:00.000Z',
  sync_error: null,
  bankIds: ['bank-1', 'bank-2', 'bank-3'],
  reauthBankIds: ['bank-3'],
  healthyBankIds: ['bank-1', 'bank-2'],
  balances: [
    makeBalance({ id: 'bal-1', connected_bank_id: 'bank-1', account_mask: '1111', account_name: 'Checking' }),
    makeBalance({ id: 'bal-2', connected_bank_id: 'bank-2', account_mask: '2222', account_name: 'Savings' }),
    makeBalance({
      id: 'bal-3',
      connected_bank_id: 'bank-3',
      account_mask: '3333',
      account_name: 'Payroll',
      current_balance: 4200,
      available_balance: 4200,
      bankStatus: 'requires_reauth',
      dataCurrentThrough: '2026-07-10T00:00:00.000Z',
      as_of_date: '2026-07-10T00:00:00.000Z',
    }),
  ],
};

// All 3 accounts quarantined.
const allQuarantined: GroupedBank = {
  ...oneOfThreeQuarantined,
  reauthBankIds: ['bank-1', 'bank-2', 'bank-3'],
  healthyBankIds: [],
  balances: oneOfThreeQuarantined.balances.map((b) => ({ ...b, bankStatus: 'requires_reauth' })),
};

// 2 of 3 accounts quarantined — multi-account Reconnect must expand the list,
// never guess which one to target.
const twoOfThreeQuarantined: GroupedBank = {
  ...oneOfThreeQuarantined,
  reauthBankIds: ['bank-2', 'bank-3'],
  healthyBankIds: ['bank-1'],
  balances: [
    oneOfThreeQuarantined.balances[0],
    { ...oneOfThreeQuarantined.balances[1], bankStatus: 'requires_reauth' },
    oneOfThreeQuarantined.balances[2],
  ],
};

async function openBankMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /open bank options/i }));
}

describe('BankConnectionCard', () => {
  beforeEach(() => {
    toastMock.mockClear();
  });

  it('shows the top-level Refresh balance and Sync transactions entries when at least one account is healthy, and operates only on the healthy ids', async () => {
    const onRefreshBalance = vi.fn().mockResolvedValue(undefined);
    const onSyncTransactions = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <BankConnectionCard
        bank={oneOfThreeQuarantined}
        onRefreshBalance={onRefreshBalance}
        onSyncTransactions={onSyncTransactions}
      />
    );

    await openBankMenu(user);
    await user.click(screen.getByText('Refresh balance'));
    expect(onRefreshBalance).toHaveBeenCalledTimes(2);
    expect(onRefreshBalance).toHaveBeenCalledWith('bank-1');
    expect(onRefreshBalance).toHaveBeenCalledWith('bank-2');
    expect(onRefreshBalance).not.toHaveBeenCalledWith('bank-3');

    await openBankMenu(user);
    await user.click(screen.getByText('Sync transactions'));
    expect(onSyncTransactions).toHaveBeenCalledTimes(2);
    expect(onSyncTransactions).not.toHaveBeenCalledWith('bank-3');
  });

  it('removes (not disables) the top-level Refresh balance and Sync transactions entries when every account is quarantined', async () => {
    const user = userEvent.setup();
    render(
      <BankConnectionCard
        bank={allQuarantined}
        onRefreshBalance={vi.fn()}
        onSyncTransactions={vi.fn()}
        onReconnect={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await openBankMenu(user);
    expect(screen.queryByText('Refresh balance')).not.toBeInTheDocument();
    expect(screen.queryByText('Sync transactions')).not.toBeInTheDocument();
  });

  it('shows a top-level Reconnect entry when any account is quarantined, targeting the single connected_bank_id directly', async () => {
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<BankConnectionCard bank={oneOfThreeQuarantined} onReconnect={onReconnect} />);

    await openBankMenu(user);
    await user.click(screen.getByText('Reconnect'));

    expect(onReconnect).toHaveBeenCalledWith('bank-3');
  });

  it('does not show a Reconnect entry when nothing is quarantined', async () => {
    const healthy: GroupedBank = {
      ...oneOfThreeQuarantined,
      status: 'connected',
      reauthBankIds: [],
      healthyBankIds: ['bank-1', 'bank-2', 'bank-3'],
      balances: oneOfThreeQuarantined.balances.map((b) => ({ ...b, bankStatus: 'connected' })),
    };
    const user = userEvent.setup();
    render(<BankConnectionCard bank={healthy} onReconnect={vi.fn()} />);

    await openBankMenu(user);
    expect(screen.queryByText('Reconnect')).not.toBeInTheDocument();
  });

  it('expands the accounts list instead of guessing when more than one account is quarantined', async () => {
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<BankConnectionCard bank={twoOfThreeQuarantined} onReconnect={onReconnect} />);

    expect(screen.queryByText('Payroll')).not.toBeInTheDocument();

    await openBankMenu(user);
    await user.click(screen.getByText('Reconnect'));

    expect(onReconnect).not.toHaveBeenCalled();
    expect(screen.getByText('Payroll')).toBeInTheDocument();
  });

  it('renders a quarantined balance row with the Historical chip, a muted (not opacity-reduced) balance figure, and its own as-of date', async () => {
    const user = userEvent.setup();
    render(<BankConnectionCard bank={oneOfThreeQuarantined} onReconnect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /3 accounts/i }));

    expect(screen.getByText('Historical')).toBeInTheDocument();

    const balanceFigure = screen.getByText('$4,200.00');
    expect(balanceFigure.className).toMatch(/text-muted-foreground/);
    expect(balanceFigure.className).not.toMatch(/opacity-/);

    // BankConnectionCard's own formatDate renders in the runner's local
    // timezone (an existing, out-of-scope convention), so derive the
    // expected string the same way rather than hardcoding a UTC date.
    const expectedAsOf = new Date('2026-07-10T00:00:00.000Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const row = screen.getByText('Historical').closest('div.flex.items-center.justify-between');
    expect(row?.textContent).toContain(`As of ${expectedAsOf}`);
  });

  it('healthy balance rows do not carry the Historical chip', async () => {
    const user = userEvent.setup();
    render(<BankConnectionCard bank={oneOfThreeQuarantined} onReconnect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /3 accounts/i }));

    const healthyRow = screen.getByText('Checking').closest('div.flex.items-center.justify-between');
    expect(healthyRow?.textContent).not.toMatch(/Historical/);
  });

  it('swaps Refresh/Sync for Reconnect on a quarantined account row, targeting its own connected_bank_id', async () => {
    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const onRefreshBalance = vi.fn();
    const user = userEvent.setup();
    render(
      <BankConnectionCard
        bank={oneOfThreeQuarantined}
        onReconnect={onReconnect}
        onRefreshBalance={onRefreshBalance}
      />
    );

    await user.click(screen.getByRole('button', { name: /3 accounts/i }));

    const rows = screen.getAllByRole('button', { name: /open account options/i });
    // bal-3 (Payroll, quarantined) is the third row.
    await user.click(rows[2]);

    expect(screen.queryByText('Refresh balance')).not.toBeInTheDocument();
    const reconnectItems = screen.getAllByText('Reconnect');
    await user.click(reconnectItems[reconnectItems.length - 1]);

    expect(onReconnect).toHaveBeenCalledWith('bank-3');
    expect(onRefreshBalance).not.toHaveBeenCalled();
  });

  it('replaces the Synced text with a <FreshnessStamp>', () => {
    render(<BankConnectionCard bank={oneOfThreeQuarantined} />);

    expect(screen.queryByText(/Synced/)).not.toBeInTheDocument();
    expect(screen.getByText(/Data through/)).toBeInTheDocument();
  });

  it('shows Not yet verified when no balance in the group has ever proven freshness', () => {
    const neverSynced: GroupedBank = {
      ...oneOfThreeQuarantined,
      balances: oneOfThreeQuarantined.balances.map((b) => ({ ...b, dataCurrentThrough: null })),
    };
    render(<BankConnectionCard bank={neverSynced} />);

    expect(screen.getByText('Not yet verified')).toBeInTheDocument();
  });
});
