import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';

export function useFixServiceDates() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fixServiceDates = async (restaurantId: string) => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase.functions.invoke('fix-service-dates', {
        body: { restaurantId }
      });

      if (error) throw error;

      const results = data.results;
      
      toast({
        title: "Service dates fixed!",
        description: `Updated ${results.ordersFixed} orders and ${results.shiftsFixed} shifts. Recalculated ${results.datesRecalculated} dates.`,
      });

      return results;
    } catch (error: any) {
      toast({
        title: "Error fixing service dates",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    fixServiceDates,
    loading
  };
}