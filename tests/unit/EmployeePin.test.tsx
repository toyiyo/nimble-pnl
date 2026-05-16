import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import EmployeePin from '@/pages/EmployeePin';

const { mutateAsyncMock, useEmployeePinsMock, useCurrentEmployeeMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  useEmployeePinsMock: vi.fn(),
  useCurrentEmployeeMock: vi.fn(),
}));

vi.mock('@/hooks/useKioskPins', () => ({
  useEmployeePins: (...args: unknown[]) => useEmployeePinsMock(...args),
  useUpsertEmployeePin: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r1', restaurant: { name: 'Test Cafe' } },
  }),
}));

vi.mock('@/hooks/useTimePunches', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTimePunches')>('@/hooks/useTimePunches');
  return {
    ...actual,
    useCurrentEmployee: (...args: unknown[]) => useCurrentEmployeeMock(...args),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('EmployeePin page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCurrentEmployeeMock.mockReturnValue({
      employee: { id: 'e1', name: 'Alice', position: 'Server' },
      loading: false,
    });
    useEmployeePinsMock.mockReturnValue({ pins: [], loading: false });
  });

  it('shows the "No PIN yet" empty state', () => {
    render(<EmployeePin />);
    expect(screen.getByText(/no pin yet/i)).toBeInTheDocument();
  });

  it('Generate calls mutateAsync with actor=self and shows the PIN after success', async () => {
    mutateAsyncMock.mockResolvedValue({ pin: '7432', record: { id: 'pin-1', restaurant_id: 'r1' } });
    render(<EmployeePin />);
    fireEvent.click(screen.getByRole('button', { name: /generate a new pin/i }));
    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurant_id: 'r1',
          employee_id: 'e1',
          actor: 'self',
          force_reset: false,
        })
      );
    });
    expect(await screen.findByText('7432')).toBeInTheDocument();
  });

  it('shows status pill when a PIN already exists', () => {
    useEmployeePinsMock.mockReturnValue({
      pins: [{
        id: 'pin-1', employee_id: 'e1', restaurant_id: 'r1', pin_hash: 'h',
        min_length: 4, force_reset: false, last_used_at: null,
        created_at: '2026-05-10T00:00:00Z', updated_at: '2026-05-10T00:00:00Z',
      }],
      loading: false,
    });
    render(<EmployeePin />);
    expect(screen.getByText(/pin set/i)).toBeInTheDocument();
  });
});
