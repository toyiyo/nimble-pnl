import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ReconciliationHistoryItem {
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
  performer?: {
    full_name: string | null;
    email: string | null;
  };
}

interface ReconciliationDetail {
  reconciliation: ReconciliationHistoryItem;
  items: Array<{
    id: string;
    product_id: string;
    expected_quantity: number;
    actual_quantity: number | null;
    variance: number | null;
    unit_cost: number;
    variance_value: number | null;
    notes: string | null;
    product: {
      name: string;
      uom_purchase: string;
      sku: string;
    };
  }>;
}

export function useReconciliationHistory(restaurantId: string | null) {
  const [reconciliations, setReconciliations] = useState<ReconciliationHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (restaurantId) {
      fetchReconciliations();
    }
  }, [restaurantId]);

  const fetchReconciliations = async (filters?: {
    startDate?: string;
    endDate?: string;
    status?: string;
  }) => {
    if (!restaurantId) return;

    setLoading(true);
    try {
      // First fetch reconciliations
      let query = supabase
        .from('inventory_reconciliations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('reconciliation_date', { ascending: false });

      if (filters?.startDate) {
        query = query.gte('reconciliation_date', filters.startDate);
      }
      if (filters?.endDate) {
        query = query.lte('reconciliation_date', filters.endDate);
      }
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      const { data: reconciliationsData, error } = await query;

      if (error) throw error;

      // Then fetch user profiles for all performed_by IDs
      const userIds = [...new Set(reconciliationsData?.map(r => r.performed_by) || [])];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', userIds);

      // Map profiles to reconciliations
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      const enrichedReconciliations = reconciliationsData?.map(rec => ({
        ...rec,
        performer: profileMap.get(rec.performed_by) || null
      }));

      setReconciliations((enrichedReconciliations || []) as ReconciliationHistoryItem[]);
    } catch (error: any) {
      console.error('Error fetching reconciliations:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const getReconciliationDetail = async (id: string): Promise<ReconciliationDetail | null> => {
    try {
      const { data: reconciliation, error: recError } = await supabase
        .from('inventory_reconciliations')
        .select('*')
        .eq('id', id)
        .single();

      if (recError) throw recError;

      const { data: items, error: itemsError } = await supabase
        .from('reconciliation_items')
        .select(`
          *,
          product:products(name, uom_purchase, sku)
        `)
        .eq('reconciliation_id', id)
        .order('product(name)');

      if (itemsError) throw itemsError;

      return {
        reconciliation: reconciliation as ReconciliationHistoryItem,
        items: items || [],
      };
    } catch (error: any) {
      console.error('Error fetching reconciliation detail:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return null;
    }
  };

  const exportReconciliationCSV = async (id: string) => {
    try {
      const detail = await getReconciliationDetail(id);
      if (!detail) return;

      const headers = ['Product', 'SKU', 'Unit', 'Expected', 'Actual', 'Variance', 'Unit Cost', 'Variance Value', 'Notes'];
      const rows = detail.items.map(item => [
        item.product.name,
        item.product.sku,
        item.product.uom_purchase,
        item.expected_quantity,
        item.actual_quantity ?? '',
        item.variance ?? '',
        item.unit_cost,
        item.variance_value ?? '',
        item.notes ?? '',
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reconciliation-${detail.reconciliation.reconciliation_date}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);

      toast({ title: 'Success', description: 'CSV exported successfully' });
    } catch (error: any) {
      console.error('Error exporting CSV:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  return {
    reconciliations,
    loading,
    fetchReconciliations,
    getReconciliationDetail,
    exportReconciliationCSV,
  };
}
