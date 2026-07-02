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

  it('navigates to credentials step (step 2a) when Get Started is clicked', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    // Step 2a now shows API Key, API Secret, Restaurant GUID, Environment fields
    expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    expect(screen.getByLabelText(/api secret/i)).toBeTruthy();
    expect(screen.getByLabelText(/restaurant guid/i)).toBeTruthy();
  });

  it('shows aria-invalid and errors when Continue is clicked with empty fields', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));

    // Click Continue without filling any fields
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const apiKeyInput = screen.getByLabelText(/api key/i);
    expect(apiKeyInput.getAttribute('aria-invalid')).toBe('true');
    const apiSecretInput = screen.getByLabelText(/api secret/i);
    expect(apiSecretInput.getAttribute('aria-invalid')).toBe('true');
    const guidInput = screen.getByLabelText(/restaurant guid/i);
    expect(guidInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('advances to confirmed step showing GUID and environment after valid credentials', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));

    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'my-api-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'my-api-secret' } });
    fireEvent.change(screen.getByLabelText(/restaurant guid/i), { target: { value: 'aaa11100-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2b shows GUID in preview
    expect(screen.getByText('aaa11100-0000-0000-0000-000000000001')).toBeTruthy();
    expect(screen.getByRole('button', { name: /save.*connect/i })).toBeTruthy();
  });

  it('calls saveConnection with apiKey, apiSecret, guid, environment on "Save & Connect"', async () => {
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockResolvedValueOnce({ success: true, status: 'connected' });

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'my-api-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'my-api-secret' } });
    fireEvent.change(screen.getByLabelText(/restaurant guid/i), { target: { value: 'aaa11100-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const saveBtn = await screen.findByRole('button', { name: /save.*connect/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // saveConnection should be called with apiKey, apiSecret, guid, environment
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
    mockSaveConnection.mockRejectedValueOnce(new Error('Invalid API credentials'));

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'bad-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'bad-secret' } });
    fireEvent.change(screen.getByLabelText(/restaurant guid/i), { target: { value: 'aaa11100-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    const saveBtn = await screen.findByRole('button', { name: /save.*connect/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // Must NOT say "Connection test failed" when the SAVE failed
      expect(screen.queryByText(/connection test failed/i)).toBeNull();
      // Must say "Failed to save" or similar — UX fix: save failure ≠ test failure
      expect(screen.getByText(/failed to save/i)).toBeTruthy();
    });
  });

  it('stays on confirmed step showing "Connection test failed" when testConnection fails (F3)', async () => {
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockRejectedValueOnce(new Error('connection refused'));

    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'my-api-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'my-api-secret' } });
    fireEvent.change(screen.getByLabelText(/restaurant guid/i), { target: { value: 'aaa11100-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

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

  it('advances to Done step on successful save + test', async () => {
    mockSaveConnection.mockResolvedValueOnce({ success: true });
    mockTestConnection.mockResolvedValueOnce({ success: true, status: 'connected' });

    const onComplete = vi.fn();
    renderWizard({ onComplete });

    fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'my-api-key' } });
    fireEvent.change(screen.getByLabelText(/api secret/i), { target: { value: 'my-api-secret' } });
    fireEvent.change(screen.getByLabelText(/restaurant guid/i), { target: { value: 'aaa11100-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

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
