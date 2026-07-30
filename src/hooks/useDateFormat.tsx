import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { formatDateInTimezone } from '@/lib/timezone';
import { safeTz } from '@/lib/restaurantClock';

/**
 * Hook to format dates consistently using the restaurant's timezone
 */
export function useDateFormat() {
  const { selectedRestaurant } = useRestaurantContext();
  const timezone = safeTz(selectedRestaurant?.restaurant?.timezone);

  const formatTransactionDate = (date: string | Date, formatStr: string = 'MMM dd, yyyy') => {
    return formatDateInTimezone(date, timezone, formatStr);
  };

  return { formatTransactionDate, timezone };
}
