import { QueryClient } from "@tanstack/react-query";

/**
 * Shared type for split line data
 */
export interface SplitLine {
  category_id: string;
  amount: number;
  description?: string;
}

/**
 * Shared type for split form data
 */
export interface SplitFormData {
  splits: SplitLine[];
}

/**
 * Invalidates all split-related queries for both POS and bank transactions
 */
export const invalidateSplitQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: ['unified-sales'] });
  queryClient.invalidateQueries({ queryKey: ['pos-sales-splits'] });
  queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
  queryClient.invalidateQueries({ queryKey: ['bank-transactions-split'] });
  queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
};
