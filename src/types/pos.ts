// Common POS system types for unified integration

export type POSSystemType = 'square' | 'toast' | 'clover' | 'resy' | 'spoton' | 'manual' | 'manual_upload';

export interface UnifiedSaleItem {
  id: string;
  restaurantId: string;
  posSystem: POSSystemType;
  externalOrderId: string;
  externalItemId?: string;
  itemName: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  saleDate: string;
  saleTime?: string;
  posCategory?: string;
  rawData?: any;
  syncedAt: string;
  createdAt: string;
  source?: string;
  category_id?: string;
  suggested_category_id?: string;
  ai_confidence?: 'high' | 'medium' | 'low';
  ai_reasoning?: string;
  is_categorized?: boolean;
  is_split?: boolean;
  parent_sale_id?: string | null;
  child_splits?: UnifiedSaleItem[];
  item_type?: 'sale' | 'tip' | 'tax' | 'discount' | 'comp' | 'service_charge' | 'other';
  adjustment_type?: 'tax' | 'tip' | 'service_charge' | 'discount' | 'fee' | null;
  chart_account?: {
    id: string;
    account_name: string;
    account_code: string;
  };
}

export interface UnifiedOrder {
  id: string;
  externalOrderId: string;
  posSystem: POSSystemType;
  restaurantId: string;
  saleDate: string;
  totalAmount?: number;
  discountAmount?: number;
  taxAmount?: number;
  status: string;
  items: UnifiedSaleItem[];
  rawData?: any;
}

export interface POSIntegrationStatus {
  system: POSSystemType;
  isConnected: boolean;
  isConfigured: boolean;
  lastSyncAt?: string;
  connectionId?: string;
}

export interface POSAdapter {
  system: POSSystemType;
  isConnected: boolean;
  fetchSales: (restaurantId: string, startDate?: string, endDate?: string) => Promise<UnifiedSaleItem[]>;
  syncToUnified: (restaurantId: string) => Promise<number>;
  getIntegrationStatus: () => POSIntegrationStatus;
}