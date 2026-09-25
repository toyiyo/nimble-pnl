import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useClaimableTrades } from '@/hooks/useClaimableTrades';

/**
 * The claimable trade count for a nav badge.
 *
 * With no restaurant or no employee row, the trades query stays off.
 */
export function useClaimableTradeBadge(): { count: number; hasUrgentTrade: boolean } {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id ?? null;
  const { currentEmployee } = useCurrentEmployee(restaurantId);
  const { trades, count, loading, error } = useClaimableTrades(restaurantId, currentEmployee?.id ?? null);

  // The badge shows nothing until the data is sure. A wrong count is worse
  // than no count.
  if (loading || error) return { count: 0, hasUrgentTrade: false };
  return { count, hasUrgentTrade: trades.some((t) => t.urgent) };
}
