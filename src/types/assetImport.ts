// Types for Asset Import feature
// Allows users to upload invoices/receipts/CSVs to bulk create assets

import { DEFAULT_ASSET_CATEGORIES, getDefaultUsefulLife } from './assets';

/** Line item extracted from an asset purchase document */
export interface AssetLineItem {
  id: string; // Temporary ID for React keys

  // Extracted fields
  rawText: string;
  parsedName: string;
  parsedDescription?: string;
  purchaseCost: number;
  purchaseDate: string; // YYYY-MM-DD
  serialNumber?: string;

  // AI-suggested fields
  suggestedCategory: string;
  suggestedUsefulLifeMonths: number;
  suggestedSalvageValue: number;
  confidenceScore: number;

  // User-editable overrides (defaults to suggested values)
  category: string;
  usefulLifeMonths: number;
  salvageValue: number;
  description?: string;
  locationId?: string;

  // Import status
  importStatus: 'pending' | 'importing' | 'imported' | 'error';
  errorMessage?: string;
}

/** Document being processed for asset import */
export interface AssetImportDocument {
  id: string;
  restaurantId: string;
  fileName: string;
  filePath: string; // Storage path
  fileSize: number;
  mimeType: string;
  vendor?: string;
  purchaseDate?: string;
  totalAmount?: number;
  processedAt?: string;
  status: 'uploading' | 'processing' | 'processed' | 'error';
  errorMessage?: string;
}

/** Response from process-asset-document edge function */
export interface AssetExtractionResponse {
  success: boolean;
  vendor?: string;
  purchaseDate?: string;
  totalAmount?: number;
  lineItems: Array<{
    rawText: string;
    parsedName: string;
    parsedDescription?: string;
    purchaseCost: number;
    purchaseDate?: string;
    serialNumber?: string;
    suggestedCategory: string;
    suggestedUsefulLifeMonths: number;
    suggestedSalvageValue: number;
    confidenceScore: number;
  }>;
  error?: string;
}

/** Result of bulk asset import */
export interface AssetImportResult {
  success: boolean;
  totalItems: number;
  importedCount: number;
  failedCount: number;
  errors: Array<{
    itemName: string;
    error: string;
  }>;
}

/** CSV row for template-based import */
export interface AssetCSVRow {
  name: string;
  category?: string;
  purchase_date: string;
  purchase_cost: string | number;
  salvage_value?: string | number;
  useful_life_months?: string | number;
  serial_number?: string;
  description?: string;
  location?: string;
}

/** Required columns for CSV import */
export const REQUIRED_CSV_COLUMNS = ['name', 'purchase_date', 'purchase_cost'] as const;

/** Optional columns for CSV import */
export const OPTIONAL_CSV_COLUMNS = [
  'category',
  'salvage_value',
  'useful_life_months',
  'serial_number',
  'description',
  'location'
] as const;

/** All valid CSV columns */
export const ALL_CSV_COLUMNS = [...REQUIRED_CSV_COLUMNS, ...OPTIONAL_CSV_COLUMNS] as const;

/**
 * Generate a CSV template header
 */
export function getCSVTemplateHeader(): string {
  return ALL_CSV_COLUMNS.join(',');
}

/**
 * Generate a sample CSV row for template
 */
export function getCSVTemplateSampleRow(): string {
  return [
    'Walk-in Refrigerator',
    'Kitchen Equipment',
    '2024-01-15',
    '5499.99',
    '500',
    '84',
    'REF-12345',
    'Double-door stainless steel commercial refrigerator',
    'Kitchen'
  ].join(',');
}

/**
 * Suggest a category based on asset name keywords
 */
