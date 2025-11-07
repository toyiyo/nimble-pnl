import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Download, AlertCircle, CheckCircle2, Zap } from 'lucide-react';

interface ToastSyncProps {
  restaurantId: string;
  isConnected: boolean;
}

interface SyncResult {
  ordersSynced: number;
  errors: string[];
}

export const ToastSync = ({ restaurantId, isConnected }: ToastSyncProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncType, setSyncType] = useState<'initial_sync' | 'daily_sync' | 'hourly_sync'>('initial_sync');
  const { toast } = useToast();

  const handleSync = async (action: 'initial_sync' | 'daily_sync' | 'hourly_sync', dateRange?: { startDate: string; endDate: string }) => {
    if (!isConnected) {
      toast({
        title: "Error",
        description: "Please connect to Toast POS first",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setSyncResult(null);
    setSyncType(action);

    try {
      const { data, error } = await supabase.functions.invoke('toast-sync-data', {
        body: {
          restaurantId,
          action,
          ...(dateRange && { dateRange })
        }
      });

      if (error) {
        throw error;
      }

      if (data?.results) {
        setSyncResult(data.results);
        
        const totalSynced = data.results.ordersSynced;
        
        toast({
          title: "Sync Complete",
          description: `Successfully synced ${totalSynced} orders from Toast POS`,
        });
      }
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: "Sync Failed",
        description: error instanceof Error ? error.message : "Failed to sync data from Toast POS",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleHistoricalSync = () => {
    handleSync('initial_sync');
  };

  const handleDailySync = () => {
    handleSync('daily_sync');
  };

  if (!isConnected) {
    return null;
  }

  return (
    <Card className="mt-4 bg-gradient-to-br from-orange-500/5 to-transparent">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-orange-500" />
          <CardTitle className="text-base">Data Sync</CardTitle>
        </div>
        <CardDescription>
          Sync orders and sales from Toast POS
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sync Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleHistoricalSync}
            disabled={isLoading}
            className="w-full"
          >
            <Download className="h-3 w-3 mr-2" />
            {isLoading && syncType === 'initial_sync' ? 'Syncing...' : 'Full Sync (90 days)'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDailySync}
            disabled={isLoading}
            className="w-full"
          >
            <RefreshCw className={`h-3 w-3 mr-2 ${isLoading && syncType === 'daily_sync' ? 'animate-spin' : ''}`} />
            {isLoading && syncType === 'daily_sync' ? 'Syncing...' : 'Daily Sync'}
          </Button>
        </div>

        {/* Sync Results */}
        {syncResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">
                Synced {syncResult.ordersSynced} orders
              </span>
            </div>

            {syncResult.errors && syncResult.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {syncResult.errors.length} error(s) occurred:
                  <ul className="mt-2 list-disc list-inside">
                    {syncResult.errors.slice(0, 3).map((error, i) => (
                      <li key={i} className="text-xs">{error}</li>
                    ))}
                    {syncResult.errors.length > 3 && (
                      <li className="text-xs">...and {syncResult.errors.length - 3} more</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Real-time Webhook Status */}
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Real-time Updates</span>
            <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse" />
              Active
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Webhooks automatically sync new orders in real-time
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
