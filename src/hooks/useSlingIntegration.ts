import { useSlingConnection } from '@/hooks/useSlingConnection';

export const useSlingIntegration = (restaurantId: string | null) => {
  const {
    isConnected,
    connection,
    loading,
    disconnectSling,
  } = useSlingConnection(restaurantId);

  return {
    isConnected,
    isConnecting: loading,
    connection,
    disconnectSling: async () => {
      if (restaurantId) {
        await disconnectSling(restaurantId);
      }
    },
    checkConnectionStatus: () => {
      // No-op: React Query auto-refetches on window focus
    },
  };
};
