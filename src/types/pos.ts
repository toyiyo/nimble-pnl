// Common POS system types for unified integration

export type POSSystemType = 'square' | 'toast' | 'clover' | 'resy' | 'manual';

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