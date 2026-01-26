/**
 * Shared expense data fetching logic
 * 
 * This module provides a unified way to fetch expense data from bank transactions,
 * pending outflows, and split transaction details. All expense-related hooks should
 * use this fetcher to ensure consistent data across the dashboard.
 */

import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface ExpenseTransaction {
  id: string;
  transaction_date: string;
  amount: number;
  status: string;
  description: string;
  merchant_name: string | null;
  normalized_payee: string | null;
  category_id: string | null;
  is_split: boolean;
  ai_confidence: string | null;
  chart_of_accounts: {
    account_name: string;
    account_subtype: string;
  } | null;
}

export interface PendingOutflowRecord {
  amount: number;
  category_id: string | null;
  issue_date: string;
  status: string;
  chart_account: {
    account_name: string;
    account_subtype: string;
  } | null;
}

export interface SplitDetail {
  transaction_id: string;
  amount: number;
  category_id: string;
  chart_of_accounts: {
    account_name: string;
    account_subtype: string;
  } | null;
}

export interface ExpenseDataParams {
  restaurantId: string;
  startDate: Date;
  endDate: Date;
  bankAccountId?: string;
  /** If true, also fetch previous period for comparison */
  includePreviousPeriod?: boolean;
}

export interface ExpenseDataResult {
  /** Bank transactions (posted + pending, outflows only, transfers excluded) */
  transactions: ExpenseTransaction[];
  /** Pending outflows from pending_outflows table (unmatched only) */
  pendingOutflows: PendingOutflowRecord[];
  /** Split line items for split parent transactions */
  splitDetails: SplitDetail[];
  /** Previous period transactions (if includePreviousPeriod was true) */
  previousPeriodTransactions?: ExpenseTransaction[];
}

/**
 * Fetches unified expense data from all relevant sources.
 * 
 * This ensures consistency across all expense-related hooks by using the same:
 * - Transaction status filters (posted + pending)
 * - Transfer exclusion (is_transfer = false)
 * - Pending outflows inclusion (unmatched checks)
 * - Split transaction handling
 */
export async function fetchExpenseData(params: ExpenseDataParams): Promise<ExpenseDataResult> {
  const { restaurantId, startDate, endDate, bankAccountId, includePreviousPeriod } = params;

  // Calculate previous period dates if needed
  const periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const previousPeriodStart = new Date(startDate);
  previousPeriodStart.setDate(previousPeriodStart.getDate() - periodDays);
  
  const fetchStartDate = includePreviousPeriod ? previousPeriodStart : startDate;

  // 1. Fetch bank transactions (posted + pending, outflows only, transfers excluded)
  let txQuery = supabase
    .from('bank_transactions')
    .select(`
      id,
      transaction_date,
      amount,
      status,
      description,
      merchant_name,
      normalized_payee,
      category_id,
      is_split,
      ai_confidence,
      chart_of_accounts!category_id(account_name, account_subtype)
    `)
    .eq('restaurant_id', restaurantId)
    .in('status', ['posted', 'pending'])
    .eq('is_transfer', false)
    .lt('amount', 0) // Only outflows
    .gte('transaction_date', format(fetchStartDate, 'yyyy-MM-dd'))
    .lte('transaction_date', format(endDate, 'yyyy-MM-dd'));

  if (bankAccountId && bankAccountId !== 'all') {
    txQuery = txQuery.eq('connected_bank_id', bankAccountId);
  }

  const { data: transactions, error: txError } = await txQuery.order('transaction_date', { ascending: true });

  if (txError) throw txError;

  const txns = (transactions || []) as ExpenseTransaction[];

  // 2. Fetch pending outflows (unmatched checks only)
  const { data: pendingOutflows, error: poError } = await supabase
    .from('pending_outflows')
    .select(`
      amount,
      category_id,
      issue_date,
      status,
      chart_account:chart_of_accounts!category_id(account_name, account_subtype)
    `)
    .eq('restaurant_id', restaurantId)
    .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
    .is('linked_bank_transaction_id', null) // Only unmatched
    .gte('issue_date', format(startDate, 'yyyy-MM-dd'))
    .lte('issue_date', format(endDate, 'yyyy-MM-dd'));

  if (poError) throw poError;

  const pendingOutflowRecords = (pendingOutflows || []) as PendingOutflowRecord[];

  // 3. Fetch split transaction details for split parent transactions
  // Filter to only current period transactions for split lookup
  const currentPeriodTxns = txns.filter(t => {
    const txnDate = new Date(t.transaction_date);
    return txnDate >= startDate && txnDate <= endDate;
  });
  
  const splitParentIds = currentPeriodTxns.filter(t => t.is_split).map(t => t.id);

  let splitDetails: SplitDetail[] = [];

  if (splitParentIds.length > 0) {
    const { data: splits, error: splitsError } = await supabase
      .from('bank_transaction_splits')
      .select(`
        transaction_id,
        amount,
        category_id,
        chart_of_accounts:chart_of_accounts!category_id(account_name, account_subtype)
      `)
      .in('transaction_id', splitParentIds);

    if (splitsError) {
      console.error('Error fetching split details:', splitsError);
    } else {
      splitDetails = (splits || []) as SplitDetail[];
    }
  }

  // Separate current and previous period transactions if needed
  if (includePreviousPeriod) {
    const currentTransactions = txns.filter(t => {
      const txnDate = new Date(t.transaction_date);
      return txnDate >= startDate && txnDate <= endDate;
    });
    const previousTransactions = txns.filter(t => {
      const txnDate = new Date(t.transaction_date);
      return txnDate >= previousPeriodStart && txnDate < startDate;
    });

    return {
      transactions: currentTransactions,
      pendingOutflows: pendingOutflowRecords,
      splitDetails,
      previousPeriodTransactions: previousTransactions,
    };
  }

  return {
    transactions: txns,
    pendingOutflows: pendingOutflowRecords,
    splitDetails,
  };
}
