import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { 
  fetchInventoryTransactions,
  calculateTransactionsSummary,
  exportTransactionsToCSV,
  type InventoryTransactionResult 
} from '@/services/inventoryTransactions.service';

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
      // Use shared service for fetching
      const data = await fetchInventoryTransactions(supabase, {
        restaurantId,
        typeFilter,
        startDate,
        endDate,
        limit
      });

      // Format for UI consumption
      const formattedTransactions = data.map(transaction => ({
        ...transaction,
        product_name: transaction.product?.name || 'Unknown Product'
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
    // Use shared service for summary calculation
    return calculateTransactionsSummary(transactions as any);
  };

  const exportToCSV = () => {
    // Use shared service for CSV export
    const csvContent = exportTransactionsToCSV(transactions as any);
    
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