import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { useTradeDeepLink } from '@/hooks/useTradeDeepLink';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-1' },
    setSelectedRestaurant: vi.fn(),
    restaurants: [{ restaurant_id: 'rest-1' }],
    loading: false,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const ITEMS = [{ type: 'trade' as const, trade: { id: 't1' } }];
const VIRTUALIZER = { scrollToIndex: mocks.scrollToIndex };

function Harness() {
  const listRef = useRef<HTMLDivElement>(null);
  const { highlightedTradeId } = useTradeDeepLink({
    items: ITEMS,
    loading: false,
    error: false,
    employeeLoading: false,
    hasEmployee: true,
    listRef,
    virtualizer: VIRTUALIZER,
  });
  return <div ref={listRef} data-testid="list" data-highlight={highlightedTradeId ?? ''} />;
}

function nextFrame() {
  return act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
}

describe('useTradeDeepLink – focus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('tries again on later frames until the card exists', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/employee/shifts?trade=t1&restaurant=rest-1&from=home']}>
        <Harness />
      </MemoryRouter>,
    );
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(0, { align: 'center' });

    // The row is not in the DOM on the first frame.
    await nextFrame();

    const cardEl = document.createElement('div');
    cardEl.dataset.tradeId = 't1';
    cardEl.tabIndex = -1;
    getByTestId('list').appendChild(cardEl);

    await nextFrame();
    await nextFrame();
    expect(document.activeElement).toBe(cardEl);
  });
});
