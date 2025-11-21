// Purchase Order Types

export type PurchaseOrderStatus = 'DRAFT' | 'READY_TO_SEND' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED';

export interface PurchaseOrderLine {
  id: string;
  purchase_order_id: string;
  product_id: string;
  supplier_id: string;
  item_name: string;
  sku: string | null;
  unit_label: string | null;
  unit_cost: number;
  quantity: number;
  line_total: number;
  received_quantity: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrder {
  id: string;
  restaurant_id: string;
  po_number: string | null;
  supplier_id: string;
  location_id: string | null;
  status: PurchaseOrderStatus;
  budget: number | null;
  total: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  closed_at: string | null;
  // Joined fields
  supplier_name?: string;
  lines?: PurchaseOrderLine[];
}

export interface CreatePurchaseOrderData {
  restaurant_id: string;
  supplier_id: string;
  location_id?: string | null;
  budget?: number | null;
  notes?: string | null;
  status?: PurchaseOrderStatus;
}

export interface UpdatePurchaseOrderData {
  supplier_id?: string;
  location_id?: string | null;
  budget?: number | null;
  notes?: string | null;
  status?: PurchaseOrderStatus;
}

export interface CreatePurchaseOrderLineData {
  purchase_order_id: string;
  product_id: string;
  supplier_id: string;
  item_name: string;
  sku?: string | null;
  unit_label?: string | null;
  unit_cost: number;
  quantity: number;
  notes?: string | null;
}

export interface UpdatePurchaseOrderLineData {
  unit_cost?: number;
  quantity?: number;
  notes?: string | null;
}

// View model for UI
export interface PurchaseOrderViewModel extends PurchaseOrder {
  supplier_name: string;
  lines: PurchaseOrderLine[];
  budgetRemaining?: number;
  budgetOverage?: number;
  isOverBudget?: boolean;
}
