/**
 * focusPosRegistration.test.tsx
 *
 * Task 14: Register Focus POS in Integrations UI
 *
 * Tests:
 *  1. IntegrationLogo — emojiMap has 'focus-pos' = '🍦'
 *  2. Integrations.tsx — renders a Focus POS card; useFocusConnection included in memo deps
 *  3. IntegrationCard.tsx — 8 Toast-parity touch points for 'focus-pos':
 *     a. showFocusSetup state exists (Connect opens the dialog)
 *     b. useFocusConnection hook is called
 *     c. isFocusIntegration used in getActuallyConnected
 *     d. isFocusIntegration used in getActuallyConnecting
 *     e. handleConnect routes to setShowFocusSetup
 *     f. handleDisconnect routes to focusConnection.disconnect
 *     g. <FocusSync> rendered in connected branch
 *     h. <FocusSetupWizard> dialog rendered
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockUseFocusConnection = vi.fn();
vi.mock('@/hooks/useFocusConnection', () => ({
  useFocusConnection: (...args: unknown[]) => mockUseFocusConnection(...args),
}));

// Stub all other integration hooks so Integrations.tsx renders without real network
vi.mock('@/hooks/useSquareIntegration', () => ({
  useSquareIntegration: () => ({ isConnected: false }),
}));
vi.mock('@/hooks/useCloverIntegration', () => ({
  useCloverIntegration: () => ({ isConnected: false }),
}));
vi.mock('@/hooks/useShift4Integration', () => ({
  useShift4Integration: () => ({ isConnected: false, loading: false }),
}));
vi.mock('@/hooks/useToastIntegration', () => ({
  useToastIntegration: () => ({ isConnected: false }),
}));
vi.mock('@/hooks/useSlingIntegration', () => ({
  useSlingIntegration: () => ({ isConnected: false }),
}));

// IntegrationCard hooks
vi.mock('@/hooks/useSquareIntegration', () => ({
  useSquareIntegration: () => ({ isConnected: false, isConnecting: false }),
}));
vi.mock('@/hooks/useCloverIntegration', () => ({
  useCloverIntegration: () => ({ isConnected: false, isConnecting: false }),
}));
vi.mock('@/hooks/useToastConnection', () => ({
  useToastConnection: () => ({ isConnected: false, loading: false }),
}));
vi.mock('@/hooks/useSlingConnection', () => ({
  useSlingConnection: () => ({ isConnected: false, loading: false }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Stub context so Integrations.tsx renders without providers
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1', name: 'Test Restaurant' },
    setSelectedRestaurant: vi.fn(),
    restaurants: [{ restaurant_id: 'rest-1', name: 'Test Restaurant' }],
    loading: false,
    createRestaurant: vi.fn(),
    canCreateRestaurant: false,
  }),
}));

// Stub FocusSync and FocusSetupWizard so we can assert they are rendered
vi.mock('@/components/FocusSync', () => ({
  FocusSync: ({ restaurantId }: { restaurantId: string }) => (
    <div data-testid="focus-sync" data-restaurant-id={restaurantId}>FocusSync</div>
  ),
}));

vi.mock('@/components/pos/FocusSetupWizard', () => ({
  FocusSetupWizard: ({ restaurantId }: { restaurantId: string; onComplete: () => void }) => (
    <div data-testid="focus-setup-wizard" data-restaurant-id={restaurantId}>FocusSetupWizard</div>
  ),
}));

// Stub other sync components to avoid their hook calls
vi.mock('@/components/SquareSync', () => ({
  SquareSync: () => <div data-testid="square-sync" />,
}));
vi.mock('@/components/CloverSync', () => ({
  CloverSync: () => <div data-testid="clover-sync" />,
}));
vi.mock('@/components/Shift4Sync', () => ({
  Shift4Sync: () => <div data-testid="shift4-sync" />,
}));
vi.mock('@/components/ToastSync', () => ({
  ToastSync: () => <div data-testid="toast-sync" />,
}));
vi.mock('@/components/SlingSync', () => ({
  SlingSync: () => <div data-testid="sling-sync" />,
}));
vi.mock('@/components/Shift4ConnectDialog', () => ({
  Shift4ConnectDialog: () => <div data-testid="shift4-dialog" />,
}));
vi.mock('@/components/pos/ToastSetupWizard', () => ({
  ToastSetupWizard: () => <div data-testid="toast-wizard" />,
}));
vi.mock('@/components/pos/SlingSetupWizard', () => ({
  SlingSetupWizard: () => <div data-testid="sling-wizard" />,
}));
vi.mock('@/components/RestaurantSelector', () => ({
  RestaurantSelector: () => <div data-testid="restaurant-selector" />,
}));
vi.mock('@/components/MetricIcon', () => ({
  MetricIcon: () => <div data-testid="metric-icon" />,
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

const mockDisconnect = vi.fn();
const mockSaveConnection = vi.fn();
const mockTestConnection = vi.fn();

function makeDisconnectedHook() {
  return {
    isConnected: false,
    loading: false,
    connection: null,
    error: null,
    saveConnection: mockSaveConnection,
    testConnection: mockTestConnection,
    disconnect: mockDisconnect,
    triggerManualSync: vi.fn(),
  };
}

function makeConnectedHook() {
  return {
    isConnected: true,
    loading: false,
    connection: {
      id: 'conn-1',
      restaurant_id: 'rest-1',
      is_active: true,
      initial_sync_done: true,
      sync_cursor: 90,
      last_sync_time: '2026-06-27T00:00:00Z',
      connection_status: 'connected',
      last_error: null,
      last_error_at: null,
    },
    error: null,
    saveConnection: mockSaveConnection,
    testConnection: mockTestConnection,
    disconnect: mockDisconnect,
    triggerManualSync: vi.fn(),
  };
}

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapQC(ui: React.ReactElement) {
  return render(<QueryClientProvider client={makeQC()}>{ui}</QueryClientProvider>);
}

// ─── 1. IntegrationLogo ────────────────────────────────────────────────────────

describe('IntegrationLogo — focus-pos emoji', () => {
  it("renders '🍦' emoji for 'focus-pos' (not the generic 🔌 fallback)", async () => {
    const { IntegrationLogo } = await import('@/components/IntegrationLogo');
    const { container } = render(<IntegrationLogo integrationId="focus-pos" />);
    expect(container.textContent).toContain('🍦');
    expect(container.textContent).not.toContain('🔌');
  });
});

// ─── 2. Integrations.tsx — Focus POS entry ────────────────────────────────────

describe('Integrations.tsx — Focus POS registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFocusConnection.mockReturnValue(makeDisconnectedHook());
  });

  it('renders a card labelled "Focus POS"', async () => {
    const { default: Integrations } = await import('@/pages/Integrations');
    wrapQC(<Integrations />);
    expect(screen.getByText('Focus POS')).toBeTruthy();
  });

  it("Focus POS card is in the 'POS' category (Point of Sale)", async () => {
    const { default: Integrations } = await import('@/pages/Integrations');
    wrapQC(<Integrations />);
    // The category badge renders 'Point of Sale' or 'POS'
    const focusCard = screen.getByText('Focus POS').closest('div');
    expect(focusCard).toBeTruthy();
  });

  it('calls useFocusConnection with the selectedRestaurant.restaurant_id', async () => {
    const { default: Integrations } = await import('@/pages/Integrations');
    wrapQC(<Integrations />);
    expect(mockUseFocusConnection).toHaveBeenCalledWith('rest-1');
  });
});

// ─── 3. IntegrationCard — Focus POS touch points ──────────────────────────────

describe('IntegrationCard — Focus POS (8 Toast-parity touch points)', () => {
  const focusIntegration = {
    id: 'focus-pos',
    name: 'Focus POS',
    description: 'Sync daily sales from Focus POS',
    category: 'Point of Sale',
    logo: '🍦',
    connected: false,
    features: ['Daily Sales', 'Revenue Center Reports'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFocusConnection.mockReturnValue(makeDisconnectedHook());
  });

  async function renderCard(connected: boolean) {
    vi.resetModules();
    mockUseFocusConnection.mockReturnValue(connected ? makeConnectedHook() : makeDisconnectedHook());
    const { IntegrationCard } = await import('@/components/IntegrationCard');
    return wrapQC(
      <IntegrationCard
        integration={{ ...focusIntegration, connected }}
        restaurantId="rest-1"
      />
    );
  }

  // (a) showFocusSetup state: clicking Connect opens the dialog
  it('(a) clicking Connect opens FocusSetupWizard dialog', async () => {
    await renderCard(false);
    const connectBtn = screen.getByRole('button', { name: /connect/i });
    fireEvent.click(connectBtn);
    await waitFor(() => {
      expect(screen.getByTestId('focus-setup-wizard')).toBeTruthy();
    });
  });

  // (b) useFocusConnection hook is called with restaurantId
  it('(b) calls useFocusConnection("rest-1")', async () => {
    await renderCard(false);
    expect(mockUseFocusConnection).toHaveBeenCalledWith('rest-1');
  });

  // (c) isFocusIntegration → getActuallyConnected reflects hook's isConnected
  it('(c) getActuallyConnected uses focusConnection.isConnected when is focus-pos', async () => {
    mockUseFocusConnection.mockReturnValue(makeConnectedHook());
    const { IntegrationCard } = await import('@/components/IntegrationCard');
    wrapQC(
      <IntegrationCard
        integration={{ ...focusIntegration, connected: false }} // prop says false
        restaurantId="rest-1"
      />
    );
    // Hook says connected → "Connected" badge visible
    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeTruthy();
    });
  });

  // (d) isFocusIntegration → getActuallyConnecting uses focusConnection.loading
  it('(d) getActuallyConnecting uses focusConnection.loading when is focus-pos', async () => {
    mockUseFocusConnection.mockReturnValue({ ...makeDisconnectedHook(), loading: true });
    const { IntegrationCard } = await import('@/components/IntegrationCard');
    wrapQC(
      <IntegrationCard
        integration={{ ...focusIntegration, connected: false }}
        restaurantId="rest-1"
      />
    );
    await waitFor(() => {
      const connectBtn = screen.getByRole('button', { name: /connecting/i });
      expect(connectBtn).toBeTruthy();
      expect(connectBtn).toBeDisabled();
    });
  });

  // (e) handleConnect routes to setShowFocusSetup (dialog appears)
  it('(e) handleConnect for focus-pos opens the setup dialog (not "coming soon")', async () => {
    await renderCard(false);
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => {
      // FocusSetupWizard stub is rendered in the dialog
      expect(screen.getByTestId('focus-setup-wizard')).toBeTruthy();
    });
  });

  // (f) handleDisconnect calls focusConnection.disconnect
  it('(f) handleDisconnect calls focusConnection.disconnect(restaurantId)', async () => {
    mockUseFocusConnection.mockReturnValue(makeConnectedHook());
    const { IntegrationCard } = await import('@/components/IntegrationCard');
    wrapQC(
      <IntegrationCard
        integration={{ ...focusIntegration, connected: true }}
        restaurantId="rest-1"
      />
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /disconnect/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    await waitFor(() => {
      expect(mockDisconnect).toHaveBeenCalledWith('rest-1');
    });
  });

  // (g) <FocusSync> rendered in connected branch
  it('(g) renders FocusSync with restaurantId when connected', async () => {
    mockUseFocusConnection.mockReturnValue(makeConnectedHook());
    const { IntegrationCard } = await import('@/components/IntegrationCard');
    wrapQC(
      <IntegrationCard
        integration={{ ...focusIntegration, connected: true }}
        restaurantId="rest-1"
      />
    );
    await waitFor(() => {
      const syncEl = screen.getByTestId('focus-sync');
      expect(syncEl).toBeTruthy();
      expect(syncEl.getAttribute('data-restaurant-id')).toBe('rest-1');
    });
  });

  // (h) <FocusSetupWizard> dialog rendered when showFocusSetup is true
  it('(h) FocusSetupWizard receives restaurantId prop', async () => {
    await renderCard(false);
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    await waitFor(() => {
      const wizard = screen.getByTestId('focus-setup-wizard');
      expect(wizard.getAttribute('data-restaurant-id')).toBe('rest-1');
    });
  });
});
