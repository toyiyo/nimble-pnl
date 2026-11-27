import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const notifyMock = vi.fn();
vi.mock('@/lib/integrationDisconnect', () => ({
  notifyIntegrationDisconnect: (...a: unknown[]) => notifyMock(...a),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant: { id: 'r1', name: 'Test Cafe' } },
  }),
}));

// Stub the shared dialog: expose the props the wrapper passes.
vi.mock('@/components/integrations/DisconnectIntegrationDialog', () => ({
  DisconnectIntegrationDialog: (p: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    kind: string;
    integrationName: string;
    restaurantName: string;
    confirmDisabled?: boolean;
    confirmLabel?: string;
    extraConfirmContent?: React.ReactNode;
    onConfirm: (r: { reason: string | null; reasonText: string | null }) => Promise<void>;
  }) =>
    p.open ? (
      <div>
        <span data-testid="kind">{p.kind}</span>
        <span data-testid="name">{p.integrationName}</span>
        <span data-testid="rname">{p.restaurantName}</span>
        <span data-testid="label">{p.confirmLabel}</span>
        <button
          disabled={p.confirmDisabled}
          onClick={() =>
            p.onConfirm({ reason: 'no_value', reasonText: null }).catch(() => undefined)
          }
        >
          confirm
        </button>
        <button onClick={() => p.onOpenChange(false)}>close</button>
        {p.extraConfirmContent}
      </div>
    ) : null,
}));

import { DisconnectBankDialog } from '@/components/banking/DisconnectBankDialog';

function setup(
  onDisconnect: (...a: unknown[]) => Promise<{ eventId: string | null }>,
  bankIds: string | string[] = ['a', 'b', 'c'],
) {
  const onOpenChange = vi.fn();
  const utils = render(
    <DisconnectBankDialog
      bankName="Chase"
      bankIds={bankIds}
      onDisconnect={onDisconnect as never}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange, ...utils };
}

describe('DisconnectBankDialog', () => {
  beforeEach(() => notifyMock.mockReset());

  it('renders the shared dialog as a bank dialog', () => {
    setup(vi.fn());
    expect(screen.getByTestId('kind')).toHaveTextContent('bank');
    expect(screen.getByTestId('name')).toHaveTextContent('Chase');
    expect(screen.getByTestId('rname')).toHaveTextContent('Test Cafe');
  });

  it('passes the reason options and starts the notice with the eventId', async () => {
    const onDisconnect = vi.fn().mockResolvedValue({ eventId: 'evt-1' });
    const { onOpenChange } = setup(onDisconnect, 'a');
    await userEvent.click(screen.getByRole('button', { name: 'confirm' }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
    expect(onDisconnect).toHaveBeenCalledWith('a', false, {
      reason: 'no_value',
      reasonText: null,
      recordEvent: true,
    });
    expect(notifyMock).toHaveBeenCalledWith('evt-1');
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(true);
  });

  it('sends recordEvent until one call returns an eventId', async () => {
    const onDisconnect = vi
      .fn()
      .mockResolvedValueOnce({ eventId: null })
      .mockResolvedValueOnce({ eventId: 'evt-2' })
      .mockResolvedValueOnce({ eventId: null });
    setup(onDisconnect);
    await userEvent.click(screen.getByRole('button', { name: 'confirm' }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(3));
    const flags = onDisconnect.mock.calls.map((c) => c[2].recordEvent);
    expect(flags).toEqual([true, true, false]);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith('evt-2');
  });

  it('stops the loop at the first failure', async () => {
    const onDisconnect = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ eventId: 'x' });
    setup(onDisconnect);
    await userEvent.click(screen.getByRole('button', { name: 'confirm' }));
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('follows canProceed for confirmDisabled and the label', async () => {
    setup(vi.fn().mockResolvedValue({ eventId: null }));
    expect(screen.getByRole('button', { name: 'confirm' })).toBeEnabled();
    expect(screen.getByTestId('label')).toHaveTextContent('Disconnect anyway');
    await userEvent.click(screen.getByRole('checkbox', { name: /delete all transaction data/i }));
    expect(screen.getByTestId('label')).toHaveTextContent('Disconnect and delete data');
    expect(screen.getByRole('button', { name: 'confirm' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /I understand/i }));
    expect(screen.getByRole('button', { name: 'confirm' })).toBeEnabled();
  });

  it('resets the delete state on close', async () => {
    setup(vi.fn().mockResolvedValue({ eventId: null }));
    await userEvent.click(screen.getByRole('checkbox', { name: /delete all transaction data/i }));
    expect(screen.getByTestId('label')).toHaveTextContent('Disconnect and delete data');
    await userEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.getByTestId('label')).toHaveTextContent('Disconnect anyway');
  });
});
