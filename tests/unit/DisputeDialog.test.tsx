import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DisputeDialog } from '@/components/deposit-match/DisputeDialog';
import type { DepositMatchLedgerRow, DepositMatchReport } from '@/types/depositMatch';

const mutate = vi.fn();

vi.mock('@/hooks/useDepositMatch', () => ({
  useSetDepositMatchResolution: () => ({ mutate, isPending: false }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeItem(overrides: Partial<DepositMatchLedgerRow>): DepositMatchLedgerRow {
  return {
    item_id: 'item-1',
    rule_id: 'rule-1',
    pos_source: 'toast',
    business_date: '2026-08-01',
    expected_amount: 100,
    received_amount: 95,
    fee_amount: 5,
    status: 'short',
    status_reason: null,
    resolution: null,
    resolution_note: null,
    links: [],
    ...overrides,
  };
}

const report: DepositMatchReport = {
  summary: { total_expected: 0, total_received: 0, total_fees: 0, pending_count: 0, needs_attention_count: 0 },
  streams: [],
  ledger: [],
  banks: [],
} as unknown as DepositMatchReport;

describe('DisputeDialog', () => {
  it('resets the note when the dialog reopens for a different item', async () => {
    const itemA = makeItem({ item_id: 'item-1', business_date: '2026-08-01' });
    const itemB = makeItem({ item_id: 'item-2', business_date: '2026-08-02' });

    const { rerender } = render(
      <DisputeDialog item={itemA} report={report} open onOpenChange={vi.fn()} restaurantId="rest-1" />
    );

    const textarea = screen.getByLabelText(/note \(optional\)/i);
    await userEvent.type(textarea, 'This day looks short.');
    expect(textarea).toHaveValue('This day looks short.');

    rerender(
      <DisputeDialog item={itemB} report={report} open onOpenChange={vi.fn()} restaurantId="rest-1" />
    );

    expect(screen.getByLabelText(/note \(optional\)/i)).toHaveValue('');
  });

  it('clears the note when the dialog closes and reopens for the same item', async () => {
    const item = makeItem({ item_id: 'item-1', business_date: '2026-08-01' });

    const { rerender } = render(
      <DisputeDialog item={item} report={report} open onOpenChange={vi.fn()} restaurantId="rest-1" />
    );

    const textarea = screen.getByLabelText(/note \(optional\)/i);
    await userEvent.type(textarea, 'Draft note, never sent.');
    expect(textarea).toHaveValue('Draft note, never sent.');

    // Close without submitting. The page keeps the same activeItem after
    // close, so item_id alone would not change on this path.
    rerender(
      <DisputeDialog item={item} report={report} open={false} onOpenChange={vi.fn()} restaurantId="rest-1" />
    );
    rerender(
      <DisputeDialog item={item} report={report} open onOpenChange={vi.fn()} restaurantId="rest-1" />
    );

    expect(screen.getByLabelText(/note \(optional\)/i)).toHaveValue('');
  });
});
