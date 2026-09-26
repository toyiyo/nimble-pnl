/**
 * One builder for the marketplace deep link:
 * `/employee/shifts?trade=<id>&restaurant=<id>&from=<source>`.
 *
 * The reminder push (edge function) and the home card (browser) both import
 * this file, so the two links cannot drift. Keep it pure: no Deno imports and
 * no browser APIs other than `URLSearchParams`.
 */

export const MARKETPLACE_PATH = '/employee/shifts';

/** The search params of the link. The marketplace page deletes them after it reads them. */
export const TRADE_LINK_PARAMS = ['trade', 'restaurant', 'from'] as const;

export type TradeLinkSource = 'reminder' | 'home';

export function tradeLinkHref(tradeId: string, restaurantId: string, source: TradeLinkSource): string {
  const query = new URLSearchParams({ trade: tradeId, restaurant: restaurantId, from: source });
  return `${MARKETPLACE_PATH}?${query.toString()}`;
}
