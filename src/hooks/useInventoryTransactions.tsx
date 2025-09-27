import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface InventoryTransaction {
  id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  transaction_type: string;
  reason: string;
  reference_id: string;
  created_at: string;
  performed_by: string;
  location?: string;
  lot_number?: string;
  expiry_date?: string;
}

interface UseInventoryTransactionsProps {
  restaurantId: string | null;
  typeFilter?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export const useInventoryTransactions = ({
  restaurantId,
  typeFilter = 'all',
  startDate,
  endDate,
  limit = 500
}: UseInventoryTransactionsProps) => {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = async () => {
    if (!restaurantId) {
      setTransactions([]);
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      let query = supabase
        .from('inventory_transactions')
        .select(`
          id,
          quantity,
          unit_cost,
          total_cost,
          transaction_type,
          reason,
          reference_id,
          created_at,
          performed_by,
          location,
          lot_number,
          expiry_date,
          products!inner(name)
        `)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (typeFilter && typeFilter !== 'all') {
        query = query.eq('transaction_type', typeFilter);
      }

      if (startDate) {
        query = query.gte('created_at', startDate);
      }

      if (endDate) {
        query = query.lte('created_at', `${endDate}T23:59:59`);
      }

      const { data, error: fetchError } = await query.limit(limit);

      if (fetchError) throw fetchError;

      const formattedTransactions = (data || []).map(transaction => ({
        ...transaction,
        product_name: transaction.products?.name || 'Unknown Product'
      }));

      setTransactions(formattedTransactions);
    } catch (err: any) {
      console.error('Error fetching inventory transactions:', err);
      setError(err.message || 'Failed to fetch inventory transactions');
    } finally {
      setLoading(false);
    }
  };

  const getTransactionsSummary = () => {
    const summary = {
      purchase: { count: 0, totalCost: 0 },
      usage: { count: 0, totalCost: 0 },
      adjustment: { count: 0, totalCost: 0 },
      waste: { count: 0, totalCost: 0 },
      transfer: { count: 0, totalCost: 0 }
    };

    transactions.forEach(transaction => {
      const type = transaction.transaction_type as keyof typeof summary;
      if (summary[type]) {
        summary[type].count += 1;
        summary[type].totalCost += Math.abs(transaction.total_cost || 0);
      }
    });

    return summary;
  };

  const exportToCSV = () => {
    const headers = ['Date', 'Product', 'Type', 'Quantity', 'Unit Cost', 'Total Cost', 'Reason', 'Reference'];
    const csvContent = [
      headers.join(','),
      ...transactions.map(t => [
        new Date(t.created_at).toISOString().replace('T', ' ').substring(0, 19),
        `"${t.product_name}"`,
        t.transaction_type,
        t.quantity,
        t.unit_cost || 0,
        t.total_cost || 0,
        `"${t.reason || ''}"`,
        `"${t.reference_id || ''}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-audit-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    fetchTransactions();
  }, [restaurantId, typeFilter, startDate, endDate]);

  return {
    transactions,
    loading,
    error,
    refetch: fetchTransactions,
    summary: getTransactionsSummary(),
    exportToCSV
  };
};