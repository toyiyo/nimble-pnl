// Types for Asset Import feature
// Allows users to upload invoices/receipts/CSVs to bulk create assets

import { getDefaultUsefulLife } from './assets';

/** Line item extracted from an asset purchase document */
export interface AssetLineItem {
  id: string; // Temporary ID for React keys

  // Extracted fields
  rawText: string;
  parsedName: string;
  parsedDescription?: string;
  quantity: number; // Number of identical units (default 1)
  unitCost: number; // Cost per unit
  purchaseCost: number; // Total cost (quantity * unitCost) - kept for display
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
    quantity?: number; // Number of identical units (default 1)
    unitCost?: number; // Cost per unit (if quantity provided)
    purchaseCost: number; // Total cost for this line item
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
  quantity?: string | number; // Number of identical units
  unit_cost?: string | number; // Cost per unit
  purchase_cost?: string | number; // Total cost (legacy support, or if quantity not provided)
  salvage_value?: string | number;
  useful_life_months?: string | number;
  serial_number?: string;
  description?: string;
  location?: string;
}

/** Required columns for CSV import */
export const REQUIRED_CSV_COLUMNS = ['name', 'purchase_date'] as const;

/** Optional columns for CSV import */
export const OPTIONAL_CSV_COLUMNS = [
  'category',
  'quantity',
  'unit_cost',
  'purchase_cost',
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
    'Walk-in Refrigerator', // name
    'Kitchen Equipment', // category
    '2024-01-15', // purchase_date
    '2', // quantity
    '2749.99', // unit_cost
    '5499.98', // purchase_cost (total)
    '500', // salvage_value
    '84', // useful_life_months
    'REF-12345', // serial_number
    'Double-door stainless steel commercial refrigerator', // description
    'Kitchen' // location
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

  // Handle quantity and unit cost
  const quantity = extracted.quantity || 1;
  const totalCost = extracted.purchaseCost || 0;
  // If unitCost provided, use it; otherwise calculate from total / quantity
  const unitCost = extracted.unitCost || (quantity > 0 ? totalCost / quantity : totalCost);

  return {
    id: crypto.randomUUID(),
    rawText: extracted.rawText,
    parsedName: extracted.parsedName,
    parsedDescription: extracted.parsedDescription,
    quantity,
    unitCost,
    purchaseCost: totalCost,
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
 * Parse salvage value from CSV row value
 */
function parseSalvageValue(value: string | number | undefined): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  return Number.parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;
}

/**
 * Parse a CSV row into an AssetLineItem
 */
export function parseCSVRowToLineItem(row: AssetCSVRow): AssetLineItem {
  const name = row.name?.trim() || 'Unnamed Asset';
  const suggestion = suggestCategoryFromName(name);
  const category = row.category?.trim() || suggestion.category;
  const usefulLife = row.useful_life_months
    ? Number.parseInt(String(row.useful_life_months), 10)
    : getDefaultUsefulLife(category);

  // Parse quantity (default to 1)
  const quantity = row.quantity
    ? Number.parseInt(String(row.quantity), 10) || 1
    : 1;

  // Parse unit_cost if provided
  const parsedUnitCost = row.unit_cost
    ? (typeof row.unit_cost === 'number'
        ? row.unit_cost
        : Number.parseFloat(String(row.unit_cost).replace(/[^0-9.-]/g, '')) || 0)
    : null;

  // Parse purchase_cost (total) if provided
  const parsedPurchaseCost = row.purchase_cost
    ? (typeof row.purchase_cost === 'number'
        ? row.purchase_cost
        : Number.parseFloat(String(row.purchase_cost).replace(/[^0-9.-]/g, '')) || 0)
    : null;

  // Determine unit_cost and purchase_cost
  let unitCost: number;
  let purchaseCost: number;

  if (parsedUnitCost !== null) {
    // unit_cost provided - use it directly
    unitCost = parsedUnitCost;
    purchaseCost = unitCost * quantity;
  } else if (parsedPurchaseCost !== null) {
    // Only purchase_cost provided - calculate unit_cost
    purchaseCost = parsedPurchaseCost;
    unitCost = quantity > 0 ? purchaseCost / quantity : purchaseCost;
  } else {
    // Neither provided
    unitCost = 0;
    purchaseCost = 0;
  }

  const item: AssetLineItem = {
    id: crypto.randomUUID(),
    rawText: name,
    parsedName: name,
    parsedDescription: row.description?.trim(),
    quantity,
    unitCost,
    purchaseCost,
    purchaseDate: row.purchase_date?.trim() || new Date().toISOString().split('T')[0],
    serialNumber: row.serial_number?.trim(),
    suggestedCategory: category,
    suggestedUsefulLifeMonths: usefulLife,
    suggestedSalvageValue: parseSalvageValue(row.salvage_value),
    confidenceScore: row.category ? 0.95 : suggestion.confidence,
    // User-editable defaults
    category,
    usefulLifeMonths: usefulLife,
    salvageValue: parseSalvageValue(row.salvage_value),
    description: row.description?.trim(),
    importStatus: 'pending'
  };

  // Add location if provided (stored as locationId, but CSV provides location name)
  // Note: locationId mapping to actual location record should be done during import
  if (row.location?.trim()) {
    // Store location name in description if no locationId mapping available
    // The import process should resolve this to an actual locationId
    item.description = item.description
      ? `${item.description} | Location: ${row.location.trim()}`
      : `Location: ${row.location.trim()}`;
  }

  return item;
}
