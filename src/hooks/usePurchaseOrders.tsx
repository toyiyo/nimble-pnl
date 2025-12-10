import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import {
  PurchaseOrder,
  PurchaseOrderLine,
  CreatePurchaseOrderData,
  UpdatePurchaseOrderData,
  CreatePurchaseOrderLineData,
  UpdatePurchaseOrderLineData,
  PurchaseOrderViewModel,
} from '@/types/purchaseOrder';

export const usePurchaseOrders = () => {
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();
  const queryClient = useQueryClient();
  const restaurantId = selectedRestaurant?.restaurant_id;

  // Fetch all purchase orders with supplier info
  const { data: purchaseOrders = [], isLoading: loading } = useQuery({
    queryKey: ['purchase-orders', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          suppliers (
            id,
            name
          )
        `)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((po: any) => ({
        ...po,
        supplier_name: po.suppliers?.name || undefined,
      })) as PurchaseOrder[];
    },
    enabled: !!restaurantId,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  // Fetch a single purchase order with lines
  const fetchPurchaseOrder = async (poId: string): Promise<PurchaseOrderViewModel | null> => {
    if (!restaurantId) return null;

    const { data: poData, error: poError } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        suppliers (
          id,
          name
        )
      `)
      .eq('id', poId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (poError) throw poError;

    const { data: linesData, error: linesError } = await supabase
      .from('purchase_order_lines')
      .select('*')
      .eq('purchase_order_id', poId)
      .order('created_at', { ascending: true });

    if (linesError) throw linesError;

    const po: PurchaseOrderViewModel = {
      ...poData,
      status: poData.status as any,
      supplier_name: poData.suppliers?.name || undefined,
      lines: linesData || [],
    };

    // Calculate budget metrics
    if (po.budget && po.budget > 0) {
      const remaining = po.budget - po.total;
      po.budgetRemaining = remaining >= 0 ? remaining : 0;
      po.budgetOverage = remaining < 0 ? Math.abs(remaining) : 0;
      po.isOverBudget = remaining < 0;
    }

    return po;
  };

  // Create purchase order mutation
  const createMutation = useMutation({
    mutationFn: async (data: CreatePurchaseOrderData) => {
      if (!restaurantId) {
        throw new Error('Please select a restaurant first');
      }

      const { data: poData, error } = await supabase
        .from('purchase_orders')
        .insert({
          ...data,
          restaurant_id: restaurantId,
        })
        .select(`
          *,
          suppliers (
            id,
            name
          )
        `)
        .single();

      if (error) throw error;

      return {
        ...poData,
        supplier_name: poData.suppliers?.name || undefined,
      } as PurchaseOrder;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['purchase-orders', restaurantId], (old: PurchaseOrder[] = []) => [data, ...old]);
      toast({
        title: 'Success',
        description: 'Purchase order created successfully',
      });
    },
    onError: (error: any) => {
      console.error('Error creating purchase order:', error);
      toast({
        title: 'Error',
        description: 'Failed to create purchase order',
        variant: 'destructive',
      });
    },
  });

  // Update purchase order mutation
  const updateMutation = useMutation({
    mutationFn: async ({ poId, updates }: { poId: string; updates: UpdatePurchaseOrderData }) => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .update(updates)
        .eq('id', poId)
        .select(`
          *,
          suppliers (
            id,
            name
          )
        `)
        .single();

      if (error) throw error;

      return {
        ...data,
        supplier_name: data.suppliers?.name || undefined,
      } as PurchaseOrder;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['purchase-orders', restaurantId], (old: PurchaseOrder[] = []) =>
        old.map((po) => (po.id === data.id ? data : po))
      );
      toast({
        title: 'Success',
        description: 'Purchase order updated successfully',
      });
    },
    onError: (error: any) => {
      console.error('Error updating purchase order:', error);
      toast({
        title: 'Error',
        description: 'Failed to update purchase order',
        variant: 'destructive',
      });
    },
  });

  // Delete purchase order mutation
  const deleteMutation = useMutation({
    mutationFn: async (poId: string) => {
      const { error } = await supabase.from('purchase_orders').delete().eq('id', poId);

      if (error) throw error;
      return poId;
    },
    onSuccess: (poId) => {
      queryClient.setQueryData(['purchase-orders', restaurantId], (old: PurchaseOrder[] = []) =>
        old.filter((po) => po.id !== poId)
      );
      toast({
        title: 'Success',
        description: 'Purchase order deleted successfully',
      });
    },
    onError: (error: any) => {
      console.error('Error deleting purchase order:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete purchase order',
        variant: 'destructive',
      });
    },
  });

  // Add line item mutation
  const addLineMutation = useMutation({
    mutationFn: async (lineData: CreatePurchaseOrderLineData) => {
      // Calculate line total
      const lineTotal = lineData.quantity * lineData.unit_cost;

      const { data, error } = await supabase
        .from('purchase_order_lines')
        .insert({
          ...lineData,
          line_total: lineTotal,
        })
        .select()
        .single();

      if (error) throw error;
      return data as PurchaseOrderLine;
    },
    onSuccess: () => {
      // Invalidate PO queries to refetch with updated totals
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', restaurantId] });
      toast({
        title: 'Success',
        description: 'Item added to purchase order',
      });
    },
    onError: (error: any) => {
      console.error('Error adding line item:', error);
      toast({
        title: 'Error',
        description: 'Failed to add item to purchase order',
        variant: 'destructive',
      });
    },
  });

  // Update line item mutation
  const updateLineMutation = useMutation({
    mutationFn: async ({ lineId, updates }: { lineId: string; updates: UpdatePurchaseOrderLineData }) => {
      // Fetch current line to calculate new total
      const { data: currentLine, error: fetchError } = await supabase
        .from('purchase_order_lines')
        .select('quantity, unit_cost')
        .eq('id', lineId)
        .single();

      if (fetchError) throw fetchError;

      const quantity = updates.quantity ?? currentLine.quantity;
      const unitCost = updates.unit_cost ?? currentLine.unit_cost;
      const lineTotal = quantity * unitCost;

      const { data, error } = await supabase
        .from('purchase_order_lines')
        .update({
          ...updates,
          line_total: lineTotal,
        })
        .eq('id', lineId)
        .select()
        .single();

      if (error) throw error;
      return data as PurchaseOrderLine;
    },
    onSuccess: () => {
      // Invalidate PO queries to refetch with updated totals
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', restaurantId] });
    },
    onError: (error: any) => {
      console.error('Error updating line item:', error);
      toast({
        title: 'Error',
        description: 'Failed to update item',
        variant: 'destructive',
      });
    },
  });

  // Delete line item mutation
  const deleteLineMutation = useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await supabase.from('purchase_order_lines').delete().eq('id', lineId);

      if (error) throw error;
      return lineId;
    },
    onSuccess: () => {
      // Invalidate PO queries to refetch with updated totals
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', restaurantId] });
      toast({
        title: 'Success',
        description: 'Item removed from purchase order',
      });
    },
    onError: (error: any) => {
      console.error('Error deleting line item:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove item',
        variant: 'destructive',
      });
    },
  });

  const createPurchaseOrder = async (data: CreatePurchaseOrderData) => {
    return createMutation.mutateAsync(data);
  };

  const updatePurchaseOrder = async (poId: string, updates: UpdatePurchaseOrderData) => {
    return updateMutation.mutateAsync({ poId, updates });
  };

  const deletePurchaseOrder = async (poId: string) => {
    await deleteMutation.mutateAsync(poId);
  };

  const addLineItem = async (lineData: CreatePurchaseOrderLineData) => {
    return addLineMutation.mutateAsync(lineData);
  };

  const updateLineItem = async (lineId: string, updates: UpdatePurchaseOrderLineData) => {
    return updateLineMutation.mutateAsync({ lineId, updates });
  };

  const deleteLineItem = async (lineId: string) => {
    await deleteLineMutation.mutateAsync(lineId);
  };

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders', restaurantId] });
  };

  return {
    purchaseOrders,
    loading,
    fetchPurchaseOrder,
    createPurchaseOrder,
    updatePurchaseOrder,
    deletePurchaseOrder,
    addLineItem,
    updateLineItem,
    deleteLineItem,
    refetch,
  };
};
