import { useState, useEffect, useCallback } from 'react';
import { useSquareSalesAdapter } from './adapters/useSquareSalesAdapter';
import { POSAdapter, POSIntegrationStatus, POSSystemType } from '@/types/pos';

export const usePOSIntegrations = (restaurantId: string | null) => {
  const [adapters, setAdapters] = useState<Partial<Record<POSSystemType, POSAdapter>>>({});
  const [integrationStatuses, setIntegrationStatuses] = useState<POSIntegrationStatus[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Initialize adapters
  const squareAdapter = useSquareSalesAdapter(restaurantId);

  useEffect(() => {
    const adapterMap: Partial<Record<POSSystemType, POSAdapter>> = {
      square: squareAdapter,
      // Future adapters will be added here:
      // toast: useToastSalesAdapter(restaurantId),
      // clover: useCloverSalesAdapter(restaurantId),
      // resy: useResySalesAdapter(restaurantId),
      manual: {
        system: 'manual',
        isConnected: true,
        fetchSales: async () => [],
        syncToUnified: async () => 0,
        getIntegrationStatus: () => ({
          system: 'manual',
          isConnected: true,
          isConfigured: true,
        }),
      },
    };

    setAdapters(adapterMap as Record<POSSystemType, POSAdapter>);

    // Update integration statuses
    const statuses = Object.values(adapterMap).filter(Boolean).map(adapter => 
      adapter!.getIntegrationStatus()
    );
    setIntegrationStatuses(statuses);
  }, [squareAdapter]);

  const getConnectedSystems = useCallback((): POSSystemType[] => {
    return integrationStatuses
      .filter(status => status.isConnected)
      .map(status => status.system);
  }, [integrationStatuses]);

  const syncAllSystems = useCallback(async (): Promise<number> => {
    if (!restaurantId) return 0;

    setIsSyncing(true);
    let totalSynced = 0;

    try {
      const connectedSystems = getConnectedSystems();
      
      for (const systemType of connectedSystems) {
        const adapter = adapters[systemType];
        if (adapter && systemType !== 'manual') {
          const synced = await adapter.syncToUnified(restaurantId);
          totalSynced += synced;
        }
      }

      return totalSynced;
    } finally {
      setIsSyncing(false);
    }
  }, [restaurantId, adapters, getConnectedSystems]);

  const syncSpecificSystem = useCallback(async (system: POSSystemType): Promise<number> => {
    if (!restaurantId) return 0;

    const adapter = adapters[system];
    if (!adapter || !adapter.isConnected) return 0;

    setIsSyncing(true);
    try {
      return await adapter.syncToUnified(restaurantId);
    } finally {
      setIsSyncing(false);
    }
  }, [restaurantId, adapters]);

  const hasAnyConnectedSystem = useCallback((): boolean => {
    return integrationStatuses.some(status => status.isConnected);
  }, [integrationStatuses]);

  return {
    adapters,
    integrationStatuses,
    isSyncing,
    getConnectedSystems,
    syncAllSystems,
    syncSpecificSystem,
    hasAnyConnectedSystem,
  };
};