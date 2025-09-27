import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useInventoryAudit } from '@/hooks/useInventoryAudit';

export interface Product {
  id: string;
  restaurant_id: string;
  gtin?: string;
  sku: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  package_qty?: number | null;
  uom_purchase?: string | null;
  uom_recipe?: string | null;
  conversion_factor?: number | null;
  cost_per_unit?: number | null;
  current_stock?: number | null;
  par_level_min?: number | null;
  par_level_max?: number | null;
  reorder_point?: number | null;
  supplier_name?: string | null;
  supplier_sku?: string | null;
  pos_item_name?: string | null;
  image_url?: string | null;
  barcode_data?: any | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProductData {
  restaurant_id: string;
  gtin?: string;
  sku: string;
  name: string;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  package_qty?: number | null;
  uom_purchase?: string | null;
  uom_recipe?: string | null;
  conversion_factor?: number | null;
  cost_per_unit?: number | null;
  current_stock?: number | null;
  par_level_min?: number | null;
  par_level_max?: number | null;
  reorder_point?: number | null;
  supplier_name?: string | null;
  supplier_sku?: string | null;
  pos_item_name?: string | null;
  image_url?: string | null;
  barcode_data?: any | null;
}

export const useProducts = (restaurantId: string | null) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { logPurchase } = useInventoryAudit();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProducts = useCallback(async () => {
    if (!restaurantId || !user) {
      setProducts([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name', { ascending: true });

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

      // Log initial stock as purchase if there's stock being added
      if (data && (productData.current_stock || 0) > 0) {
        await logPurchase(
          data.restaurant_id,
          data.id,
          productData.current_stock || 0,
          productData.cost_per_unit || 0,
          `Initial stock for new product: ${productData.name}`,
          `product_create_${data.id}`
        );
      }

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

  const updateProductWithQuantity = async (
    id: string, 
    updates: Partial<CreateProductData>, 
    quantityToAdd: number = 0
  ): Promise<boolean> => {
    if (!user || !restaurantId) return false;

    try {
      // Get current product data for comparison
      const { data: currentProduct, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      const oldStock = currentProduct.current_stock || 0;
      const newStock = oldStock + quantityToAdd;

      // Update the product with new stock level
      const updatedData = {
        ...updates,
        current_stock: newStock,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('products')
        .update(updatedData)
        .eq('id', id);

      if (error) throw error;

      // Log inventory transaction if quantity was added
      if (quantityToAdd > 0) {
        await logPurchase(
          restaurantId,
          id,
          quantityToAdd,
          updates.cost_per_unit || currentProduct.cost_per_unit || 0,
          `Inventory addition: ${currentProduct.name}`,
          `product_update_${id}_${Date.now()}`
        );
      }

      toast({
        title: "Product updated",
        description: quantityToAdd > 0 
          ? `${currentProduct.name} updated. Added ${quantityToAdd} units.`
          : "Product information has been updated",
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

  // Keep the original updateProduct for backwards compatibility
  const updateProduct = async (id: string, updates: Partial<CreateProductData>): Promise<boolean> => {
    return updateProductWithQuantity(id, updates, 0);
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
    updateProductWithQuantity,
    deleteProduct,
    findProductByGtin,
    findProductBySku,
    refetchProducts: fetchProducts,
  };
};
