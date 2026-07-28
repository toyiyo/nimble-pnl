import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchablePOSItemSelector } from '@/components/SearchablePOSItemSelector';
import type { POSItem } from '@/hooks/usePOSItems';

const POS_ITEMS: POSItem[] = [
  {
    item_name: 'House Burger',
    item_id: 'pos-item-1',
    source: 'pos_sales',
    sales_count: 92,
    last_sold: '2026-07-20',
  },
  {
    item_name: 'Garden Salad',
    item_id: 'pos-item-2',
    source: 'unified_sales',
    sales_count: 41,
    last_sold: '2026-07-18',
  },
];

describe('SearchablePOSItemSelector — server-side search', () => {
  it('calls onSearchChange with the typed term instead of filtering locally', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <SearchablePOSItemSelector
        onValueChange={() => {}}
        posItems={POS_ITEMS}
        onSearchChange={onSearchChange}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText('Search POS items...'), 'burger');

    expect(onSearchChange).toHaveBeenLastCalledWith('burger');
  });

  it('renders every supplied item verbatim, even ones that do not match the typed text — the server is the filter now', async () => {
    const user = userEvent.setup();
    render(
      <SearchablePOSItemSelector
        onValueChange={() => {}}
        posItems={POS_ITEMS}
        onSearchChange={() => {}}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    // Type a term that matches neither item. A client-side filter (the old
    // `filteredItems` behavior) would hide both rows; the server-driven
    // component must keep rendering whatever `posItems` it was given,
    // because the parent is what re-fetches on search change.
    await user.type(screen.getByPlaceholderText('Search POS items...'), 'zzz-no-match-zzz');

    expect(screen.getByText('House Burger')).toBeInTheDocument();
    expect(screen.getByText('Garden Salad')).toBeInTheDocument();
  });
});

describe('SearchablePOSItemSelector — selected-value display fix', () => {
  it('renders the trigger value verbatim when it is absent from the current posItems page', () => {
    render(
      <SearchablePOSItemSelector
        value="Legacy Seasonal Special"
        onValueChange={() => {}}
        posItems={POS_ITEMS}
      />,
    );

    // The selected item may not be on the server's current top-N page.
    // Falling back to the placeholder here would silently blank out the
    // user's own selection.
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Legacy Seasonal Special');
    expect(trigger).not.toHaveTextContent('Search POS items or leave blank');
  });

  it('still renders the matched item name when the value is present in posItems', () => {
    render(
      <SearchablePOSItemSelector
        value="House Burger"
        onValueChange={() => {}}
        posItems={POS_ITEMS}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('House Burger');
  });
});

describe('SearchablePOSItemSelector — error empty-state', () => {
  it('renders a distinct failure message (not "no matches") when error is set, even with zero items', async () => {
    const user = userEvent.setup();
    render(
      <SearchablePOSItemSelector
        onValueChange={() => {}}
        posItems={[]}
        error={new Error('connection reset')}
      />,
    );

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText('No POS items found')).not.toBeInTheDocument();
    expect(
      screen.getByText(/couldn't load|failed to load|something went wrong/i),
    ).toBeInTheDocument();
  });

  it('renders the plain "no matches" empty state when there is no error', async () => {
    const user = userEvent.setup();
    render(
      <SearchablePOSItemSelector onValueChange={() => {}} posItems={[]} />,
    );

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText('No POS items found')).toBeInTheDocument();
    expect(
      screen.queryByText(/couldn't load|failed to load|something went wrong/i),
    ).not.toBeInTheDocument();
  });

  it('offers a retry affordance that calls onRetry when error is set', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <SearchablePOSItemSelector
        onValueChange={() => {}}
        posItems={[]}
        error={new Error('connection reset')}
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
