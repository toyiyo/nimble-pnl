import { useState, useEffect } from 'react';

import { useToast } from '@/hooks/use-toast';

import { supabase } from '@/integrations/supabase/client';
import { normalizeCOGSMethod, type COGSMethod } from '@/lib/cogsMethod';

// A legacy row can still hold 'combined' until the migration runs.
const normalizeRow = (row: unknown): FinancialSettings => {
  const record = row as FinancialSettings;
  return {
    ...record,
    cogs_calculation_method: normalizeCOGSMethod(record.cogs_calculation_method),
  };
};

export interface FinancialSettings {
  id?: string;
  restaurant_id: string;
  cogs_calculation_method: COGSMethod;
  created_at?: string;
  updated_at?: string;
}

export interface UseFinancialSettingsReturn {
  settings: FinancialSettings | null;
  cogsMethod: COGSMethod;
  isLoading: boolean;
  updateSettings: (updates: { cogs_calculation_method: COGSMethod }) => Promise<void>;
}

export const useFinancialSettings = (
  restaurantId: string | undefined | null,
): UseFinancialSettingsReturn => {
  const [settings, setSettings] = useState<FinancialSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  // isCancelled is true once restaurantId changes or the component unmounts.
  // A late result for the old restaurant must not overwrite the new one.
  const fetchSettings = async (isCancelled: () => boolean) => {
    if (!restaurantId) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('restaurant_financial_settings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (isCancelled()) return;

      if (error) {
        console.error('Error fetching financial settings:', error);
        toast({
          title: 'Error',
          description: 'Failed to load financial settings',
          variant: 'destructive',
        });
        return;
      }

      if (data) {
        setSettings(normalizeRow(data));
      } else {
        // Create default settings if none exist
        const defaultSettings = {
          restaurant_id: restaurantId,
          cogs_calculation_method: 'inventory' as COGSMethod,
        };

        // Several components mount this hook at the same time. ON CONFLICT DO
        // NOTHING stops the losers from failing with 23505 on restaurant_id.
        // Read the result as an array: on a POST, maybeSingle() asks for one
        // object, and PostgREST answers 406 when the insert skips the row.
        const { data: inserted, error: createError } = await supabase
          .from('restaurant_financial_settings')
          .upsert(defaultSettings, { onConflict: 'restaurant_id', ignoreDuplicates: true })
          .select();

        if (createError) {
          console.error('Error creating default financial settings:', createError);
          return;
        }

        if (isCancelled()) return;

        if (inserted?.length) {
          setSettings(normalizeRow(inserted[0]));
          return;
        }

        // Another hook inserted the row first. Read that row.
        const { data: existing, error: refetchError } = await supabase
          .from('restaurant_financial_settings')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .maybeSingle();

        if (isCancelled()) return;

        if (refetchError) {
          console.error('Error fetching financial settings:', refetchError);
        } else if (existing) {
          setSettings(normalizeRow(existing));
        }
      }
    } catch (error) {
      console.error('Error in fetchSettings:', error);
    } finally {
      if (!isCancelled()) setIsLoading(false);
    }
  };

  const updateSettings = async (updates: {
    cogs_calculation_method: COGSMethod;
  }) => {
    if (!restaurantId || !settings) return;

    try {
      const { data, error } = await supabase
        .from('restaurant_financial_settings')
        .update(updates)
        .eq('restaurant_id', restaurantId)
        .select()
        .single();

      if (error) {
        console.error('Error updating financial settings:', error);
        toast({
          title: 'Error',
          description: 'Failed to update settings',
          variant: 'destructive',
        });
        return;
      }

      setSettings(normalizeRow(data));
      toast({
        title: 'Settings Updated',
        description: 'Financial settings have been saved successfully',
      });
    } catch (error) {
      console.error('Error in updateSettings:', error);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchSettings(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return {
    settings,
    cogsMethod: normalizeCOGSMethod(settings?.cogs_calculation_method),
    isLoading,
    updateSettings,
  };
};
