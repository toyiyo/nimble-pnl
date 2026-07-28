import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Fresh `QueryClientProvider` wrapper for hooks backed by React Query.
 *
 * Retries are disabled so a test that asserts an error state settles on the
 * first failure instead of waiting out the default retry/backoff schedule,
 * and each call gets its own `QueryClient` so cached data never leaks
 * between tests.
 */
export const createQueryWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { wrapper, queryClient };
};
