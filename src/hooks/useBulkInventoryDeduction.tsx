import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface BulkProcessResult {
  processed: number;
  skipped: number;
  errors: number;
  total: number;
}

export const useBulkInventoryDeduction = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const bulkProcessHistoricalSales = useCallback(async (
    restaurantId: string,
    startDate: string,
    endDate: string
  ): Promise<BulkProcessResult | null> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('bulk_process_historical_sales', {
        p_restaurant_id: restaurantId,
        p_start_date: startDate,
        p_end_date: endDate
      });

      if (error) throw error;

      const result = data as unknown as BulkProcessResult;
      
      toast({
        title: "Bulk Processing Complete",
        description: `Processed ${result.processed} sales, skipped ${result.skipped} (already processed or no recipe), ${result.errors} errors.`,
      });

      return result;
    } catch (error: any) {
      console.error('Error bulk processing sales:', error);
      toast({
        title: "Bulk processing failed",
        description: error.message,
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return {
    loading,
    bulkProcessHistoricalSales,
  };
};
