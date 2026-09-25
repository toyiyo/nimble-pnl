/**
 * The marketplace deep link: `/employee/shifts?trade=<id>&restaurant=<id>&from=<source>`.
 *
 * `from=reminder` marks a link from a push. `from=home` marks a link from
 * the home screen.
 * This module decides what the page does with the link. It has no React
 * code, so the rules are easy to test.
 */
import {
  MARKETPLACE_PATH,
  TRADE_LINK_PARAMS,
  tradeLinkHref,
  type TradeLinkSource,
} from '../../supabase/functions/_shared/tradeDeepLinkUrl';

// The push and the browser share one builder, so the two links cannot drift.
export { MARKETPLACE_PATH, TRADE_LINK_PARAMS, tradeLinkHref };
export type { TradeLinkSource };

export function parseTradeLinkSource(value: string | null | undefined): TradeLinkSource | null {
  return value === 'reminder' || value === 'home' ? value : null;
}

export interface TradeLink {
  tradeId: string;
  restaurantId: string | null;
  source: TradeLinkSource | null;
}

/** Read the link from the search params, or null when there is no `trade` param. */
export function readTradeLink(params: URLSearchParams): TradeLink | null {
  const tradeId = params.get('trade');
  if (!tradeId) return null;
  return {
    tradeId,
    restaurantId: params.get('restaurant') || null,
    source: parseTradeLinkSource(params.get('from')),
  };
}

export interface TradeDeepLinkItem {
  type: 'open_shift' | 'trade';
  trade?: { id: string } | null;
}

export interface TradeDeepLinkInput {
  /** The trade id from the link, or null when there is none (or it was handled). */
  tradeId: string | null;
  /** The restaurant id from the link. */
  linkRestaurantId: string | null;
  selectedRestaurantId: string | null;
  /** The restaurants the user is a member of. */
  memberRestaurantIds: readonly string[];
  /** The restaurant list is not known yet. */
  restaurantsLoading: boolean;
  /** The employee load finished, and the user has no employee row here. */
  employeeMissing: boolean;
  /** The list (or the employee) is not ready yet. */
  loading: boolean;
  error: boolean;
  items: readonly TradeDeepLinkItem[];
}

export type TradeDeepLinkDecision =
  | { kind: 'none' }
  | { kind: 'wait' }
  | { kind: 'switch-restaurant'; restaurantId: string }
  | { kind: 'foreign-restaurant' }
  | { kind: 'scroll'; index: number }
  | { kind: 'gone' };

export function decideTradeDeepLink(input: TradeDeepLinkInput): TradeDeepLinkDecision {
  if (!input.tradeId) return { kind: 'none' };

  // The restaurant check comes first. The list of another restaurant can
  // never hold the trade, so a "gone" toast there would be false.
  const wanted = input.linkRestaurantId;
  if (wanted && wanted !== input.selectedRestaurantId) {
    if (input.restaurantsLoading) return { kind: 'wait' };
    return input.memberRestaurantIds.includes(wanted)
      ? { kind: 'switch-restaurant', restaurantId: wanted }
      : { kind: 'foreign-restaurant' };
  }

  // Without an employee row the user cannot open this marketplace.
  if (input.employeeMissing) return { kind: 'foreign-restaurant' };

  // On an error the page shows its error state. The trade can still be open.
  if (input.loading || input.error) return { kind: 'wait' };

  const index = input.items.findIndex(
    (item) => item.type === 'trade' && item.trade?.id === input.tradeId
  );
  return index >= 0 ? { kind: 'scroll', index } : { kind: 'gone' };
}
