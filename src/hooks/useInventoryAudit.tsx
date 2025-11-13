import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface InventoryAuditEntry {
  restaurant_id: string;
  product_id: string;
  quantity: number;
  unit_cost?: number;
  total_cost?: number;
  transaction_type: 'purchase' | 'usage' | 'adjustment' | 'waste' | 'transfer';
  reason: string;
  reference_id?: string;
  location?: string;
  lot_number?: string;
  expiry_date?: string;
  performed_by?: string;
}

export const useInventoryAudit = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const logInventoryTransaction = useCallback(async (entry: InventoryAuditEntry) => {
    if (!user) {
      console.error('Cannot log inventory transaction: user not authenticated');
      return false;
    }

    try {
      const { error } = await supabase
        .from('inventory_transactions')
        .insert([{
          ...entry,
          performed_by: user.id,
          created_at: new Date().toISOString()
        }]);

      if (error) throw error;

      console.log(`✅ Inventory transaction logged:`, {
        type: entry.transaction_type,
        product_id: entry.product_id,
        quantity: entry.quantity,
        reason: entry.reason
      });

      return true;
    } catch (error: any) {
      console.error('Error logging inventory transaction:', error);
      toast({
        title: "Audit Log Error",
        description: "Failed to log inventory transaction",
        variant: "destructive",
      });
      return false;
    }
  }, [user, toast]);

  const logPurchase = useCallback(async (
    restaurantId: string,
    productId: string,
    quantity: number,
    unitCost: number,
    reason: string,
    referenceId?: string
  ) => {
    return await logInventoryTransaction({
      restaurant_id: restaurantId,
      product_id: productId,
      quantity: Math.abs(quantity), // Purchases are always positive
      unit_cost: unitCost,
      total_cost: Math.abs(quantity) * unitCost,
      transaction_type: 'purchase',
      reason,
      reference_id: referenceId
    });
  }, [logInventoryTransaction]);

  const logUsage = useCallback(async (
    restaurantId: string,
    productId: string,
    quantity: number,
    unitCost: number,
    reason: string,
    referenceId?: string
  ) => {
    return await logInventoryTransaction({
      restaurant_id: restaurantId,
      product_id: productId,
      quantity: -Math.abs(quantity), // Usage is always negative
      unit_cost: unitCost,
      total_cost: -Math.abs(quantity) * unitCost,
      transaction_type: 'usage',
      reason,
      reference_id: referenceId
    });
  }, [logInventoryTransaction]);

  const logAdjustment = useCallback(async (
    restaurantId: string,
    productId: string,
    quantityDifference: number, // Can be positive or negative
    unitCost: number,
    reason: string,
    referenceId?: string
  ) => {
    return await logInventoryTransaction({
      restaurant_id: restaurantId,
      product_id: productId,
      quantity: quantityDifference,
      unit_cost: unitCost,
      total_cost: quantityDifference * unitCost,
      transaction_type: 'adjustment',
      reason,
      reference_id: referenceId
    });
  }, [logInventoryTransaction]);

  const logWaste = useCallback(async (
    restaurantId: string,
    productId: string,
    quantity: number,
    unitCost: number,
    reason: string,
    referenceId?: string,
    expiryDate?: string
  ) => {
    return await logInventoryTransaction({
      restaurant_id: restaurantId,
      product_id: productId,
      quantity: -Math.abs(quantity), // Waste is always negative
      unit_cost: unitCost,
      total_cost: -Math.abs(quantity) * unitCost,
      transaction_type: 'waste',
      reason,
      reference_id: referenceId,
      expiry_date: expiryDate
    });
  }, [logInventoryTransaction]);

  const logTransfer = useCallback(async (
    restaurantId: string,
    productId: string,
    quantity: number,
    unitCost: number,
    fromLocation: string,
    toLocation: string,
    reason: string,
    referenceId?: string
  ) => {
    // For transfers, we log two transactions:
    // 1. Negative for source location
    // 2. Positive for destination location
    
    const transferOut = await logInventoryTransaction({
      restaurant_id: restaurantId,
      product_id: productId,
      quantity: -Math.abs(quantity),
      unit_cost: unitCost,
      total_cost: -Math.abs(quantity) * unitCost,
      transaction_type: 'transfer',
      reason: `Transfer OUT: ${reason} (to ${toLocation})`,
      reference_id: referenceId,
      location: fromLocation
    });

    const transferIn = await logInventoryTransaction({
      restaurant_id: restaurantId,
      product_id: productId,
      quantity: Math.abs(quantity),
      unit_cost: unitCost,
      total_cost: Math.abs(quantity) * unitCost,
      transaction_type: 'transfer',
      reason: `Transfer IN: ${reason} (from ${fromLocation})`,
      reference_id: referenceId,
      location: toLocation
    });

    return transferOut && transferIn;
  }, [logInventoryTransaction]);

  const updateProductStockWithAudit = useCallback(async (
    restaurantId: string,
    productId: string,
    newStock: number,
    oldStock: number,
    unitCost: number,
    transactionType: 'adjustment' | 'waste',
    reason: string,
    referenceId?: string
  ) => {
    const quantityDifference = newStock - oldStock;
    
    if (quantityDifference === 0) return true; // No change needed
    
    try {
      // Update product stock
      const { error: updateError } = await supabase
        .from('products')
        .update({ current_stock: newStock, updated_at: new Date().toISOString() })
        .eq('id', productId);

      if (updateError) throw updateError;

      // Log the transaction
      // Note: Only receipt uploads should create purchases
      // This function only handles adjustments and waste
      let auditSuccess = false;
      switch (transactionType) {
        case 'adjustment':
          auditSuccess = await logAdjustment(restaurantId, productId, quantityDifference, unitCost, reason, referenceId);
          break;
        case 'waste':
          auditSuccess = await logWaste(restaurantId, productId, Math.abs(quantityDifference), unitCost, reason, referenceId);
          break;
      }

      if (!auditSuccess) {
        console.warn('Stock updated but audit log failed');
      }

      return true;
    } catch (error: any) {
      console.error('Error updating stock with audit:', error);
      toast({
        title: "Error",
        description: "Failed to update inventory",
        variant: "destructive",
      });
      return false;
    }
  }, [logAdjustment, logWaste, toast]);

  return {
    logInventoryTransaction,
    logPurchase,
    logUsage,
    logAdjustment,
    logWaste,
    logTransfer,
    updateProductStockWithAudit
  };
};