import { useState, useEffect, useCallback } from 'react';
import { useSquareSalesAdapter } from './adapters/useSquareSalesAdapter';
import { useCloverSalesAdapter } from './adapters/useCloverSalesAdapter';
import { useToastSalesAdapter } from './adapters/useToastSalesAdapter';
import { useShift4SalesAdapter } from './adapters/useShift4SalesAdapter';
import { POSAdapter, POSIntegrationStatus, POSSystemType } from '@/types/pos';

export const usePOSIntegrations = (restaurantId: string | null) => {
  const [adapters, setAdapters] = useState<Partial<Record<POSSystemType, POSAdapter>>>({});
  const [integrationStatuses, setIntegrationStatuses] = useState<POSIntegrationStatus[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Initialize adapters
  const squareAdapter = useSquareSalesAdapter(restaurantId);
  const cloverAdapter = useCloverSalesAdapter(restaurantId);
  const toastAdapter = useToastSalesAdapter(restaurantId);
  const shift4Adapter = useShift4SalesAdapter(restaurantId);

  // Use useMemo to stabilize the manual adapter object
  const manualAdapter = useCallback(() => ({
    system: 'manual' as POSSystemType,
    isConnected: true,
    fetchSales: async () => [],
    syncToUnified: async () => 0,
    getIntegrationStatus: () => ({
      system: 'manual' as POSSystemType,
      isConnected: true,
      isConfigured: true,
    }),
  }), []);

  // Build adapters map once when restaurant changes or adapter connection status changes
  useEffect(() => {
    const adapterMap: Partial<Record<POSSystemType, POSAdapter>> = {
      square: squareAdapter,
      clover: cloverAdapter,
      toast: toastAdapter,
      shift4: shift4Adapter,
      // Future adapters will be added here:
      // resy: useResySalesAdapter(restaurantId),
      manual: manualAdapter(),
    };

    setAdapters(adapterMap as Record<POSSystemType, POSAdapter>);

    // Update integration statuses
    const statuses = Object.values(adapterMap).filter(Boolean).map(adapter => 
      adapter!.getIntegrationStatus()
    );
    setIntegrationStatuses(statuses);
  }, [
    restaurantId,
    squareAdapter.isConnected,
    cloverAdapter.isConnected,
    toastAdapter.isConnected,
    manualAdapter
  ]);

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