export function suggestCategoryFromName(name: string): { category: string; confidence: number } {
  const lowerName = name.toLowerCase();

  const categoryKeywords: Record<string, string[]> = {
    'Kitchen Equipment': [
      'refrigerator', 'fridge', 'freezer', 'oven', 'stove', 'range', 'fryer',
      'grill', 'griddle', 'mixer', 'blender', 'dishwasher', 'microwave', 'toaster',
      'ice machine', 'walk-in', 'cooler', 'steamer', 'warmer', 'hood', 'ventilation'
    ],
    'Furniture & Fixtures': [
      'table', 'chair', 'booth', 'shelf', 'shelving', 'cabinet', 'counter',
      'bar', 'stool', 'bench', 'rack', 'display', 'fixture', 'decor'
    ],
    'Electronics': [
      'computer', 'laptop', 'monitor', 'tv', 'television', 'speaker', 'camera',
      'router', 'modem', 'phone', 'tablet', 'ipad'
    ],
    'POS Hardware': [
      'pos', 'register', 'terminal', 'receipt printer', 'card reader', 'kiosk',
      'cash drawer', 'scanner', 'barcode'
    ],
    'Vehicles': [
      'truck', 'van', 'car', 'vehicle', 'trailer', 'delivery'
    ],
    'Office Equipment': [
      'desk', 'printer', 'copier', 'fax', 'shredder', 'file cabinet'
    ],
    'HVAC Systems': [
      'hvac', 'air conditioner', 'ac unit', 'heater', 'furnace', 'thermostat'
    ],
    'Security Systems': [
      'security', 'alarm', 'surveillance', 'safe', 'lock', 'access control'
    ],
    'Signage': [
      'sign', 'banner', 'menu board', 'neon', 'led display'
    ],
    'Leasehold Improvements': [
      'renovation', 'remodel', 'construction', 'flooring', 'plumbing', 'electrical'
    ]
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (lowerName.includes(keyword)) {
        return { category, confidence: 0.85 };
      }
    }
  }

  // Default to Other with low confidence
  return { category: 'Other', confidence: 0.5 };
}

/**
 * Create an AssetLineItem from extracted data
 */
export function createAssetLineItem(
  extracted: AssetExtractionResponse['lineItems'][number],
  documentPurchaseDate?: string
): AssetLineItem {
  const suggestion = suggestCategoryFromName(extracted.parsedName);
  const category = extracted.suggestedCategory || suggestion.category;
  const usefulLife = extracted.suggestedUsefulLifeMonths || getDefaultUsefulLife(category);

  return {
    id: crypto.randomUUID(),
    rawText: extracted.rawText,
    parsedName: extracted.parsedName,
    parsedDescription: extracted.parsedDescription,
    purchaseCost: extracted.purchaseCost,
    purchaseDate: extracted.purchaseDate || documentPurchaseDate || new Date().toISOString().split('T')[0],
    serialNumber: extracted.serialNumber,
    suggestedCategory: category,
    suggestedUsefulLifeMonths: usefulLife,
    suggestedSalvageValue: extracted.suggestedSalvageValue || 0,
    confidenceScore: extracted.confidenceScore,
    // User-editable defaults to suggested
    category,
    usefulLifeMonths: usefulLife,
    salvageValue: extracted.suggestedSalvageValue || 0,
    description: extracted.parsedDescription,
    importStatus: 'pending'
  };
}

/**
 * Parse a CSV row into an AssetLineItem
 */
export function parseCSVRowToLineItem(row: AssetCSVRow): AssetLineItem {
  const name = row.name?.trim() || 'Unnamed Asset';
  const suggestion = suggestCategoryFromName(name);
  const category = row.category?.trim() || suggestion.category;
  const usefulLife = row.useful_life_months
    ? parseInt(String(row.useful_life_months), 10)
    : getDefaultUsefulLife(category);

  return {
    id: crypto.randomUUID(),
    rawText: name,
    parsedName: name,
    parsedDescription: row.description?.trim(),
    purchaseCost: typeof row.purchase_cost === 'number'
      ? row.purchase_cost
      : parseFloat(String(row.purchase_cost).replace(/[^0-9.-]/g, '')) || 0,
    purchaseDate: row.purchase_date?.trim() || new Date().toISOString().split('T')[0],
    serialNumber: row.serial_number?.trim(),
    suggestedCategory: category,
    suggestedUsefulLifeMonths: usefulLife,
    suggestedSalvageValue: row.salvage_value
      ? (typeof row.salvage_value === 'number'
        ? row.salvage_value
        : parseFloat(String(row.salvage_value).replace(/[^0-9.-]/g, '')) || 0)
      : 0,
    confidenceScore: row.category ? 0.95 : suggestion.confidence,
    // User-editable defaults
    category,
    usefulLifeMonths: usefulLife,
    salvageValue: row.salvage_value
      ? (typeof row.salvage_value === 'number'
        ? row.salvage_value
        : parseFloat(String(row.salvage_value).replace(/[^0-9.-]/g, '')) || 0)
      : 0,
    description: row.description?.trim(),
    importStatus: 'pending'
  };
}
