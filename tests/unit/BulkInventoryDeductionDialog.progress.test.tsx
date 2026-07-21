/**
 * T5 — BulkInventoryDeductionDialog live progress / gated close / terminal
 * totals, per design docs/superpowers/specs/2026-07-20-bulk-deduction-timeout-design.md §4.
 *
 * The hook mock below is a REAL React hook (uses useState internally) so
 * `loading` reactively drives re-renders exactly like the production hook,
 * and `onProgress` is captured so the test controls when "batches" report
 * progress and when the run "finishes" (resolves the promise the component
 * awaits) — mirroring useBulkInventoryDeduction's
 * (restaurantId, startDate, endDate, onProgress) => Promise<BulkProcessResult | null>
 * contract from T4.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkInventoryDeductionDialog } from '../../src/components/BulkInventoryDeductionDialog';

// ── Mock hook — real useState so `loading` re-renders like the real hook ──
let progressQueue: Array<{ processed: number; skipped: number; errors: number; batches: number }> = [];
let capturedResolve: ((result: unknown) => void) | null = null;

vi.mock('@/hooks/useBulkInventoryDeduction', () => ({
  useBulkInventoryDeduction: () => {
    const [loading, setLoading] = useState(false);

    const bulkProcessHistoricalSales = (
      _restaurantId: string,
      _startDate: string,
      _endDate: string,
      onProgress?: (p: { processed: number; skipped: number; errors: number; batches: number }) => void,
    ) => {
      setLoading(true);
      progressQueue.forEach((p) => onProgress?.(p));
      return new Promise((resolve) => {
        capturedResolve = (result: unknown) => {
          setLoading(false);
          resolve(result);
        };
      });
    };

    return { bulkProcessHistoricalSales, loading };
  },
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r1' },
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole('button', { name: /bulk process/i });
  await user.click(trigger);
}

/** Pick day 10 as start, day 20 as end — a valid (start <= end) range. */
async function pickValidDateRange(user: ReturnType<typeof userEvent.setup>) {
  const startTrigger = screen.getByRole('button', { name: /select start date/i });
  await user.click(startTrigger);
  let grid = await screen.findByRole('grid');
  await user.click(within(grid).getByRole('gridcell', { name: '10' }));

  const endTrigger = screen.getByRole('button', { name: /select end date/i });
  await user.click(endTrigger);
  grid = await screen.findByRole('grid');
  await user.click(within(grid).getByRole('gridcell', { name: '20' }));
}

describe('BulkInventoryDeductionDialog — live progress / gated close / terminal totals (T5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    progressQueue = [];
    capturedResolve = null;
  });

  it('shows no progress status before processing starts', async () => {
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a live aria-live=polite processed count while a batch loop is running, and disables Cancel', async () => {
    progressQueue = [{ processed: 250, skipped: 10, errors: 0, batches: 1 }];
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);
    await pickValidDateRange(user);

    await user.click(screen.getByRole('button', { name: /^process sales$/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/250/);
    expect(status).toHaveTextContent(/10/); // skipped count also surfaced

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(cancelButton).toBeDisabled();
  });

  it('gates dialog close while loading — Escape does not close the dialog mid-run', async () => {
    progressQueue = [{ processed: 50, skipped: 0, errors: 0, batches: 1 }];
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);
    await pickValidDateRange(user);

    await user.click(screen.getByRole('button', { name: /^process sales$/i }));
    await screen.findByRole('status');

    await user.keyboard('{Escape}');

    // Still open — the dialog title (only rendered while open) must survive.
    expect(screen.getByText('Bulk Process Historical Sales')).toBeInTheDocument();
  });

  it('shows terminal totals inline in the Alert once the run completes successfully, before auto-close, and re-enables Cancel', async () => {
    progressQueue = [{ processed: 260, skipped: 15, errors: 0, batches: 2 }];
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);
    await pickValidDateRange(user);

    await user.click(screen.getByRole('button', { name: /^process sales$/i }));
    await screen.findByRole('status');

    await act(async () => {
      capturedResolve?.({ processed: 260, skipped: 15, errors: 0, total: 275 });
    });

    // Terminal totals still visible inline (not toast-only) — dialog hasn't
    // auto-closed yet (real 2s timer, not advanced in this test).
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/260/);
    // Success reads as "Done", not the error/interrupted wording.
    expect(status).toHaveTextContent(/done/i);
    expect(status).not.toHaveTextContent(/interrupted/i);
    expect(screen.getByText('Bulk Process Historical Sales')).toBeInTheDocument();

    // Loading finished — Cancel usable again.
    expect(screen.getByRole('button', { name: /cancel/i })).not.toBeDisabled();
  });

  it('shows accumulated (partial) totals inline when the run errors, without relying on the toast', async () => {
    progressQueue = [{ processed: 120, skipped: 5, errors: 2, batches: 1 }];
    const user = userEvent.setup();
    render(<BulkInventoryDeductionDialog />);
    await openDialog(user);
    await pickValidDateRange(user);

    await user.click(screen.getByRole('button', { name: /^process sales$/i }));
    await screen.findByRole('status');

    await act(async () => {
      capturedResolve?.(null); // hook resolves null on the caught-error path
    });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/120/);
    // Errored run is labelled distinctly from a clean finish (three-state), and
    // tells the user it's safe to re-run.
    expect(status).toHaveTextContent(/interrupted/i);
    expect(status).toHaveTextContent(/re-run/i);
    expect(status).not.toHaveTextContent(/^Done/);
    expect(screen.getByRole('button', { name: /cancel/i })).not.toBeDisabled();
  });
});
