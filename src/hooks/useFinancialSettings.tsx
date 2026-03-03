import { useState, useEffect } from 'react';

import { useToast } from '@/hooks/use-toast';

import { supabase } from '@/integrations/supabase/client';

export type COGSMethod = 'inventory' | 'financials' | 'combined';

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

  const fetchSettings = async () => {
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
        setSettings(data as FinancialSettings);
      } else {
        // Create default settings if none exist
        const defaultSettings = {
          restaurant_id: restaurantId,
          cogs_calculation_method: 'inventory' as COGSMethod,
        };

        const { data: newSettings, error: createError } = await supabase
          .from('restaurant_financial_settings')
          .insert(defaultSettings)
          .select()
          .single();

        if (createError) {
          console.error('Error creating default financial settings:', createError);
        } else {
          setSettings(newSettings as FinancialSettings);
        }
      }
    } catch (error) {
      console.error('Error in fetchSettings:', error);
    } finally {
      setIsLoading(false);
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

      setSettings(data as FinancialSettings);
      toast({
        title: 'Settings Updated',
        description: 'Financial settings have been saved successfully',
      });
    } catch (error) {
      console.error('Error in updateSettings:', error);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [restaurantId]);

  return {
    settings,
    cogsMethod: settings?.cogs_calculation_method ?? 'inventory',
    isLoading,
    updateSettings,
  };
};
