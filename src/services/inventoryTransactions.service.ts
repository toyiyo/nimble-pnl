/**
 * Inventory Transactions Service
 * 
 * Shared business logic for querying and analyzing inventory transactions.
 * Used by both frontend hooks and Edge Functions to ensure consistency.
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface InventoryTransactionQuery {
  restaurantId: string;
  typeFilter?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  productId?: string;
  supplierId?: string;
  minCost?: number;
  maxCost?: number;
  searchTerm?: string;
}

export interface InventoryTransactionSummary {
  purchase: { count: number; totalCost: number };
  usage: { count: number; totalCost: number };
  adjustment: { count: number; totalCost: number };
  waste: { count: number; totalCost: number };
  transfer: { count: number; totalCost: number };
}

export interface InventoryTransactionResult {
  id: string;
  transaction_type: string;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  reason: string | null;
  reference_id: string | null;
  lot_number: string | null;
  expiry_date: string | null;
  location: string | null;
  created_at: string;
  transaction_date: string | null;
  performed_by: string;
  product?: any; // Supabase returns array, we'll handle it
  supplier?: any;
  performed_by_user?: any;
}

/**
 * Fetch inventory transactions with filters
 */
export async function fetchInventoryTransactions(
  supabase: SupabaseClient,
  query: InventoryTransactionQuery
): Promise<InventoryTransactionResult[]> {
  const {
    restaurantId,
    typeFilter,
    startDate,
    endDate,
    limit = 500,
    productId,
    supplierId,
    minCost,
    maxCost,
    searchTerm,
  } = query;

  // Build base query
  let dbQuery = supabase
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
      transaction_date,
      performed_by,
      location,
      lot_number,
      expiry_date,
      product:products(id, name, sku, category),
      supplier:suppliers(id, name)
    `)
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false });

  // Apply filters
  if (typeFilter && typeFilter !== 'all') {
    dbQuery = dbQuery.eq('transaction_type', typeFilter);
  }

  // Date filtering: Use transaction_date if available, otherwise fall back to created_at
  // We need to filter on both fields to catch all transactions in the date range
  if (startDate) {
    // Transaction is included if:
    // - transaction_date >= startDate OR
    // - transaction_date is NULL AND created_at >= startDate
    dbQuery = dbQuery.or(`transaction_date.gte.${startDate},and(transaction_date.is.null,created_at.gte.${startDate})`);
  }

  if (endDate) {
    // Transaction is included if:
    // - transaction_date <= endDate OR
    // - transaction_date is NULL AND created_at <= endDate
    const endDateTime = `${endDate}T23:59:59`;
    dbQuery = dbQuery.or(`transaction_date.lte.${endDate},and(transaction_date.is.null,created_at.lte.${endDateTime})`);
  }

  if (productId) {
    dbQuery = dbQuery.eq('product_id', productId);
  }

  if (supplierId) {
    dbQuery = dbQuery.eq('supplier_id', supplierId);
  }

  if (minCost !== undefined) {
    dbQuery = dbQuery.gte('total_cost', minCost);
  }

  if (maxCost !== undefined) {
    dbQuery = dbQuery.lte('total_cost', maxCost);
  }

  // Apply search term filter across relevant text fields
  if (searchTerm) {
    const term = searchTerm.trim();
    if (term) {
      // Filter on direct columns: reason, reference_id, performed_by
      // Note: Product and supplier names would require an RPC function for efficient filtering
      dbQuery = dbQuery.or(
        `reason.ilike.%${term}%,reference_id.ilike.%${term}%,performed_by.ilike.%${term}%`
      );
    }
  }

  dbQuery = dbQuery.limit(limit);

  const { data, error } = await dbQuery;

  if (error) {
    throw new Error(`Failed to fetch inventory transactions: ${error.message}`);
  }

  // Transform the data to normalize joined objects
  return (data || []).map((item: any) => ({
    ...item,
    product: Array.isArray(item.product) ? item.product[0] : item.product,
    supplier: Array.isArray(item.supplier) ? item.supplier[0] : item.supplier,
  }));
}

/**
 * Get the effective transaction date (transaction_date if available, otherwise created_at)
 */
export function getEffectiveTransactionDate(transaction: InventoryTransactionResult): string {
  return transaction.transaction_date || transaction.created_at.split('T')[0];
}

/**
 * Calculate summary statistics for transactions
 */
export function calculateTransactionsSummary(
  transactions: InventoryTransactionResult[]
): InventoryTransactionSummary {
  const summary: InventoryTransactionSummary = {
    purchase: { count: 0, totalCost: 0 },
    usage: { count: 0, totalCost: 0 },
    adjustment: { count: 0, totalCost: 0 },
    waste: { count: 0, totalCost: 0 },
    transfer: { count: 0, totalCost: 0 },
  };

  transactions.forEach((transaction) => {
    const type = transaction.transaction_type as keyof typeof summary;
    if (summary[type]) {
      summary[type].count += 1;
      // For transfers, use actual value (positive + negative = 0)
      // For other types, use absolute value to show total cost
      if (type === 'transfer') {
        summary[type].totalCost += transaction.total_cost || 0;
      } else {
        summary[type].totalCost += Math.abs(transaction.total_cost || 0);
      }
    }
  });

  return summary;
}

/**
 * Group transactions by various dimensions
 */
export interface GroupedTransactions {
  group_name: string;
  count: number;
  total_cost: number;
  items: InventoryTransactionResult[];
}

export function groupTransactions(
  transactions: InventoryTransactionResult[],
  groupBy: 'type' | 'product' | 'supplier' | 'date' | 'none'
): GroupedTransactions[] | null {
  if (groupBy === 'none') return null;

  const groups: Record<string, InventoryTransactionResult[]> = {};

  transactions.forEach((t) => {
    let groupKey: string;
    switch (groupBy) {
      case 'type':
        groupKey = t.transaction_type;
        break;
      case 'product':
        groupKey = t.product?.name || 'Unknown Product';
        break;
      case 'supplier':
        groupKey = t.supplier?.name || 'No Supplier';
        break;
      case 'date':
        groupKey = getEffectiveTransactionDate(t);
        break;
      default:
        groupKey = 'all';
    }

    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(t);
  });

  return Object.entries(groups).map(([key, items]) => ({
    group_name: key,
    count: items.length,
    total_cost: items.reduce((sum, item) => {
      // For transfers, use actual value (positive + negative = 0)
      // For other types, use absolute value to show total cost
      const isTransfer = item.transaction_type === 'transfer';
      return sum + (isTransfer ? (item.total_cost || 0) : Math.abs(item.total_cost || 0));
    }, 0),
    items: items.slice(0, 10), // Limit items per group
  }));
}

/**
 * Export transactions to CSV format
 */
export function exportTransactionsToCSV(transactions: InventoryTransactionResult[]): string {
  const headers = ['Date', 'Product', 'Type', 'Quantity', 'Unit Cost', 'Total Cost', 'Reason', 'Reference'];
  const csvContent = [
    headers.join(','),
    ...transactions.map((t) => [
      getEffectiveTransactionDate(t),
      `"${t.product?.name || 'Unknown Product'}"`,
      t.transaction_type,
      t.quantity,
      t.unit_cost || 0,
      t.total_cost || 0,
      `"${t.reason || ''}"`,
      `"${t.reference_id || ''}"`,
    ].join(','))
  ].join('\n');

  return csvContent;
}
