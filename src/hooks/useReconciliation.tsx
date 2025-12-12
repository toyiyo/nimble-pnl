import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ReconciliationSession {
  id: string;
  restaurant_id: string;
  reconciliation_date: string;
  started_at: string;
  submitted_at: string | null;
  status: 'draft' | 'in_progress' | 'submitted';
  performed_by: string;
  total_items_counted: number;
  items_with_variance: number;
  total_shrinkage_value: number;
  notes: string | null;
}

export interface ReconciliationItemFind {
  id: string;
  reconciliation_item_id: string;
  quantity: number;
  location: string | null;
  notes: string | null;
  found_at: string;
  found_by: string | null;
  created_at: string;
}

interface ReconciliationItem {
  id: string;
  reconciliation_id: string;
  product_id: string;
  expected_quantity: number;
  actual_quantity: number | null;
  variance: number | null;
  unit_cost: number;
  variance_value: number | null;
  notes: string | null;
  counted_at: string | null;
  product?: {
    name: string;
    uom_purchase: string;
    sku: string;
  };
  finds?: { count: number }[];
}

interface ReconciliationSummary {
  total_items_counted: number;
  items_with_variance: number;
  total_shrinkage_value: number;
  total_overage_value: number;
  items: ReconciliationItem[];
}

export function useReconciliation(restaurantId: string | null) {
  const [activeSession, setActiveSession] = useState<ReconciliationSession | null>(null);
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Fetch active session on mount
  useEffect(() => {
    if (restaurantId) {
      fetchActiveSession();
    }
  }, [restaurantId]);

  const fetchActiveSession = async () => {
    if (!restaurantId) return;

    try {
      const { data, error } = await supabase
        .from('inventory_reconciliations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .in('status', ['draft', 'in_progress'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setActiveSession(data as ReconciliationSession);
        await fetchSessionItems(data.id);
      }
    } catch (error: any) {
      console.error('Error fetching active session:', error);
    }
  };

  const fetchSessionItems = async (sessionId: string) => {
    try {
      const { data, error } = await supabase
        .from('reconciliation_items')
        .select(`
          *,
          product:products(name, uom_purchase, sku),
          finds:reconciliation_item_finds(count)
        `)
        .eq('reconciliation_id', sessionId)
        .order('product(name)');

      if (error) throw error;
      const fetched = data || [];
      setItems(fetched);
      return fetched;
    } catch (error: any) {
      console.error('Error fetching session items:', error);
      return [];
    }
  };

  const startReconciliation = async () => {
    if (!restaurantId) {
      toast({ title: 'Error', description: 'No restaurant selected', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create reconciliation session
      const { data: session, error: sessionError } = await supabase
        .from('inventory_reconciliations')
        .insert({
          restaurant_id: restaurantId,
          status: 'in_progress',
          performed_by: user.id,
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      // Fetch all products and create reconciliation items
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, name, current_stock, cost_per_unit, uom_purchase, sku')
        .eq('restaurant_id', restaurantId);

      if (productsError) throw productsError;

      const itemsToInsert = products.map(product => ({
        reconciliation_id: session.id,
        product_id: product.id,
        expected_quantity: product.current_stock || 0,
        unit_cost: product.cost_per_unit || 0,
      }));

      const { error: itemsError } = await supabase
        .from('reconciliation_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      setActiveSession(session as ReconciliationSession);
      await fetchSessionItems(session.id);

      toast({ title: 'Success', description: 'Reconciliation session started' });
      return session;
    } catch (error: any) {
      console.error('Error starting reconciliation:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const updateItemCount = async (itemId: string, actualQty: number | null, notes?: string) => {
    try {
      // Find the item to calculate variance before updating
      const item = items.find(i => i.id === itemId);
      if (!item) return false;
      
      const variance = actualQty !== null ? actualQty - item.expected_quantity : null;
      const varianceValue = variance !== null && item.unit_cost 
        ? variance * item.unit_cost 
        : null;
      
      // Optimistically update local state FIRST
      setItems(prevItems => 
        prevItems.map(i => 
          i.id === itemId 
            ? {
                ...i,
                actual_quantity: actualQty,
                variance,
                variance_value: varianceValue,
                notes: notes,
                counted_at: actualQty !== null ? new Date().toISOString() : null,
              }
            : i
        )
      );

      // Then save to database in background
      const { error } = await supabase
        .from('reconciliation_items')
        .update({
          actual_quantity: actualQty,
          notes: notes,
          counted_at: actualQty !== null ? new Date().toISOString() : null,
        })
        .eq('id', itemId);

      if (error) {
        // Rollback on error by refetching
        if (activeSession) {
          await fetchSessionItems(activeSession.id);
        }
        throw error;
      }

      return true;
    } catch (error: any) {
      console.error('Error updating item count:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
  };

  const saveProgress = async () => {
    if (!activeSession) return;

    try {
      const summary = calculateSummary();
      
      const { error } = await supabase
        .from('inventory_reconciliations')
        .update({
          total_items_counted: summary.total_items_counted,
          items_with_variance: summary.items_with_variance,
          total_shrinkage_value: summary.total_shrinkage_value,
          status: 'draft',
        })
        .eq('id', activeSession.id);

      if (error) throw error;

      // Refresh items to get updated variance calculations
      await fetchSessionItems(activeSession.id);

      toast({ title: 'Progress saved', description: 'Your counts have been saved' });
      return true;
    } catch (error: any) {
      console.error('Error saving progress:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
  };

  const submitReconciliation = async () => {
    if (!activeSession) return false;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Refresh items to avoid stale counts and recalculated variances
      const latestItems = await fetchSessionItems(activeSession.id);
      const itemsToProcess = latestItems.length > 0 ? latestItems : items;
      const summary = calculateSummary(itemsToProcess);

      for (const item of itemsToProcess) {
        const actualQty = item.actual_quantity !== null && item.actual_quantity !== undefined
          ? Number(item.actual_quantity)
          : null;

        if (actualQty !== null) {
          const { error: stockError } = await supabase
            .from('products')
            .update({ current_stock: actualQty })
            .eq('id', item.product_id);

          if (stockError) throw stockError;

          const expectedQty = Number(item.expected_quantity ?? 0);
          const variance = actualQty - expectedQty;
          const varianceValue = item.unit_cost ? variance * Number(item.unit_cost) : null;

          if (variance !== 0) {
            const { error: txError } = await supabase
              .from('inventory_transactions')
              .insert({
                restaurant_id: restaurantId,
                product_id: item.product_id,
                quantity: variance,
                unit_cost: item.unit_cost,
                total_cost: varianceValue,
                transaction_type: 'adjustment',
                reason: `Reconciliation ${activeSession.reconciliation_date}${item.notes ? `: ${item.notes}` : ''}`,
                reference_id: `RECON-${activeSession.id}`,
                performed_by: user?.id,
              });

            if (txError) throw txError;
          }
        }
      }

      // Only mark the reconciliation complete after all updates succeed
      const { error: updateError } = await supabase
        .from('inventory_reconciliations')
        .update({
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          total_items_counted: summary.total_items_counted,
          items_with_variance: summary.items_with_variance,
          total_shrinkage_value: summary.total_shrinkage_value,
        })
        .eq('id', activeSession.id);

      if (updateError) throw updateError;

      toast({ title: 'Success', description: 'Reconciliation completed and inventory updated' });
      setActiveSession(null);
      setItems([]);
      return true;
    } catch (error: any) {
      console.error('Error submitting reconciliation:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const calculateSummary = (sourceItems?: ReconciliationItem[]): ReconciliationSummary => {
    const dataset = sourceItems ?? items;
    const countedItems = dataset.filter(item => item.actual_quantity !== null);
    const itemsWithVariance = dataset.filter(item => {
      if (item.variance === null || item.variance === undefined) return false;
      return Number(item.variance) !== 0;
    });
    
    const totalShrinkage = dataset.reduce((sum, item) => {
      const varianceValue = item.variance_value ?? 0;
      const numericVariance = Number(varianceValue);
      if (numericVariance < 0) {
        return sum + Math.abs(numericVariance);
      }
      return sum;
    }, 0);

    const totalOverage = dataset.reduce((sum, item) => {
      const varianceValue = item.variance_value ?? 0;
      const numericVariance = Number(varianceValue);
      if (numericVariance > 0) {
        return sum + numericVariance;
      }
      return sum;
    }, 0);

    return {
      total_items_counted: countedItems.length,
      items_with_variance: itemsWithVariance.length,
      total_shrinkage_value: totalOverage - totalShrinkage,
      total_overage_value: totalOverage,
      items: items,
    };
  };

  const cancelReconciliation = async () => {
    if (!activeSession) return;

    setLoading(true);
    try {
      // Delete reconciliation items first
      const { error: itemsError } = await supabase
        .from('reconciliation_items')
        .delete()
        .eq('reconciliation_id', activeSession.id);

      if (itemsError) throw itemsError;

      // Delete the reconciliation session
      const { error: sessionError } = await supabase
        .from('inventory_reconciliations')
        .delete()
        .eq('id', activeSession.id);

      if (sessionError) throw sessionError;

      setActiveSession(null);
      setItems([]);
      toast({ title: 'Reconciliation cancelled', description: 'All progress has been discarded' });
      return true;
    } catch (error: any) {
      console.error('Error cancelling reconciliation:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deleteReconciliation = async (id: string) => {
    try {
      const { error } = await supabase
        .from('inventory_reconciliations')
        .delete()
        .eq('id', id)
        .eq('status', 'draft');

      if (error) throw error;

      if (activeSession?.id === id) {
        setActiveSession(null);
        setItems([]);
      }

      toast({ title: 'Success', description: 'Draft reconciliation deleted' });
      return true;
    } catch (error: any) {
      console.error('Error deleting reconciliation:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
  };

  const resumeReconciliation = async (sessionId: string) => {
    setLoading(true);
    try {
      const { data: session, error } = await supabase
        .from('inventory_reconciliations')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error) throw error;

      setActiveSession(session as ReconciliationSession);
      await fetchSessionItems(sessionId);
      
      toast({ title: 'Success', description: 'Resumed reconciliation session' });
      return true;
    } catch (error: any) {
      console.error('Error resuming reconciliation:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Add a new find for a reconciliation item
  const addFind = async (
    itemId: string, 
    quantity: number, 
    location?: string, 
    notes?: string
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase
      .from('reconciliation_item_finds')
      .insert({
        reconciliation_item_id: itemId,
        quantity,
        location,
        notes,
        found_by: user?.id
      });
      
    if (error) throw error;
    
    // Refresh items to get updated actual_quantity (from trigger)
    if (activeSession) {
      await fetchSessionItems(activeSession.id);
    }
  };

  // Get all finds for a specific item
  const getItemFinds = async (itemId: string) => {
    const { data, error } = await supabase
      .from('reconciliation_item_finds')
      .select('*')
      .eq('reconciliation_item_id', itemId)
      .order('found_at', { ascending: true });
      
    if (error) throw error;
    return data || [];
  };

  // Delete a specific find
  const deleteFind = async (findId: string) => {
    const { error } = await supabase
      .from('reconciliation_item_finds')
      .delete()
      .eq('id', findId);
      
    if (error) throw error;
    
    // Refresh items
    if (activeSession) {
      await fetchSessionItems(activeSession.id);
    }
  };

  return {
    activeSession,
    items,
    loading,
    startReconciliation,
    updateItemCount,
    saveProgress,
    submitReconciliation,
    calculateSummary,
    cancelReconciliation,
    deleteReconciliation,
    resumeReconciliation,
    refreshSession: fetchActiveSession,
    addFind,
    getItemFinds,
    deleteFind,
  };
}
