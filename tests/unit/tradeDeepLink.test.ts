import { describe, it, expect } from 'vitest';

import {
  TRADE_LINK_PARAMS,
  decideTradeDeepLink,
  parseTradeLinkSource,
  readTradeLink,
  tradeLinkHref,
  type TradeDeepLinkInput,
} from '@/lib/tradeDeepLink';

const items = [
  { type: 'open_shift' as const },
  { type: 'trade' as const, trade: { id: 'trade-a' } },
  { type: 'trade' as const, trade: { id: 'trade-b' } },
];

const base: TradeDeepLinkInput = {
  tradeId: 'trade-b',
  linkRestaurantId: 'rest-1',
  selectedRestaurantId: 'rest-1',
  memberRestaurantIds: ['rest-1', 'rest-2'],
  restaurantsLoading: false,
  loading: false,
  error: false,
  items,
};

describe('parseTradeLinkSource', () => {
  it('parses "reminder" and "home"', () => {
    expect(parseTradeLinkSource('reminder')).toBe('reminder');
    expect(parseTradeLinkSource('home')).toBe('home');
  });

  it('returns null for a missing or unknown value', () => {
    expect(parseTradeLinkSource(null)).toBeNull();
    expect(parseTradeLinkSource('')).toBeNull();
    expect(parseTradeLinkSource('email')).toBeNull();
    expect(parseTradeLinkSource('HOME')).toBeNull();
  });
});

describe('tradeLinkHref', () => {
  it('builds the marketplace link with the trade, the restaurant and the source', () => {
    expect(tradeLinkHref('trade-a', 'rest-1', 'home')).toBe(
      '/employee/shifts?trade=trade-a&restaurant=rest-1&from=home'
    );
  });

  it('encodes the ids', () => {
    expect(tradeLinkHref('a b', 'r&1', 'reminder')).toBe(
      '/employee/shifts?trade=a%20b&restaurant=r%261&from=reminder'
    );
  });

  it('gives a link that readTradeLink reads back', () => {
    const href = tradeLinkHref('a b', 'r&1', 'home');
    const params = new URLSearchParams(href.slice(href.indexOf('?')));
    expect(readTradeLink(params)).toEqual({ tradeId: 'a b', restaurantId: 'r&1', source: 'home' });
  });
});

describe('readTradeLink', () => {
  it('reads the trade, the restaurant and the source', () => {
    expect(readTradeLink(new URLSearchParams('trade=t1&restaurant=r1&from=home'))).toEqual({
      tradeId: 't1',
      restaurantId: 'r1',
      source: 'home',
    });
  });

  it('returns null without a trade param', () => {
    expect(readTradeLink(new URLSearchParams('restaurant=r1&from=home'))).toBeNull();
    expect(readTradeLink(new URLSearchParams('trade='))).toBeNull();
  });

  it('keeps a trade without a restaurant or a known source', () => {
    expect(readTradeLink(new URLSearchParams('trade=t1&from=sms'))).toEqual({
      tradeId: 't1',
      restaurantId: null,
      source: null,
    });
  });

  it('names the three params that the page deletes', () => {
    expect([...TRADE_LINK_PARAMS]).toEqual(['trade', 'restaurant', 'from']);
  });
});

describe('decideTradeDeepLink', () => {
  it('does nothing without a trade id', () => {
    expect(decideTradeDeepLink({ ...base, tradeId: null })).toEqual({ kind: 'none' });
  });

  it('scrolls to the index of the trade in the items', () => {
    expect(decideTradeDeepLink(base)).toEqual({ kind: 'scroll', index: 2 });
  });

  it('reports "gone" when the trade is not in the items', () => {
    expect(decideTradeDeepLink({ ...base, tradeId: 'trade-x' })).toEqual({ kind: 'gone' });
  });

  it('reports "gone" for an empty list', () => {
    expect(decideTradeDeepLink({ ...base, items: [] })).toEqual({ kind: 'gone' });
  });

  it('does not match an open shift', () => {
    expect(
      decideTradeDeepLink({ ...base, tradeId: 'trade-a', items: [{ type: 'open_shift' }] }),
    ).toEqual({ kind: 'gone' });
  });

  it('waits while the list loads', () => {
    expect(decideTradeDeepLink({ ...base, loading: true })).toEqual({ kind: 'wait' });
    expect(decideTradeDeepLink({ ...base, tradeId: 'trade-x', loading: true })).toEqual({ kind: 'wait' });
  });

  it('waits on an error, so the page error state shows and no "gone" toast', () => {
    expect(decideTradeDeepLink({ ...base, tradeId: 'trade-x', error: true })).toEqual({ kind: 'wait' });
  });

  it('switches to a different restaurant that the user is a member of', () => {
    expect(decideTradeDeepLink({ ...base, linkRestaurantId: 'rest-2', loading: true })).toEqual({
      kind: 'switch-restaurant',
      restaurantId: 'rest-2',
    });
  });

  it('reports a foreign restaurant that the user is not a member of', () => {
    expect(decideTradeDeepLink({ ...base, linkRestaurantId: 'rest-9' })).toEqual({
      kind: 'foreign-restaurant',
    });
  });

  it('waits for the restaurant list before it decides membership', () => {
    expect(
      decideTradeDeepLink({ ...base, linkRestaurantId: 'rest-9', restaurantsLoading: true }),
    ).toEqual({ kind: 'wait' });
  });

  it('checks the restaurant before the list state', () => {
    expect(decideTradeDeepLink({ ...base, linkRestaurantId: 'rest-9', error: true })).toEqual({
      kind: 'foreign-restaurant',
    });
  });

  it('uses the selected restaurant when the link has no restaurant', () => {
    expect(decideTradeDeepLink({ ...base, linkRestaurantId: null })).toEqual({ kind: 'scroll', index: 2 });
  });

  it('switches when no restaurant is selected yet and the user is a member', () => {
    expect(decideTradeDeepLink({ ...base, selectedRestaurantId: null })).toEqual({
      kind: 'switch-restaurant',
      restaurantId: 'rest-1',
    });
  });
});
