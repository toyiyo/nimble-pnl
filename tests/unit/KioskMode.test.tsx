/**
 * Focused integration tests for KioskMode.tsx covering the two reported bugs
 * AND the optimistic flow rewrite:
 *
 *   1. "Skip photo doesn't close the camera" — the dialog now closes
 *      synchronously when Skip/Confirm is tapped, before any async work runs.
 *   2. "Punches take seconds" — handlePunch now flips to optimistic UI BEFORE
 *      awaiting the INSERT. The mutate runs in the background, and the kiosk
 *      is unlocked for the next employee immediately after we have a PIN
 *      match + status + context.
 *
 * We don't try to test the entire KioskMode page — that would require mocking
 * dozens of contexts. Instead we mock the boundary collaborators and assert on
 * the observable orchestration the user actually sees.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const {
  verifyPinForRestaurantMock,
  upsertPinMock,
  createPunchMutateMock,
  rpcMock,
  fromUpdateMock,
  collectPunchContextMock,
  startPunchContextMock,
  resetPunchContextMock,
  toastMock,
  navigateMock,
  endSessionMock,
  submitTipMock,
  hasQueuedPunchesMock,
  isLikelyOfflineMock,
  flushQueuedPunchesMock,
  imageCaptureCaptureFnMock,
  imageCaptureStopMock,
} = vi.hoisted(() => ({
  verifyPinForRestaurantMock: vi.fn(),
  upsertPinMock: vi.fn(),
  createPunchMutateMock: vi.fn(),
  rpcMock: vi.fn(),
  fromUpdateMock: vi.fn(),
  collectPunchContextMock: vi.fn(),
  startPunchContextMock: vi.fn(),
  resetPunchContextMock: vi.fn(),
  toastMock: vi.fn(),
  navigateMock: vi.fn(),
  endSessionMock: vi.fn(),
  submitTipMock: vi.fn(),
  hasQueuedPunchesMock: vi.fn(() => false),
  isLikelyOfflineMock: vi.fn(() => false),
  flushQueuedPunchesMock: vi.fn(async () => ({ remaining: 0, flushed: 0 })),
  imageCaptureCaptureFnMock: vi.fn(() => Promise.resolve<Blob | null>(null)),
  imageCaptureStopMock: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'kiosk-user' } } } })),
      getUser: vi.fn(async () => ({ data: { user: { id: 'kiosk-user' } } })),
    },
    rpc: rpcMock,
    from: () => ({
      update: (...args: unknown[]) => {
        fromUpdateMock(...args);
        // Mimic the chained-eq() shape used by KioskMode.
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
      insert: () => ({ select: () => ({ single: vi.fn() }) }),
    }),
    storage: { from: () => ({ upload: vi.fn() }) },
  },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      restaurant: { name: 'Test Restaurant' },
      role: 'kiosk',
    },
  }),
}));

vi.mock('@/hooks/useKioskSession', () => ({
  useKioskSession: () => ({
    session: { location_id: 'r1', min_length: 4 },
    endSession: endSessionMock,
  }),
}));

vi.mock('@/hooks/useKioskPins', () => ({
  verifyPinForRestaurant: verifyPinForRestaurantMock,
  useUpsertEmployeePin: () => ({
    mutateAsync: upsertPinMock,
  }),
}));

vi.mock('@/hooks/useTimePunches', () => ({
  useCreateTimePunch: () => ({
    mutate: createPunchMutateMock,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { email: 'kiosk@test.com', id: 'kiosk-user' },
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/hooks/useEmployeeTips', () => ({
  useEmployeeTips: () => ({
    submitTip: submitTipMock,
    isSubmitting: false,
  }),
}));

vi.mock('@/utils/punchContext', () => ({
  collectPunchContext: collectPunchContextMock,
  startPunchContext: startPunchContextMock,
  _resetPunchContextForTests: resetPunchContextMock,
}));

vi.mock('@/utils/offlineQueue', () => ({
  hasQueuedPunches: hasQueuedPunchesMock,
  isLikelyOffline: isLikelyOfflineMock,
  flushQueuedPunches: flushQueuedPunchesMock,
  addQueuedPunch: vi.fn(),
}));

vi.mock('@/components/ImageCapture', () => {
  const ImageCapture = React.forwardRef<
    { stopCamera: () => void },
    {
      onCaptureRef?: (fn: () => Promise<Blob | null>) => void;
      onImageCaptured?: (blob: Blob) => void;
      disabled?: boolean;
    }
  >((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      stopCamera: imageCaptureStopMock,
    }));
    React.useEffect(() => {
      props.onCaptureRef?.(imageCaptureCaptureFnMock);
    }, [props]);
    return <div data-testid="image-capture-mock" />;
  });
  ImageCapture.displayName = 'ImageCaptureMock';
  return { ImageCapture };
});

vi.mock('@/components/kiosk/PinChangeDialog', () => ({
  PinChangeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="pin-change-dialog" /> : null,
}));

vi.mock('@/components/tips/TipSubmissionDialog', () => ({
  TipSubmissionDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="tip-dialog" /> : null,
}));

// Import the page LAST so all the mocks above are in place.
import KioskMode from '@/pages/KioskMode';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
};

const enterPin = (pin: string) => {
  for (const digit of pin) {
    fireEvent.click(screen.getByRole('button', { name: `Digit ${digit}` }));
  }
};

const okPinMatch = {
  id: 'pin-1',
  employee_id: 'e1',
  restaurant_id: 'r1',
  force_reset: false,
  employee: { id: 'e1', name: 'Jose Delgado', position: 'cook' },
};

beforeEach(() => {
  vi.clearAllMocks();
  hasQueuedPunchesMock.mockReturnValue(false);
  isLikelyOfflineMock.mockReturnValue(false);
  rpcMock.mockResolvedValue({ data: [{ is_clocked_in: false }], error: null });
  collectPunchContextMock.mockResolvedValue({
    location: undefined,
    device_info: 'test-agent',
  });
  startPunchContextMock.mockResolvedValue({
    location: undefined,
    device_info: 'test-agent',
  });
  verifyPinForRestaurantMock.mockResolvedValue(okPinMatch);
  imageCaptureCaptureFnMock.mockResolvedValue(null);
});

describe('KioskMode — skip-photo bug fix', () => {
  it('closes the camera dialog synchronously when Skip is tapped', async () => {
    render(<KioskMode />, { wrapper });
    enterPin('1234');
    fireEvent.click(screen.getByRole('button', { name: /Clock In/i }));

    // Camera dialog should now be open.
    expect(await screen.findByTestId('image-capture-mock')).toBeDefined();

    // Tap Skip photo. The dialog must close immediately — before
    // verifyPinForRestaurant or any RPC has a chance to resolve.
    fireEvent.click(screen.getByRole('button', { name: /Skip photo/i }));

    // The mock for ImageCapture should be removed from the DOM right away.
    await waitFor(() => {
      expect(screen.queryByTestId('image-capture-mock')).toBeNull();
    });

    // stopCamera was called via the imperative ref BEFORE the dialog unmount.
    expect(imageCaptureStopMock).toHaveBeenCalled();
  });

  it('starts geolocation as soon as the camera dialog opens (parallel with capture)', async () => {
    render(<KioskMode />, { wrapper });
    enterPin('1234');
    fireEvent.click(screen.getByRole('button', { name: /Clock In/i }));

    await waitFor(() => {
      expect(startPunchContextMock).toHaveBeenCalled();
    });
  });
});

describe('KioskMode — optimistic flow', () => {
  it('shows the success Alert with role=status BEFORE the mutate resolves', async () => {
    // Capture the mutate call but don't immediately fire onSuccess — that
    // simulates the network round-trip. The optimistic UI must already be
    // visible before we resolve.
    let capturedOnSuccess: (() => void) | null = null;
    createPunchMutateMock.mockImplementation((_payload, opts) => {
      capturedOnSuccess = opts?.onSuccess ?? null;
    });

    render(<KioskMode />, { wrapper });
    enterPin('1234');
    fireEvent.click(screen.getByRole('button', { name: /Clock In/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Skip photo/i }));

    // Optimistic Alert appears even though the mutate hasn't resolved.
    const alert = await screen.findByRole('status');
    expect(alert.getAttribute('aria-live')).toBe('polite');
    expect(alert.textContent).toContain('Jose Delgado');
    expect(alert.textContent).toContain('Clocked in');
    expect(createPunchMutateMock).toHaveBeenCalledTimes(1);

    // The PIN-change dialog and tip dialog MUST remain closed until the
    // mutate succeeds — these flows are security/UX sensitive and shouldn't
    // fire on an optimistic punch that the server might later reject.
    expect(screen.queryByTestId('pin-change-dialog')).toBeNull();
    expect(screen.queryByTestId('tip-dialog')).toBeNull();

    // Now simulate the server confirming the insert.
    await act(async () => {
      capturedOnSuccess?.();
    });

    // PIN reset wasn't forced, so no PIN dialog. But because action='clock_in',
    // there's no tip dialog either. Both should still be closed.
    expect(screen.queryByTestId('pin-change-dialog')).toBeNull();
    expect(screen.queryByTestId('tip-dialog')).toBeNull();
  });

  it('opens the PIN-change dialog ONLY after the mutate succeeds when force_reset=true', async () => {
    verifyPinForRestaurantMock.mockResolvedValue({
      ...okPinMatch,
      force_reset: true,
    });

    let capturedOnSuccess: (() => void) | null = null;
    createPunchMutateMock.mockImplementation((_payload, opts) => {
      capturedOnSuccess = opts?.onSuccess ?? null;
    });

    render(<KioskMode />, { wrapper });
    enterPin('1234');
    fireEvent.click(screen.getByRole('button', { name: /Clock In/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Skip photo/i }));

    // Wait for optimistic UI; PIN dialog should NOT be open yet.
    await screen.findByRole('status');
    expect(screen.queryByTestId('pin-change-dialog')).toBeNull();

    // Fire onSuccess — now the dialog should open.
    await act(async () => {
      capturedOnSuccess?.();
    });
    expect(screen.queryByTestId('pin-change-dialog')).not.toBeNull();
  });

  it('opens the tip dialog ONLY after a clock_out mutate succeeds', async () => {
    rpcMock.mockResolvedValue({ data: [{ is_clocked_in: true }], error: null });

    let capturedOnSuccess: (() => void) | null = null;
    createPunchMutateMock.mockImplementation((_payload, opts) => {
      capturedOnSuccess = opts?.onSuccess ?? null;
    });

    render(<KioskMode />, { wrapper });
    enterPin('1234');
    fireEvent.click(screen.getByRole('button', { name: /Clock Out/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Skip photo/i }));

    await screen.findByRole('status');
    expect(screen.queryByTestId('tip-dialog')).toBeNull();

    await act(async () => {
      capturedOnSuccess?.();
    });
    expect(screen.queryByTestId('tip-dialog')).not.toBeNull();
  });

  it('rolls back the optimistic Alert when the mutate fails and is not offline', async () => {
    let capturedOnError: ((err: unknown) => void) | null = null;
    createPunchMutateMock.mockImplementation((_payload, opts) => {
      capturedOnError = opts?.onError ?? null;
    });
    isLikelyOfflineMock.mockReturnValue(false);

    render(<KioskMode />, { wrapper });
    enterPin('1234');
    fireEvent.click(screen.getByRole('button', { name: /Clock In/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Skip photo/i }));

    // Optimistic Alert visible.
    expect(await screen.findByRole('status')).toBeDefined();

    // Server rejects.
    await act(async () => {
      capturedOnError?.(new Error('relation does not exist'));
    });

    // Optimistic Alert is gone.
    expect(screen.queryByRole('status')).toBeNull();
    // Error message takes its place.
    expect(screen.getByText(/relation does not exist/)).toBeDefined();
  });
});

describe('KioskMode — re-entry guard', () => {
  it('only fires ONE mutate even when Skip is tapped multiple times in the same tick', async () => {
    let capturedOnSuccess: (() => void) | null = null;
    createPunchMutateMock.mockImplementation((_payload, opts) => {
      capturedOnSuccess = opts?.onSuccess ?? null;
    });

    render(<KioskMode />, { wrapper });
    enterPin('1234');
    fireEvent.click(screen.getByRole('button', { name: /Clock In/i }));
    const skipBtn = await screen.findByRole('button', { name: /Skip photo/i });

    // Rapid double-tap.
    fireEvent.click(skipBtn);
    fireEvent.click(skipBtn);

    await screen.findByRole('status');
    expect(createPunchMutateMock).toHaveBeenCalledTimes(1);
    expect(capturedOnSuccess).not.toBeNull();
  });
});
