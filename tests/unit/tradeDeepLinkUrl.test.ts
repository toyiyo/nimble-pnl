import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_PATH,
  TRADE_LINK_PARAMS,
  tradeLinkHref,
} from '../../supabase/functions/_shared/tradeDeepLinkUrl';

describe('tradeLinkHref (shared by the push and the home card)', () => {
  it('builds the marketplace link with the three params', () => {
    expect(tradeLinkHref('t1', 'r1', 'reminder')).toBe('/employee/shifts?trade=t1&restaurant=r1&from=reminder');
  });

  it('encodes the ids', () => {
    const href = tradeLinkHref('a b&c', 'r/1', 'home');
    const url = new URL(href, 'https://example.test');
    expect(url.pathname).toBe(MARKETPLACE_PATH);
    expect(url.searchParams.get('trade')).toBe('a b&c');
    expect(url.searchParams.get('restaurant')).toBe('r/1');
    expect(url.searchParams.get('from')).toBe('home');
  });

  it('uses only the params that the page deletes after it reads them', () => {
    const url = new URL(tradeLinkHref('t', 'r', 'home'), 'https://example.test');
    expect([...url.searchParams.keys()].sort()).toEqual([...TRADE_LINK_PARAMS].sort());
  });
});
