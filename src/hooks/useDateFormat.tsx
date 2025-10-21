import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { formatDateInTimezone } from '@/lib/timezone';

/**
 * Hook to format dates consistently using the restaurant's timezone
 */
export function useDateFormat() {
  const { selectedRestaurant } = useRestaurantContext();
  const timezone = selectedRestaurant?.restaurant?.timezone || 'America/Chicago';

  const formatTransactionDate = (date: string | Date, formatStr: string = 'MMM dd, yyyy') => {
    return formatDateInTimezone(date, timezone, formatStr);
  };

  return { formatTransactionDate, timezone };
}
