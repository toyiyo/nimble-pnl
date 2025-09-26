import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';

export interface Product {
  id: string;
  restaurant_id: string;
  gtin?: string;
  sku: string;
  name: string;
  description?: string;
  brand?: string;
  category?: string;
  size_value?: number;
  size_unit?: string;
  package_qty?: number;
  uom_purchase?: string;
  uom_recipe?: string;
  conversion_factor?: number;
  cost_per_unit?: number;
  supplier_name?: string;
  supplier_sku?: string;
  par_level_min?: number;
  par_level_max?: number;
  current_stock?: number;
  reorder_point?: number;
  barcode_data?: any;
  image_url?: string;
  pos_item_name?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateProductData {
  restaurant_id: string;
  gtin?: string;
  sku: string;
  name: string;
  description?: string;
  brand?: string;
  category?: string;
  size_value?: number;
  size_unit?: string;
  package_qty?: number;
  uom_purchase?: string;
  uom_recipe?: string;
  conversion_factor?: number;
  cost_per_unit?: number;
  supplier_name?: string;
  supplier_sku?: string;
  par_level_min?: number;
  par_level_max?: number;
  current_stock?: number;
  reorder_point?: number;
  barcode_data?: any;
  image_url?: string;
  pos_item_name?: string;
}

export const useProducts = (restaurantId: string | null) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchProducts = useCallback(async () => {
    if (!restaurantId || !user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name');

      if (error) throw error;
      setProducts(data || []);
    } catch (error: any) {
      console.error('Error fetching products:', error);
      toast({
        title: "Error loading products",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, user, toast]);

  const createProduct = async (productData: CreateProductData): Promise<Product | null> => {
    if (!user) return null;

    try {
      const { data, error } = await supabase
        .from('products')
        .insert([productData])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Product created",
        description: `${productData.name} has been added to inventory`,
      });

      await fetchProducts();
      return data;
    } catch (error: any) {
      console.error('Error creating product:', error);
      toast({
        title: "Error creating product",
        description: error.message,
        variant: "destructive",
      });
      return null;
    }
  };

  const updateProduct = async (id: string, updates: Partial<CreateProductData>): Promise<boolean> => {
    if (!user) return false;

    try {
      const { error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Product updated",
        description: "Product information has been updated",
      });

      await fetchProducts();
      return true;
    } catch (error: any) {
      console.error('Error updating product:', error);
      toast({
        title: "Error updating product",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const findProductByGtin = useCallback(async (gtin: string): Promise<Product | null> => {
    if (!restaurantId || !gtin) return null;

    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('gtin', gtin)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows returned
      return data || null;
    } catch (error: any) {
      console.error('Error finding product by GTIN:', error);
      return null;
    }
  }, [restaurantId]);

  const findProductBySku = useCallback(async (sku: string): Promise<Product | null> => {
    if (!restaurantId || !sku) return null;

    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('sku', sku)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } catch (error: any) {
      console.error('Error finding product by SKU:', error);
      return null;
    }
  }, [restaurantId]);

  const deleteProduct = useCallback(async (id: string): Promise<boolean> => {
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to delete products",
        variant: "destructive",
      });
      return false;
    }

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting product:', error);
        toast({
          title: "Error",
          description: "Failed to delete product",
          variant: "destructive",
        });
        return false;
      }

      // Remove from local state
      setProducts(prev => prev.filter(p => p.id !== id));
      
      toast({
        title: "Product deleted",
        description: "Product has been permanently removed from inventory",
      });
      
      return true;
    } catch (error) {
      console.error('Error deleting product:', error);
      toast({
        title: "Error",
        description: "Failed to delete product",
        variant: "destructive",
      });
      return false;
    }
  }, [user, toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return {
    products,
    loading,
    createProduct,
    updateProduct,
    deleteProduct,
    findProductByGtin,
    findProductBySku,
    refetchProducts: fetchProducts,
  };
};