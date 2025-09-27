import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface InventorySettings {
  id?: string;
  restaurant_id: string;
  default_markup_multiplier: number;
  markup_by_category: Record<string, number>;
  created_at?: string;
  updated_at?: string;
}

interface UseInventorySettingsReturn {
  settings: InventorySettings | null;
  loading: boolean;
  updateSettings: (settings: Partial<InventorySettings>) => Promise<void>;
  getMarkupForCategory: (category?: string) => number;
}

export const useInventorySettings = (restaurantId: string | null): UseInventorySettingsReturn => {
  const [settings, setSettings] = useState<InventorySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchSettings = async () => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('restaurant_inventory_settings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching inventory settings:', error);
        toast({
          title: "Error",
          description: "Failed to load inventory settings",
          variant: "destructive"
        });
        return;
      }

      if (data) {
        setSettings({
          ...data,
          markup_by_category: (data.markup_by_category as Record<string, number>) || {}
        });
      } else {
        // Create default settings if none exist
        const defaultSettings: Omit<InventorySettings, 'id' | 'created_at' | 'updated_at'> = {
          restaurant_id: restaurantId,
          default_markup_multiplier: 2.5,
          markup_by_category: {}
        };

        const { data: newSettings, error: createError } = await supabase
          .from('restaurant_inventory_settings')
          .insert(defaultSettings)
          .select()
          .single();

        if (createError) {
          console.error('Error creating default settings:', createError);
        } else {
          setSettings({
            ...newSettings,
            markup_by_category: (newSettings.markup_by_category as Record<string, number>) || {}
          });
        }
      }
    } catch (error) {
      console.error('Error in fetchSettings:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async (newSettings: Partial<InventorySettings>) => {
    if (!restaurantId || !settings) return;

    try {
      const { data, error } = await supabase
        .from('restaurant_inventory_settings')
        .update(newSettings)
        .eq('restaurant_id', restaurantId)
        .select()
        .single();

      if (error) {
        console.error('Error updating settings:', error);
        toast({
          title: "Error",
          description: "Failed to update settings",
          variant: "destructive"
        });
        return;
      }

      setSettings({
        ...data,
        markup_by_category: (data.markup_by_category as Record<string, number>) || {}
      });
      toast({
        title: "Settings Updated",
        description: "Inventory settings have been saved successfully"
      });
    } catch (error) {
      console.error('Error in updateSettings:', error);
    }
  };

  const getMarkupForCategory = (category?: string): number => {
    if (!settings) return 2.5; // Default fallback
    
    if (category && settings.markup_by_category[category]) {
      return settings.markup_by_category[category];
    }
    
    return settings.default_markup_multiplier;
  };

  useEffect(() => {
    fetchSettings();
  }, [restaurantId]);

  return {
    settings,
    loading,
    updateSettings,
    getMarkupForCategory
  };
};