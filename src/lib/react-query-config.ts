import { Query, QueryClientConfig } from "@tanstack/react-query";

export const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Don't retry 404s
        if (error?.status === 404 || error?.message?.includes('404')) return false;

        // Retry auth errors (401/403 or specific JWT messages) up to 2 times
        // This handles race conditions where proactive refresh hasn't completed
        if (
          error?.status === 401 || 
          error?.status === 403 || 
          error?.message?.includes('JWT expired') ||
          error?.code === 'PGRST303'
        ) {
          return failureCount < 2;
        }
        // Default retry for other errors
        return failureCount < 3;
      },
      retryDelay: (attemptIndex, error: any) => {
        // Shorter delay for auth errors to allow token refresh to complete
        if (
             error?.message?.includes('JWT expired') ||
             error?.code === 'PGRST303'
        ) {
             return 1000; // Wait 1s for token refresh
        }
        return Math.min(1000 * 2 ** attemptIndex, 30000);
      },
      staleTime: 30000, // 30 seconds
      refetchOnWindowFocus: true,
    },
  },
};

/**
 * A `placeholderData` function for React Query. Keeps the previous period's
 * data on screen during a refetch, but never across a restaurant switch.
 * Assumes the query key's second element (`queryKey[1]`) is the restaurant id.
 */
export function keepDataUnlessRestaurantChanged<TData>(restaurantId: string | null) {
  return (previousData: TData | undefined, previousQuery: Query | undefined): TData | undefined =>
    previousQuery && previousQuery.queryKey[1] !== restaurantId ? undefined : previousData;
}
