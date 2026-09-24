import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StreamCards } from '@/components/deposit-match/StreamCards';
import type { DepositMatchStreamSummary } from '@/types/depositMatch';

const streams: DepositMatchStreamSummary[] = [
  {
    rule_id: 'rule-1',
    pos_source: 'toast',
    rail: 'card',
    active: true,
    expected_total: 100,
    received_total: 95,
    fee_total: 3,
    item_count: 5,
  },
];

describe('StreamCards', () => {
  it('calls onSelectStream when the card body is clicked', async () => {
    const onSelectStream = vi.fn();
    const onEditStream = vi.fn();
    render(
      <StreamCards
        streams={streams}
        activeStreamId={null}
        onSelectStream={onSelectStream}
        onEditStream={onEditStream}
      />
    );

    await userEvent.click(screen.getByText('toast'));
    expect(onSelectStream).toHaveBeenCalledWith('rule-1');
    expect(onEditStream).not.toHaveBeenCalled();
  });

  it('calls onEditStream, not onSelectStream, when the edit button is clicked', async () => {
    const onSelectStream = vi.fn();
    const onEditStream = vi.fn();
    render(
      <StreamCards
        streams={streams}
        activeStreamId={null}
        onSelectStream={onSelectStream}
        onEditStream={onEditStream}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /edit the toast rule/i }));
    expect(onEditStream).toHaveBeenCalledWith('rule-1');
    expect(onSelectStream).not.toHaveBeenCalled();
  });
});
