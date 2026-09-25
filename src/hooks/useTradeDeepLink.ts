import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useToast } from '@/hooks/use-toast';

import type { TradeDeepLinkItem, TradeLink, TradeLinkSource } from '@/lib/tradeDeepLink';

import { TRADE_LINK_PARAMS, decideTradeDeepLink, readTradeLink } from '@/lib/tradeDeepLink';

/** How long the highlight stays, unless the user scrolls first. */
const HIGHLIGHT_MS = 4000;

/** The virtualizer can need some frames to render the row. */
const MAX_FOCUS_FRAMES = 5;

type HighlightState = TradeLink & { handled: boolean };

export interface TradeDeepLinkOptions {
  items: readonly TradeDeepLinkItem[];
  /** The list, or the data it needs, is not ready yet. */
  loading: boolean;
  error: boolean;
  employeeLoading: boolean;
  /** The employee read failed. The hook then waits: the row can exist. */
  employeeError: boolean;
  hasEmployee: boolean;
  /** The scroll container of the list. */
  listRef: RefObject<HTMLElement>;
  virtualizer: { scrollToIndex: (index: number, options: { align: 'center' }) => void };
}

/**
 * Handle `?trade=<id>&restaurant=<id>&from=<source>` on the marketplace page.
 *
 * The hook copies the link into state and deletes its params from the URL.
 * Then it switches the restaurant, scrolls to the trade and focuses it, or
 * shows a toast when it cannot. The highlight clears after 4 s, or on the
 * first user scroll of the list.
 */
export function useTradeDeepLink({
  items,
  loading,
  error,
  employeeLoading,
  employeeError,
  hasEmployee,
  listRef,
  virtualizer,
}: TradeDeepLinkOptions): { highlightedTradeId: string | null; highlightSource: TradeLinkSource | null } {
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading: restaurantsLoading,
  } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id ?? null;
  const { toast } = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const [highlight, setHighlight] = useState<HighlightState | null>(() => {
    const link = readTradeLink(searchParams);
    return link ? { ...link, handled: false } : null;
  });

  // StrictMode runs each effect twice. These guards stop a second read of
  // the same params, and a second toast or scroll for the same link.
  const readParamsRef = useRef<URLSearchParams | null>(null);
  const finishedRef = useRef<HighlightState | null>(null);

  // Copy the link into state, then delete its params from the URL. A reload
  // or a back navigation must not replay the highlight or the toast.
  useEffect(() => {
    if (readParamsRef.current === searchParams) return;
    readParamsRef.current = searchParams;
    if (!TRADE_LINK_PARAMS.some((key) => searchParams.has(key))) return;
    const link = readTradeLink(searchParams);
    if (link) {
      setHighlight((prev) =>
        prev && !prev.handled && prev.tradeId === link.tradeId && prev.restaurantId === link.restaurantId
          ? prev
          : { ...link, handled: false }
      );
    }
    const next = new URLSearchParams(searchParams);
    TRADE_LINK_PARAMS.forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const memberRestaurantIds = useMemo(
    () => (restaurants ?? []).map((r) => r.restaurant_id),
    [restaurants]
  );

  const decision = decideTradeDeepLink({
    tradeId: highlight && !highlight.handled ? highlight.tradeId : null,
    linkRestaurantId: highlight?.restaurantId ?? null,
    selectedRestaurantId: restaurantId,
    memberRestaurantIds,
    restaurantsLoading: !!restaurantsLoading,
    // The row is missing only after a read for a known restaurant ends with
    // no error and no row. A read error is not proof that the row is missing.
    employeeMissing: !!restaurantId && !employeeLoading && !employeeError && !hasEmployee,
    // A directed trade shows only once the employee is known.
    loading: employeeLoading || !hasEmployee || loading,
    error,
    items,
  });
  const decisionKind = decision.kind;
  const scrollIndex = decision.kind === 'scroll' ? decision.index : -1;
  const switchRestaurantId = decision.kind === 'switch-restaurant' ? decision.restaurantId : null;

  useEffect(() => {
    if (!highlight || finishedRef.current === highlight) return;
    switch (decisionKind) {
      case 'switch-restaurant': {
        const match = (restaurants ?? []).find((r) => r.restaurant_id === switchRestaurantId);
        if (match) setSelectedRestaurant(match);
        return;
      }
      case 'foreign-restaurant':
        finishedRef.current = highlight;
        toast({ title: 'This shift is at a restaurant you cannot open.' });
        setHighlight(null);
        return;
      case 'gone':
        finishedRef.current = highlight;
        // RLS hides a trade from other employees once it leaves `open`, so
        // the copy does not name who took it.
        toast({
          title: 'That shift is no longer open',
          description: 'A teammate took it, or it was withdrawn. The shifts below are still open.',
        });
        setHighlight(null);
        return;
      case 'scroll': {
        const container = listRef.current;
        if (!container) return;
        finishedRef.current = highlight;
        // No smooth scroll: rows have dynamic height.
        container.scrollIntoView({ block: 'nearest' });
        virtualizer.scrollToIndex(scrollIndex, { align: 'center' });
        setHighlight((prev) => (prev ? { ...prev, handled: true } : prev));
        return;
      }
      default:
        return;
    }
  }, [
    highlight,
    decisionKind,
    scrollIndex,
    switchRestaurantId,
    restaurants,
    setSelectedRestaurant,
    toast,
    virtualizer,
    listRef,
  ]);

  // Focus the card root. The virtualizer can need some frames to render the
  // row, so try again on each frame, up to a limit.
  const focusTradeId = highlight?.handled ? highlight.tradeId : null;
  useEffect(() => {
    if (!focusTradeId) return;
    let frame = 0;
    let attempts = 0;
    const tryFocus = () => {
      const cards = listRef.current?.querySelectorAll<HTMLElement>('[data-trade-id]') ?? [];
      const target = Array.from(cards).find((el) => el.dataset.tradeId === focusTradeId);
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
      attempts += 1;
      if (attempts < MAX_FOCUS_FRAMES) frame = window.requestAnimationFrame(tryFocus);
    };
    frame = window.requestAnimationFrame(tryFocus);
    return () => window.cancelAnimationFrame(frame);
  }, [focusTradeId, listRef]);

  // Only wheel and touch count as a user scroll: the scroll to the trade
  // also fires `scroll`.
  useEffect(() => {
    if (!focusTradeId) return;
    const clear = () => setHighlight(null);
    const timer = window.setTimeout(clear, HIGHLIGHT_MS);
    const container = listRef.current;
    container?.addEventListener('wheel', clear, { passive: true });
    container?.addEventListener('touchmove', clear, { passive: true });
    return () => {
      window.clearTimeout(timer);
      container?.removeEventListener('wheel', clear);
      container?.removeEventListener('touchmove', clear);
    };
  }, [focusTradeId, listRef]);

  return {
    highlightedTradeId: highlight?.tradeId ?? null,
    highlightSource: highlight?.source ?? null,
  };
}
