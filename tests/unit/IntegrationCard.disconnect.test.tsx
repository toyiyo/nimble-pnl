import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  ctx: { selectedRestaurant: null as unknown },
  disconnectRevel: vi.fn(),
  disconnectSling: vi.fn(),
  disconnectSquare: vi.fn(),
  disconnectClover: vi.fn(),
  disconnectShift4: vi.fn(),
  dialogProps: null as null | Record<string, unknown>,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => h.ctx,
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const idle = { isConnected: false, isConnecting: false, loading: false, connection: null };
vi.mock('@/hooks/useSquareIntegration', () => ({
  useSquareIntegration: () => ({ ...idle, isConnected: true, disconnectSquare: h.disconnectSquare }),
}));
vi.mock('@/hooks/useCloverIntegration', () => ({
  useCloverIntegration: () => ({ ...idle, isConnected: true, disconnectClover: h.disconnectClover }),
}));
vi.mock('@/hooks/useShift4Integration', () => ({
  useShift4Integration: () => ({ ...idle, isConnected: true, disconnectShift4: h.disconnectShift4 }),
}));
vi.mock('@/hooks/useToastConnection', () => ({ useToastConnection: () => idle }));
vi.mock('@/hooks/useFocusConnection', () => ({ useFocusConnection: () => idle }));
vi.mock('@/hooks/useSlingConnection', () => ({
  useSlingConnection: () => ({ ...idle, isConnected: true, disconnectSling: h.disconnectSling }),
}));
vi.mock('@/hooks/useRevelConnection', () => ({
  useRevelConnection: () => ({ ...idle, isConnected: true, disconnectRevel: h.disconnectRevel }),
}));

vi.mock('@/components/SquareSync', () => ({ SquareSync: () => null }));
vi.mock('@/components/CloverSync', () => ({ CloverSync: () => null }));
vi.mock('@/components/Shift4Sync', () => ({ Shift4Sync: () => null }));
vi.mock('@/components/ToastSync', () => ({ ToastSync: () => null }));
vi.mock('@/components/SlingSync', () => ({ SlingSync: () => null }));
vi.mock('@/components/FocusSync', () => ({ FocusSync: () => null }));
vi.mock('@/components/RevelSync', () => ({ RevelSync: () => null }));
vi.mock('@/components/Shift4ConnectDialog', () => ({ Shift4ConnectDialog: () => null }));
vi.mock('@/components/pos/ToastSetupWizard', () => ({ ToastSetupWizard: () => null }));
vi.mock('@/components/pos/SlingSetupWizard', () => ({ SlingSetupWizard: () => null }));
vi.mock('@/components/pos/FocusSetupWizard', () => ({ FocusSetupWizard: () => null }));
vi.mock('@/components/pos/RevelSetupWizard', () => ({ RevelSetupWizard: () => null }));
vi.mock('@/components/IntegrationLogo', () => ({ IntegrationLogo: () => null }));
vi.mock('@/components/integrations/DisconnectIntegrationDialog', () => ({
  DisconnectIntegrationDialog: (p: Record<string, unknown>) => {
    h.dialogProps = p;
    return p.open ? <div data-testid="dialog">{String(p.restaurantName)}</div> : null;
  },
}));

import { IntegrationCard } from '@/components/IntegrationCard';

const mk = (id: string, name: string) => ({
  id, name, description: 'd', category: 'POS', logo: 'x', connected: true, features: [],
});
const restaurant = (role: string | undefined, id = 'r1', name = 'Cafe One') => ({
  role, restaurant_id: id, restaurant: { id, name },
});

describe('IntegrationCard disconnect gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.dialogProps = null;
  });

  it.each(['owner', 'manager'])('shows Disconnect for %s', (role) => {
    h.ctx.selectedRestaurant = restaurant(role);
    render(<IntegrationCard integration={mk('revel-pos', 'Revel')} restaurantId="r1" />);
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it.each(['chef', 'collaborator_accountant', 'collaborator_inventory', undefined])(
    'hides Disconnect for %s and shows the hint',
    (role) => {
      h.ctx.selectedRestaurant = restaurant(role as string | undefined);
      render(<IntegrationCard integration={mk('revel-pos', 'Revel')} restaurantId="r1" />);
      expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
      expect(screen.getByText('Ask an owner or manager to disconnect.')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Configure/ })).toBeTruthy();
    },
  );

  it('hides Disconnect when no restaurant is selected', () => {
    h.ctx.selectedRestaurant = null;
    render(<IntegrationCard integration={mk('revel-pos', 'Revel')} restaurantId="r1" />);
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('opens the dialog and confirms with the restaurant id stored at open', async () => {
    h.ctx.selectedRestaurant = restaurant('owner', 'r1', 'Cafe One');
    h.disconnectRevel.mockResolvedValue(undefined);
    const { rerender } = render(
      <IntegrationCard integration={mk('revel-pos', 'Revel')} restaurantId="r1" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByTestId('dialog').textContent).toBe('Cafe One');

    h.ctx.selectedRestaurant = restaurant('owner', 'r2', 'Cafe Two');
    rerender(<IntegrationCard integration={mk('revel-pos', 'Revel')} restaurantId="r2" />);

    await (h.dialogProps!.onConfirm as (r: unknown) => Promise<void>)({
      reason: 'no_value',
      reasonText: null,
    });
    await waitFor(() =>
      expect(h.disconnectRevel).toHaveBeenCalledWith('r1', { reason: 'no_value', reasonText: null }),
    );
  });

  it.each([
    ['square-pos', 'Square', 'disconnectSquare'],
    ['clover-pos', 'Clover', 'disconnectClover'],
    ['shift4-pos', 'Shift4', 'disconnectShift4'],
  ] as const)(
    'confirms %s with the restaurant id stored at open',
    async (id, name, fn) => {
      h.ctx.selectedRestaurant = restaurant('owner', 'r1', 'Cafe One');
      h[fn].mockResolvedValue(undefined);
      const { rerender } = render(<IntegrationCard integration={mk(id, name)} restaurantId="r1" />);
      await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      expect(screen.getByTestId('dialog').textContent).toBe('Cafe One');

      h.ctx.selectedRestaurant = restaurant('owner', 'r2', 'Cafe Two');
      rerender(<IntegrationCard integration={mk(id, name)} restaurantId="r2" />);

      const opts = { reason: 'no_value', reasonText: null };
      await (h.dialogProps!.onConfirm as (r: unknown) => Promise<void>)(opts);
      await waitFor(() => expect(h[fn]).toHaveBeenCalledWith(opts, 'r1'));
    },
  );

  it('keeps the direct call for Sling', async () => {
    h.ctx.selectedRestaurant = restaurant('owner');
    h.disconnectSling.mockResolvedValue(undefined);
    render(<IntegrationCard integration={mk('sling-scheduling', 'Sling')} restaurantId="r1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(h.disconnectSling).toHaveBeenCalledWith('r1');
    expect(screen.queryByTestId('dialog')).toBeNull();
  });
});
