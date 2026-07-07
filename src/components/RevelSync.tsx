import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useRevelConnection } from '@/hooks/useRevelConnection';

interface RevelSyncProps {
  restaurantId: string;
}

export const RevelSync = ({ restaurantId }: RevelSyncProps) => {
  const [syncing, setSyncing] = useState(false);
  const { triggerManualSync } = useRevelConnection(restaurantId);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await triggerManualSync(restaurantId);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="w-full" onClick={handleSync} disabled={syncing}>
      {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
      {syncing ? 'Syncing...' : 'Sync now'}
    </Button>
  );
};
