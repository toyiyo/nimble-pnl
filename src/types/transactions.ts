export interface TransactionFilters {
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
  status?: string;
  transactionType?: string;
  categoryId?: string;
  bankAccountId?: string;
  showUncategorized?: boolean;
}

export type BankTransactionSort = 'date' | 'payee' | 'amount' | 'category';
