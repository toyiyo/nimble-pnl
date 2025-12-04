import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useInventoryAudit } from '@/hooks/useInventoryAudit';
import { sanitizeForOrFilter } from '@/lib/utils';

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
  cost_per_unit?: number | null;
  current_stock?: number | null;
  par_level_min?: number | null;
  par_level_max?: number | null;
  reorder_point?: number | null;
  supplier_id?: string | null;
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
  cost_per_unit?: number | null;
  current_stock?: number | null;
  par_level_min?: number | null;
  par_level_max?: number | null;
  reorder_point?: number | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  supplier_sku?: string | null;
  pos_item_name?: string | null;
  image_url?: string | null;
  barcode_data?: any | null;
}

export const useProducts = (restaurantId: string | null) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { logPurchase, logAdjustment, logWaste, updateProductStockWithAudit } = useInventoryAudit();
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

      // Create product-supplier relationship if supplier info is provided
      if (data && productData.supplier_id && productData.cost_per_unit) {
        const { error: supplierError } = await supabase
          .from('product_suppliers')
          .insert({
            restaurant_id: data.restaurant_id,
            product_id: data.id,
            supplier_id: productData.supplier_id,
            last_unit_cost: productData.cost_per_unit,
            supplier_sku: productData.supplier_sku,
            is_preferred: true,  // First supplier is default preferred
          });

        if (supplierError) {
          console.error('Error creating product-supplier relationship:', supplierError);
          // Don't throw - product was created successfully, just log the error
          toast({
            title: "Warning",
            description: "Product created but supplier relationship could not be saved",
            variant: "destructive",
          });
        }
      }

      // Log initial stock as adjustment if there's stock being added
      // Only receipt uploads should create purchases
      if (data && (productData.current_stock || 0) > 0) {
        await logAdjustment(
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

      // Update local state immediately
      setProducts(prev => [...prev, data]);
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
    currentStock: number,
    newStock: number,
    transactionType: 'adjustment' | 'waste' = 'adjustment',
    reason: string = 'Inventory update'
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

      const quantityDifference = newStock - currentStock;

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

      // Log inventory transaction based on type
      // Note: Only receipt uploads should create purchases
      // All manual updates should be adjustments
      if (quantityDifference !== 0) {
        const unitCost = updates.cost_per_unit || currentProduct.cost_per_unit || 0;
        
        if (transactionType === 'adjustment') {
          await logAdjustment(
            restaurantId,
            id,
            quantityDifference,
            unitCost,
            reason,
            `adjustment_${id}_${Date.now()}`
          );
        } else if (transactionType === 'waste') {
          await logWaste(
            restaurantId,
            id,
            Math.abs(quantityDifference),
            unitCost,
            reason,
            `waste_${id}_${Date.now()}`
          );
        }
      }

      // Get the appropriate unit name for display (bottle, case, etc.)
      const displayUnit = currentProduct.uom_purchase || 'unit';
      const unitName = Math.abs(quantityDifference) === 1 ? displayUnit : `${displayUnit}s`;
      const roundedQuantity = Math.round(quantityDifference * 100) / 100;
      
      const transactionDescription = transactionType === 'adjustment' 
        ? quantityDifference >= 0 
          ? `Adjustment: +${roundedQuantity} ${unitName} (${reason})`
          : `Adjustment: ${roundedQuantity} ${unitName} (${reason})`
        : quantityDifference > 0 
          ? `Added ${roundedQuantity} ${unitName}`
          : `Removed ${Math.round(Math.abs(quantityDifference) * 100) / 100} ${Math.abs(quantityDifference) === 1 ? displayUnit : `${displayUnit}s`}`;

      // Update local state immediately with the new data
      setProducts(prev => prev.map(product => 
        product.id === id 
          ? { ...product, ...updatedData }
          : product
      ));

      toast({
        title: "Product updated",
        description: quantityDifference !== 0 
          ? `${currentProduct.name} updated. ${transactionDescription}`
          : "Product information has been updated",
      });

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
    // Get current product to determine current stock
    const { data: currentProduct } = await supabase
      .from('products')
      .select('current_stock')
      .eq('id', id)
      .single();
    
    const currentStock = currentProduct?.current_stock || 0;
    const newStock = updates.current_stock ?? currentStock;
    return updateProductWithQuantity(id, updates, currentStock, newStock, 'adjustment', 'Product information update');
  };

  const findProductByGtin = useCallback(async (gtin: string): Promise<Product | null> => {
    if (!restaurantId || !gtin) return null;

    try {
      // Search by both GTIN and SKU fields using the exact scanned barcode
      // Sanitize input to prevent query injection
      const sanitizedGtin = sanitizeForOrFilter(gtin);
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .or(`gtin.eq.${sanitizedGtin},sku.eq.${sanitizedGtin}`)
        .limit(1);

      if (error) throw error;
      
      // Return first match or null if no products found
      return (data && data.length > 0) ? data[0] : null;
    } catch (error: any) {
      console.error('Error finding product by GTIN/SKU:', error);
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
        
        // Check for foreign key constraint errors
        if (error.code === '23503') {
          let userMessage = "Cannot delete this product because it's being used in:";
          let details: string[] = [];
          
          // Parse which table is blocking deletion
          if (error.details?.includes('receipt_line_items')) {
            details.push('Receipt line items (imported receipts)');
          }
          if (error.details?.includes('recipe_ingredients')) {
            details.push('Recipes as an ingredient');
          }
          if (error.details?.includes('inventory_transactions')) {
            details.push('Inventory transaction history');
          }
          if (error.details?.includes('pos_item_mappings')) {
            details.push('POS item mappings');
          }
          if (error.details?.includes('product_suppliers')) {
            details.push('Supplier relationships');
          }
          
          if (details.length === 0) {
            details.push('Other system records');
          }
          
          toast({
            title: "Cannot Delete Product",
            description: `${userMessage}\n• ${details.join('\n• ')}\n\nPlease remove these references first or contact support for help.`,
            variant: "destructive",
            duration: 10000,
          });
        } else {
          toast({
            title: "Error",
            description: "Failed to delete product",
            variant: "destructive",
          });
        }
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
