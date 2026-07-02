/**
 * focusSetupWizard.test.tsx
 *
 * Tests for:
 *  1. SyncComponents: POSConfig.recentWindowLabel optional field + FOCUS_CONFIG export
 *  2. FocusSetupWizard: step flow, credential validation, aria-invalid, confirmation preview,
 *     partial-failure re-entry (F1–F8)
 *  3. FocusSync: not-connected guard (F7), syncCursor forwarded to InitialSyncPendingAlert
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FocusSetupWizard } from '@/components/pos/FocusSetupWizard';
import { FocusSync } from '@/components/FocusSync';
import { IntegrationLogo } from '@/components/IntegrationLogo';
import { Dialog } from '@/components/ui/dialog';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

// Use a vi.fn() so each test can configure the return value via mockReturnValue.
const mockUseFocusConnection = vi.fn();

vi.mock('@/hooks/useFocusConnection', () => ({
  useFocusConnection: (...args: unknown[]) => mockUseFocusConnection(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Default hook return value helper.
const mockSaveConnection = vi.fn();
const mockTestConnection = vi.fn();
const mockDisconnect = vi.fn();
const mockTriggerManualSync = vi.fn();
const mockListRestaurants = vi.fn();

function makeHookReturn(connectionOverride: Record<string, unknown> | null = null) {
  return {
    saveConnection: mockSaveConnection,
    testConnection: mockTestConnection,
    connection: connectionOverride,
    isConnected: !!connectionOverride,
    loading: false,
    error: null,
    disconnect: mockDisconnect,
    triggerManualSync: mockTriggerManualSync,
    listRestaurants: mockListRestaurants,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapQC(ui: React.ReactElement) {
  return render(<QueryClientProvider client={makeQC()}>{ui}</QueryClientProvider>);
}

// ─── SyncComponents ────────────────────────────────────────────────────────────

describe('SyncComponents — recentWindowLabel + FOCUS_CONFIG', () => {
  it('FOCUS_CONFIG is exported and has the correct shape', async () => {
    const { FOCUS_CONFIG } = await import('@/components/pos/SyncComponents');
    expect(FOCUS_CONFIG).toBeDefined();
    expect(FOCUS_CONFIG.name).toBe('Focus POS');
    expect(FOCUS_CONFIG.dataLabel).toBe('daily reports');
    expect(FOCUS_CONFIG.dataLabelSingular).toBe('daily report');
    expect(FOCUS_CONFIG.syncInterval).toBe('6 hours');
    expect(FOCUS_CONFIG.recentWindowLabel).toBe('last 2 business days');
  });

  it('SyncModeSelector uses recentWindowLabel when provided', async () => {
    const { SyncModeSelector, FOCUS_CONFIG } = await import('@/components/pos/SyncComponents');
    render(
      <SyncModeSelector
        syncMode="recent"
        onSyncModeChange={vi.fn()}
        dateRange={undefined}
        onDateRangeChange={vi.fn()}
        initialSyncDone={true}
        config={FOCUS_CONFIG}
      />
    );
    expect(screen.getByText(/last 2 business days/i)).toBeTruthy();
    expect(screen.queryByText(/last 25 hours/i)).toBeNull();
  });

  it('SyncModeSelector falls back to "last 25 hours" when recentWindowLabel is absent', async () => {
    const { SyncModeSelector, TOAST_CONFIG } = await import('@/components/pos/SyncComponents');
    render(
      <SyncModeSelector
        syncMode="recent"
        onSyncModeChange={vi.fn()}
        dateRange={undefined}
        onDateRangeChange={vi.fn()}
        initialSyncDone={true}
        config={TOAST_CONFIG}
      />
    );
    expect(screen.getByText(/last 25 hours/i)).toBeTruthy();
  });

  it('SyncButton description uses recentWindowLabel when provided', async () => {
    const { SyncButton, FOCUS_CONFIG } = await import('@/components/pos/SyncComponents');
    render(
      <SyncButton
        isLoading={false}
        initialSyncDone={true}
        syncMode="recent"
        dateRange={undefined}
        onSync={vi.fn()}
        config={FOCUS_CONFIG}
      />
    );
    expect(screen.getByText(/last 2 business days/i)).toBeTruthy();
    expect(screen.queryByText(/last 25 hours/i)).toBeNull();
  });

  it('SyncButton description falls back to "last 25 hours" for TOAST_CONFIG', async () => {
    const { SyncButton, TOAST_CONFIG } = await import('@/components/pos/SyncComponents');
    render(
      <SyncButton
        isLoading={false}
        initialSyncDone={true}
        syncMode="recent"
        dateRange={undefined}
        onSync={vi.fn()}
        config={TOAST_CONFIG}
      />
    );
    expect(screen.getByText(/last 25 hours/i)).toBeTruthy();
  });
});

// ─── FocusSetupWizard ──────────────────────────────────────────────────────────

describe('FocusSetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFocusConnection.mockReturnValue(makeHookReturn(null));
  });

  function renderWizard(
    props: Partial<{
      restaurantId: string;
      onComplete: () => void;
      onOpenChange: (open: boolean) => void;
    }> = {}
  ) {
    const defaults = {
      restaurantId: 'rest-1',
      onComplete: vi.fn(),
      onOpenChange: vi.fn(),
    };
    // F1: FocusSetupWizard renders DialogContent — needs a Dialog parent in tests.
    // IntegrationCard provides the outer Dialog; here we provide it explicitly.
    return wrapQC(
      <Dialog open>
        <FocusSetupWizard {...{ ...defaults, ...props }} />
      </Dialog>
    );
  }

  it('renders step 1 with "how to connect your focus pos account" heading', () => {
    renderWizard();
    expect(screen.getByText(/how to connect your focus pos account/i)).toBeTruthy();
  });

  it('step 1 has an informational Alert mentioning "credentials" and "encrypted"', () => {
    renderWizard();
    // The alert mentions credentials being encrypted
    expect(screen.getByText(/credentials are encrypted/i)).toBeTruthy();
  });

  it('has a "Get Started" button on step 1', () => {
    renderWizard();
    expect(screen.getByRole('button', { name: /get started/i })).toBeTruthy();
  });

  it('navigates to credentials step when Get Started is clicked (has API Key + Secret fields, no GUID)', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    // New picker flow: API Key + API Secret, but NO Restaurant GUID
    expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    expect(screen.getByLabelText(/api secret/i)).toBeTruthy();
    // GUID input is gone in the new flow
    expect(screen.queryByLabelText(/restaurant guid/i)).toBeNull();
  });

  it('shows aria-invalid errors when "Find my restaurant(s)" is clicked with empty fields', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));

    // Click "Find my restaurant(s)" without filling any fields
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      const apiKeyInput = screen.getByLabelText(/api key/i);
      expect(apiKeyInput.getAttribute('aria-invalid')).toBe('true');
      const apiSecretInput = screen.getByLabelText(/api secret/i);
      expect(apiSecretInput.getAttribute('aria-invalid')).toBe('true');
    });
  });

  it('advances to select step showing restaurant name after valid credentials + listRestaurants success', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'aaa11100-0000-0000-0000-000000000001', restaurant_name: 'My Cafe' },
    ]);

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));

    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'my-api-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'my-api-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      // Select step shows restaurant name + Save & Connect
      expect(screen.getByText('My Cafe')).toBeTruthy();
      expect(screen.getByRole('button', { name: /save.*connect/i })).toBeTruthy();
    });
  });

  it('calls saveConnection with fetched GUID on "Save & Connect" (picker flow)', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'aaa11100-0000-0000-0000-000000000001', restaurant_name: 'My Cafe' },
    ]);
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockResolvedValueOnce({ success: true, status: 'connected' });

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'my-api-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'my-api-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    const saveBtn = await screen.findByRole('button', { name: /save.*connect/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // saveConnection should use the GUID from the fetched list
      expect(mockSaveConnection).toHaveBeenCalledWith(
        'rest-1',
        'my-api-key',
        'my-api-secret',
        'aaa11100-0000-0000-0000-000000000001',
        'production',
      );
      expect(mockTestConnection).toHaveBeenCalledWith('rest-1');
    });
  });

  it('shows SAVE failure (not test failure) when saveConnection throws (UX fix)', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-1', restaurant_name: 'Cafe' },
    ]);
    mockSaveConnection.mockRejectedValueOnce(new Error('Invalid API credentials'));

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'bad-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'bad-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    const saveBtn = await screen.findByRole('button', { name: /save.*connect/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // Must NOT say "Connection test failed" when the SAVE failed
      expect(screen.queryByText(/connection test failed/i)).toBeNull();
      // Must say "Failed to save" or similar — UX fix: save failure ≠ test failure
      expect(screen.getByText(/failed to save/i)).toBeTruthy();
    });
  });

  it('stays on select step showing "Connection test failed" when testConnection fails (F3)', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-1', restaurant_name: 'Cafe' },
    ]);
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockRejectedValueOnce(new Error('connection refused'));

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'my-api-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'my-api-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    const saveBtn = await screen.findByRole('button', { name: /save.*connect/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // Should NOT have advanced to the Done step
      expect(screen.queryByText(/setup complete/i)).toBeNull();
      // Error text should distinguish test failure from save failure
      expect(screen.getByText(/connection test failed/i)).toBeTruthy();
      // The component also shows "Your API credentials were saved. Click Retry..."
      // alongside the test-failure error — this is the intended UX (credentials
      // saved = true, connection test = failed).  Asserting it IS present ensures
      // the component never silently drops this informational message.
      expect(screen.getByText(/credentials were saved/i)).toBeTruthy();
    });
  });

  it('advances to Done step on successful save + test (picker flow)', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-1', restaurant_name: 'Cafe' },
    ]);
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockResolvedValueOnce({ success: true, status: 'connected' });

    const onComplete = vi.fn();
    renderWizard({ onComplete });

    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'my-api-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'my-api-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    const saveBtn = await screen.findByRole('button', { name: /save.*connect/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/setup complete/i)).toBeTruthy();
    });
  });

  it('has a DialogTitle (h2) heading that mentions "Focus" or "Setup" (F1)', () => {
    renderWizard();
    // Radix DialogTitle renders as h2; our section headings are h3
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toBeTruthy();
    expect(heading.textContent?.toLowerCase()).toMatch(/focus|setup/i);
  });

  it('step indicator has aria-current="step" on the active step (F8)', () => {
    renderWizard();
    const stepWithCurrent = document.querySelector('[aria-current="step"]');
    expect(stepWithCurrent).toBeTruthy();
  });
});

// ─── FocusSetupWizard — picker flow (A4) ─────────────────────────────────────

describe('FocusSetupWizard — picker flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFocusConnection.mockReturnValue(makeHookReturn(null));
  });

  function renderWizard(
    props: Partial<{
      restaurantId: string;
      onComplete: () => void;
      onOpenChange: (open: boolean) => void;
    }> = {}
  ) {
    const defaults = {
      restaurantId: 'rest-1',
      onComplete: vi.fn(),
      onOpenChange: vi.fn(),
    };
    return wrapQC(
      <Dialog open>
        <FocusSetupWizard {...{ ...defaults, ...props }} />
      </Dialog>
    );
  }

  // ── instructions step ──────────────────────────────────────────────────────

  it('instructions step does NOT mention "Restaurant GUID" or "GET /api/restaurants"', () => {
    renderWizard();
    // These phrases must be gone from the instructions list
    expect(screen.queryByText(/restaurant guid/i)).toBeNull();
    expect(screen.queryByText(/GET \/api\/restaurants/i)).toBeNull();
  });

  it('instructions step mentions "Find my restaurant" or equivalent new copy', () => {
    renderWizard();
    // The new instructions step describes the "Find my restaurant(s)" action
    expect(screen.getByText(/find my restaurant/i)).toBeTruthy();
  });

  it('instructions step mentions generating API Key + Secret in Shift4/Focus', () => {
    renderWizard();
    // The instructions list includes a step about generating credentials
    const items = screen.getAllByText(/api key.*secret|generate.*api|shift4.*api|api.*shift4/i);
    expect(items.length).toBeGreaterThan(0);
  });

  // ── credentials step ───────────────────────────────────────────────────────

  it('credentials step has no Restaurant GUID input', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    // GUID input must be gone
    expect(screen.queryByLabelText(/restaurant guid/i)).toBeNull();
  });

  it('credentials step button is "Find my restaurant(s)", not "Continue"', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    expect(screen.getByRole('button', { name: /find my restaurant/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^continue$/i })).toBeNull();
  });

  it('"Find my restaurant(s)" calls listRestaurants with apiKey/apiSecret/environment', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-abc', restaurant_name: 'Test Cafe' },
    ]);

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      expect(mockListRestaurants).toHaveBeenCalledWith(
        'rest-1',
        'mykey',
        'mysecret',
        'production',
      );
    });
  });

  it('shows inline error on credentials step when listRestaurants throws', async () => {
    mockListRestaurants.mockRejectedValueOnce(new Error('Check your API Key and Secret'));

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'bad-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'bad-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      // Error shown inline on credentials step
      expect(screen.getByText(/check your api key and secret/i)).toBeTruthy();
      // Step does NOT advance to select — "Find my restaurant(s)" button still visible
      expect(screen.getByRole('button', { name: /find my restaurant/i })).toBeTruthy();
      // Save & Connect is only on the select step
      expect(screen.queryByRole('button', { name: /save.*connect/i })).toBeNull();
    });
  });

  it('shows inline "no restaurants found" message when listRestaurants returns empty list', async () => {
    mockListRestaurants.mockResolvedValueOnce([]);

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      expect(screen.getByText(/no restaurants were found/i)).toBeTruthy();
      // Step does NOT advance to select — "Find my restaurant(s)" button still visible
      expect(screen.getByRole('button', { name: /find my restaurant/i })).toBeTruthy();
      // Save & Connect is only on the select step
      expect(screen.queryByRole('button', { name: /save.*connect/i })).toBeNull();
    });
  });

  // ── select step (multiple restaurants) ────────────────────────────────────

  it('advances to select step with a labelled Select when listRestaurants returns N>1 restaurants', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-1', restaurant_name: 'Cafe One' },
      { restaurant_guid: 'guid-2', restaurant_name: 'Cafe Two' },
    ]);

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      // Should be on the select step with a Restaurant label
      expect(screen.getByLabelText(/restaurant/i)).toBeTruthy();
      // "Save & Connect" primary button
      expect(screen.getByRole('button', { name: /save.*connect/i })).toBeTruthy();
    });
  });

  it('select step shows environment read-back', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-1', restaurant_name: 'Cafe One' },
      { restaurant_guid: 'guid-2', restaurant_name: 'Cafe Two' },
    ]);

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      // Environment should be visible as a read-back
      expect(screen.getByText(/production/i)).toBeTruthy();
    });
  });

  it('uses blank restaurant_name as "(name unavailable)" in the select options', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-1', restaurant_name: '' },
      { restaurant_guid: 'guid-2', restaurant_name: 'Cafe Two' },
    ]);

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    // Wait for the select step to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save.*connect/i })).toBeTruthy();
    });

    // Open the Select dropdown to see options
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText(/name unavailable/i)).toBeTruthy();
    });
  });

  // ── select step (auto-select when exactly 1 restaurant) ───────────────────

  it('auto-selects single restaurant and shows it as a read-back line (no Select combobox)', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-only', restaurant_name: 'Only Cafe' },
    ]);

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      // The name is shown as a read-back, not a combobox
      expect(screen.getByText('Only Cafe')).toBeTruthy();
      // No combobox for single-restaurant case
      expect(screen.queryByRole('combobox')).toBeNull();
      // Save & Connect still available
      expect(screen.getByRole('button', { name: /save.*connect/i })).toBeTruthy();
    });
  });

  it('auto-selected single restaurant: Save & Connect calls saveConnection with the auto-selected GUID', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'auto-guid', restaurant_name: 'Auto Cafe' },
    ]);
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockResolvedValueOnce({ success: true });

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      expect(screen.getByText('Auto Cafe')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /save.*connect/i }));

    await waitFor(() => {
      expect(mockSaveConnection).toHaveBeenCalledWith(
        'rest-1',
        'mykey',
        'mysecret',
        'auto-guid',
        'production',
      );
    });
  });

  it('select step: save failure alert shown (distinct from test failure)', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-only', restaurant_name: 'Only Cafe' },
    ]);
    mockSaveConnection.mockRejectedValueOnce(new Error('Cannot save'));

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save.*connect/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /save.*connect/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to save/i)).toBeTruthy();
      expect(screen.queryByText(/connection test failed/i)).toBeNull();
    });
  });

  it('select step: test failure alert shown (distinct from save failure)', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-only', restaurant_name: 'Only Cafe' },
    ]);
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockRejectedValueOnce(new Error('Test refused'));

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save.*connect/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /save.*connect/i }));

    await waitFor(() => {
      expect(screen.getByText(/connection test failed/i)).toBeTruthy();
      expect(screen.queryByText(/failed to save/i)).toBeNull();
    });
  });

  it('select step Save & Connect advances to done on success', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-only', restaurant_name: 'Only Cafe' },
    ]);
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockResolvedValueOnce({ success: true });

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save.*connect/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /save.*connect/i }));

    await waitFor(() => {
      expect(screen.getByText(/setup complete/i)).toBeTruthy();
    });
  });

  // ── step indicator a11y ────────────────────────────────────────────────────

  it('step indicator places aria-current="step" on the role="listitem" element', () => {
    renderWizard();
    // Design §8.5 Frontend minor: aria-current must be on the listitem, not a child
    const listitem = document.querySelector('[role="listitem"][aria-current="step"]');
    expect(listitem).toBeTruthy();
  });

  // ── done step copy ─────────────────────────────────────────────────────────

  it('done step says background 90-day import, not "click Sync Now to start"', async () => {
    mockListRestaurants.mockResolvedValueOnce([
      { restaurant_guid: 'guid-only', restaurant_name: 'Only Cafe' },
    ]);
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockResolvedValueOnce({ success: true });

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'mykey' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'mysecret' } });
    fireEvent.click(screen.getByRole('button', { name: /find my restaurant/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save.*connect/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /save.*connect/i }));

    await waitFor(() => {
      expect(screen.getByText(/setup complete/i)).toBeTruthy();
    });

    // Done step copy: background 90-day import; "keep this page open" or "leave this page"
    expect(screen.getByText(/background|you can leave/i)).toBeTruthy();
    // Must NOT say "Use Sync Now to start syncing" (old blocking copy)
    expect(screen.queryByText(/use.*sync now.*to start syncing/i)).toBeNull();
  });
});

// ─── FocusSync ─────────────────────────────────────────────────────────────────

describe('FocusSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFocusConnection.mockReturnValue(makeHookReturn(null));
  });

  it('renders a not-connected guard when connection is null (F7)', () => {
    wrapQC(<FocusSync restaurantId="rest-1" />);
    // The not-connected state shows an alert about connecting
    expect(screen.getByText(/please connect to focus pos first/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sync now/i })).toBeNull();
  });

  it('renders the sync dashboard with "Sync Now" when connected', () => {
    mockUseFocusConnection.mockReturnValue(
      makeHookReturn({
        id: 'conn-1',
        restaurant_id: 'rest-1',
        is_active: true,
        initial_sync_done: true,
        sync_cursor: 90,
        last_sync_time: null,
        connection_status: 'connected',
        last_error: null,
        last_error_at: null,
      })
    );
    mockTriggerManualSync.mockResolvedValue({ status: 'ok', syncCursor: 90, initialSyncDone: true });

    wrapQC(<FocusSync restaurantId="rest-1" />);
    expect(screen.getByRole('button', { name: /sync now/i })).toBeTruthy();
  });

  it('shows InitialSyncPendingAlert with syncCursor=42 when initial_sync_done is false', () => {
    mockUseFocusConnection.mockReturnValue(
      makeHookReturn({
        id: 'conn-1',
        restaurant_id: 'rest-1',
        is_active: true,
        initial_sync_done: false,
        sync_cursor: 42,
        last_sync_time: null,
        connection_status: 'connected',
        last_error: null,
        last_error_at: null,
      })
    );
    mockTriggerManualSync.mockResolvedValue({ status: 'ok', syncCursor: 43, initialSyncDone: false });

    wrapQC(<FocusSync restaurantId="rest-1" />);
    // InitialSyncPendingAlert shows "42 of 90 days completed"
    expect(screen.getByText(/42.*of 90|42 of 90/i)).toBeTruthy();
  });
});

// ─── IntegrationLogo ───────────────────────────────────────────────────────────

describe('IntegrationLogo', () => {
  it('renders an <img> for focus-pos (not an emoji div)', () => {
    render(<IntegrationLogo integrationId="focus-pos" size={32} />);
    // Should have an image element (not the emoji fallback)
    const img = document.querySelector('img[alt="focus-pos logo"]');
    expect(img).toBeTruthy();
    // Must not fall through to the emoji div
    const emojiDiv = Array.from(document.querySelectorAll('div')).find(
      (el) => el.textContent?.trim() === '🍦'
    );
    expect(emojiDiv).toBeUndefined();
  });

  it('focus-pos image points to /logos/focus.png or /logos/focus.svg', () => {
    render(<IntegrationLogo integrationId="focus-pos" size={32} />);
    const img = document.querySelector('img[alt="focus-pos logo"]') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    // src should reference a logo file (not empty)
    expect(img!.getAttribute('src')).toMatch(/\/logos\/(focus|shift4-focus)/i);
  });
});
