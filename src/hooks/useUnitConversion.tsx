import { useState, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { supabase } from '@/integrations/supabase/client';

// Standard conversion factors for common units
const STANDARD_CONVERSIONS: Record<string, Record<string, number>> = {
  // Volume conversions
  'cup': { 'oz': 8, 'ml': 236.588, 'tbsp': 16, 'tsp': 48 },
  'oz': { 'cup': 0.125, 'ml': 29.5735, 'tbsp': 2, 'tsp': 6 },
  'tbsp': { 'cup': 0.0625, 'oz': 0.5, 'tsp': 3, 'ml': 14.7868 },
  'tsp': { 'cup': 0.020833, 'oz': 0.166667, 'tbsp': 0.333333, 'ml': 4.92892 },
  'ml': { 'cup': 0.004227, 'oz': 0.033814, 'tbsp': 0.067628, 'tsp': 0.202884 },
  'gallon': { 'oz': 128, 'cup': 16, 'ml': 3785.41, 'quart': 4 },
  'quart': { 'oz': 32, 'cup': 4, 'ml': 946.353, 'gallon': 0.25 },
  
  // Weight conversions  
  'lb': { 'oz': 16, 'g': 453.592, 'kg': 0.453592 },
  'kg': { 'lb': 2.20462, 'g': 1000, 'oz': 35.274 },
  'g': { 'lb': 0.00220462, 'kg': 0.001, 'oz': 0.035274 }
};

export function useUnitConversion(restaurantId: string | null) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  
  const getConversionFactor = useCallback((
    fromUnit: string,
    toUnit: string
  ): number => {
    if (fromUnit === toUnit) return 1;
    
    // Normalize units to lowercase for matching
    const from = fromUnit.toLowerCase().trim();
    const to = toUnit.toLowerCase().trim();
    
    // Check direct conversion
    if (STANDARD_CONVERSIONS[from]?.[to]) {
      return STANDARD_CONVERSIONS[from][to];
    }
    
    // Check inverse conversion
    if (STANDARD_CONVERSIONS[to]?.[from]) {
      return 1 / STANDARD_CONVERSIONS[to][from];
    }
    
    // No standard conversion found, return 1:1
    return 1;
  }, []);
  
  const updateProductConversion = useCallback(async (
    productId: string,
    conversionFactor: number
  ) => {
    try {
      setLoading(true);
      
      const { error } = await supabase
        .from('products')
        .update({ conversion_factor: conversionFactor })
        .eq('id', productId);
        
      if (error) throw error;
      
      toast({
        title: "Conversion updated",
        description: "Product conversion factor has been updated successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error updating conversion",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [toast]);
  
  const suggestConversionFactor = useCallback((
    purchaseUnit: string,
    recipeUnit: string
  ): number => {
    return getConversionFactor(purchaseUnit, recipeUnit);
  }, [getConversionFactor]);
  
  return {
    loading,
    getConversionFactor,
    updateProductConversion,
    suggestConversionFactor
  };
}