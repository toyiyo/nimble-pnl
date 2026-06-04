/**
 * Regression test for BUG-001: Banking reconciliation dialogs must use the
 * controlled DatePicker primitive (no initialFocus) so that the first calendar
 * click registers inside a modal Dialog.
 *
 * RED phase: verifies close-on-select behaviour that only works after
 * replacing the uncontrolled Popover+Calendar+initialFocus blocks with
 * <DatePicker>.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReconciliationDialog } from '../../src/components/banking/ReconciliationDialog';
import { EnhancedReconciliationDialog } from '../../src/components/banking/EnhancedReconciliationDialog';

// Radix Popover needs pointer-capture stubs in jsdom.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture)
    Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture)
    Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture)
    Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = () => {};
});

// ── Mocks for ReconciliationDialog ──────────────────────────────────────────
vi.mock('@/hooks/useBankReconciliation', () => ({
  useReconciliationBoundary: () => ({ data: null }),
  useSetReconciliationBoundary: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));

// ── Mocks for EnhancedReconciliationDialog ──────────────────────────────────
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      restaurant: { timezone: 'UTC' },
    },
  }),
}));

vi.mock('@/hooks/useBankTransactions', () => ({
  useBankTransactions: () => ({ transactions: [] }),
}));

vi.mock('@/hooks/useConnectedBanks', () => ({
  useConnectedBanks: () => ({ data: [] }),
}));

vi.mock('@/hooks/useOpeningBalance', () => ({
  useOpeningBalance: () => ({ data: null }),
}));

vi.mock('@/hooks/useReconcileTransactions', () => ({
  useReconcileTransactions: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
    },
  });
}

function renderReconciliationDialog() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <ReconciliationDialog isOpen onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

function renderEnhancedDialog() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <EnhancedReconciliationDialog isOpen onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

// ── Tests: ReconciliationDialog ──────────────────────────────────────────────
describe('ReconciliationDialog — date picker (BUG-001 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the statement date picker trigger', () => {
    renderReconciliationDialog();
    expect(
      screen.getByRole('button', { name: /select statement date/i }),
    ).toBeInTheDocument();
  });

  it('opens the calendar when the date trigger is clicked', async () => {
    const user = userEvent.setup();
    renderReconciliationDialog();
    await user.click(screen.getByRole('button', { name: /select statement date/i }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('closes the calendar after a date is selected — the BUG-001 fix', async () => {
    const user = userEvent.setup();
    renderReconciliationDialog();
    const trigger = screen.getByRole('button', { name: /select statement date/i });
    await user.click(trigger);
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '15' }));
    // After migration: the controlled DatePicker closes on selection.
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

// ── Tests: EnhancedReconciliationDialog ──────────────────────────────────────
describe('EnhancedReconciliationDialog — date picker (BUG-001 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the statement ending date picker trigger', () => {
    renderEnhancedDialog();
    expect(
      screen.getByRole('button', { name: /select statement ending date/i }),
    ).toBeInTheDocument();
  });

  it('opens the calendar when the ending-date trigger is clicked', async () => {
    const user = userEvent.setup();
    renderEnhancedDialog();
    await user.click(
      screen.getByRole('button', { name: /select statement ending date/i }),
    );
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('closes the calendar after a date is selected — the BUG-001 fix', async () => {
    const user = userEvent.setup();
    renderEnhancedDialog();
    const trigger = screen.getByRole('button', {
      name: /select statement ending date/i,
    });
    await user.click(trigger);
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '15' }));
    // After migration: the controlled DatePicker closes on selection.
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
