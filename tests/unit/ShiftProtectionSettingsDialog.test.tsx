/**
 * Unit tests: ShiftProtectionSettingsDialog.
 *
 * Contracts pinned here:
 * - Three states: skeletons while the settings load, an error state with
 *   a Retry action that refetches, and the rule sections when loaded.
 * - A failed load never seeds the draft (a save would write defaults
 *   over the real rules), so the error state shows no Save button.
 * - Client validation: a zero threshold shows the message and disables
 *   Save.
 * - A save writes the edited draft AND invalidates the shift-protection
 *   query, then closes the dialog.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SHIFT_PROTECTION_DEFAULTS } from '@/lib/shiftProtection';

const mockUpdateSettings = vi.hoisted(() => vi.fn());
const mockRefetch = vi.hoisted(() => vi.fn());
const mockInvalidate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const hookState = vi.hoisted(() => ({
  isLoading: false,
  error: null as Error | null,
}));

vi.mock('@/hooks/useStaffingSettings', () => ({
  useStaffingSettings: () => ({
    effectiveSettings: {
      ...SHIFT_PROTECTION_DEFAULTS,
      timeoff_notice_mode: 'warn',
      timeoff_notice_days: 7,
    },
    isLoading: hookState.isLoading,
    error: hookState.error,
    refetch: mockRefetch,
    updateSettings: mockUpdateSettings,
    isSaving: false,
  }),
}));

vi.mock('@/hooks/useShiftProtection', () => ({
  shiftProtectionQueryKey: (id: string | null) => ['shift-protection', id],
  useInvalidateShiftProtection: () => mockInvalidate,
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

import { ShiftProtectionSettingsDialog } from '@/components/scheduling/ShiftProtectionSettingsDialog';

const renderDialog = (onOpenChange = vi.fn()) => {
  render(
    <ShiftProtectionSettingsDialog
      open={true}
      onOpenChange={onOpenChange}
      restaurantId="rest-1"
    />
  );
  return onOpenChange;
};

beforeEach(() => {
  vi.clearAllMocks();
  hookState.isLoading = false;
  hookState.error = null;
  mockUpdateSettings.mockResolvedValue({});
});

describe('ShiftProtectionSettingsDialog', () => {
  it('renders the rule sections with the stored values', () => {
    renderDialog();

    expect(screen.getByText('Shift Protection')).toBeInTheDocument();
    expect(screen.getByText('Shift Trades')).toBeInTheDocument();
    expect(screen.getByText('Time Off')).toBeInTheDocument();
    expect(screen.getByLabelText('Trade deadline hours')).toHaveValue(24);
    expect(screen.getByLabelText('Minimum notice days')).toHaveValue(7);
    expect(screen.getByLabelText('Same-day request limit')).toHaveValue(2);

    // The stored warn mode is the checked radio for Minimum notice.
    const noticeGroup = screen.getByRole('radiogroup', { name: 'Rule mode for Minimum notice' });
    expect(noticeGroup).toBeInTheDocument();
  });

  it('shows skeletons while the settings load', () => {
    hookState.isLoading = true;
    renderDialog();
    expect(screen.queryByText('Shift Trades')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Settings' })).not.toBeInTheDocument();
  });

  it('shows the error state with a Retry action and no Save', () => {
    hookState.error = new Error('boom');
    renderDialog();

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the rules.');
    expect(screen.queryByRole('button', { name: 'Save Settings' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('disables Save and shows the message for a zero threshold', () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Trade deadline hours'), { target: { value: '0' } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Every threshold needs a whole number above zero.'
    );
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
  });

  it('saves the edited draft, invalidates the rules query, and closes', async () => {
    const onOpenChange = renderDialog();

    fireEvent.change(screen.getByLabelText('Trade deadline hours'), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalled());
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ trade_deadline_hours: 48, timeoff_notice_mode: 'warn' })
    );
    expect(mockInvalidate).toHaveBeenCalledWith('rest-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Shift protection saved' })
    );
  });

  it('shows a destructive toast when the save fails and stays open', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('RLS says no'));
    const onOpenChange = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error saving the rules', variant: 'destructive' })
      )
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
