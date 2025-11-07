export type PendingOutflowStatus = 'pending' | 'cleared' | 'voided' | 'stale_30' | 'stale_60' | 'stale_90';
export type PaymentMethod = 'check' | 'ach' | 'other';

export interface PendingOutflow {
  id: string;
  restaurant_id: string;
  vendor_name: string;
  category_id: string | null;
  payment_method: PaymentMethod;
  amount: number;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  reference_number: string | null;
  status: PendingOutflowStatus;
  linked_bank_transaction_id: string | null;
  cleared_at: string | null;
  voided_at: string | null;
  voided_reason: string | null;
  created_at: string;
  updated_at: string;
  chart_account?: {
    account_name: string;
  } | null;
}

export interface PendingOutflowMatch {
  pending_outflow_id: string;
  bank_transaction_id: string;
  match_score: number;
  amount_delta: number;
  date_delta: number;
  payee_similarity: string;
}

export interface CreatePendingOutflowInput {
  vendor_name: string;
  category_id?: string | null;
  payment_method: PaymentMethod;
  amount: number;
  issue_date: string;
  due_date?: string | null;
  notes?: string | null;
  reference_number?: string | null;
}

export interface UpdatePendingOutflowInput {
  vendor_name?: string;
  category_id?: string | null;
  payment_method?: PaymentMethod;
  amount?: number;
  issue_date?: string;
  due_date?: string | null;
  notes?: string | null;
  reference_number?: string | null;
  status?: PendingOutflowStatus;
  voided_reason?: string | null;
}
