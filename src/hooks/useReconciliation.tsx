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
          product:products(name, uom_purchase, sku)
        `)
        .eq('reconciliation_id', sessionId)
        .order('product(name)');

      if (error) throw error;
      setItems(data || []);
    } catch (error: any) {
      console.error('Error fetching session items:', error);
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
      const { error } = await supabase
        .from('reconciliation_items')
        .update({
          actual_quantity: actualQty,
          notes: notes,
          counted_at: actualQty !== null ? new Date().toISOString() : null,
        })
        .eq('id', itemId);

      if (error) throw error;

      // Refresh items
      if (activeSession) {
        await fetchSessionItems(activeSession.id);
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
    if (!activeSession) return;

    setLoading(true);
    try {
      const summary = calculateSummary();

      // Update reconciliation session
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

      // Create inventory transactions for each variance and update product stock
      const { data: { user } } = await supabase.auth.getUser();
      
      for (const item of items) {
        if (item.variance !== null && item.variance !== 0 && item.actual_quantity !== null) {
          // Create inventory transaction
          const { error: txError } = await supabase
            .from('inventory_transactions')
            .insert({
              restaurant_id: restaurantId,
              product_id: item.product_id,
              quantity: item.variance,
              unit_cost: item.unit_cost,
              total_cost: item.variance_value,
              transaction_type: 'adjustment',
              reason: `Reconciliation ${activeSession.reconciliation_date}${item.notes ? `: ${item.notes}` : ''}`,
              reference_id: `RECON-${activeSession.id}`,
              performed_by: user?.id,
            });

          if (txError) throw txError;

          // Update product stock
          const { error: stockError } = await supabase
            .from('products')
            .update({ current_stock: item.actual_quantity })
            .eq('id', item.product_id);

          if (stockError) throw stockError;
        }
      }

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

  const calculateSummary = (): ReconciliationSummary => {
    const countedItems = items.filter(item => item.actual_quantity !== null);
    const itemsWithVariance = items.filter(
      item => item.variance !== null && item.variance !== 0
    );
    
    const totalShrinkage = items.reduce((sum, item) => {
      if (item.variance_value && item.variance_value < 0) {
        return sum + Math.abs(item.variance_value);
      }
      return sum;
    }, 0);

    const totalOverage = items.reduce((sum, item) => {
      if (item.variance_value && item.variance_value > 0) {
        return sum + item.variance_value;
      }
      return sum;
    }, 0);

    return {
      total_items_counted: countedItems.length,
      items_with_variance: itemsWithVariance.length,
      total_shrinkage_value: totalShrinkage - totalOverage,
      total_overage_value: totalOverage,
      items: items,
    };
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

  return {
    activeSession,
    items,
    loading,
    startReconciliation,
    updateItemCount,
    saveProgress,
    submitReconciliation,
    calculateSummary,
    deleteReconciliation,
    refreshSession: fetchActiveSession,
  };
}
