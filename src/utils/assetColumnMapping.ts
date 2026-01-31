/**
 * Heuristics-based column mapping for Asset CSV imports
 * Uses pattern matching and keyword detection to suggest field mappings
 */

/**
 * Parse a CSV line handling quoted values with escaped quotes
 */
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

export interface AssetColumnMapping {
  csvColumn: string;
  targetField: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

interface KeywordPattern {
  keywords: string[];
  aliases?: string[];
  weight: number;
}

// Patterns for detecting different asset field types
const ASSET_FIELD_PATTERNS: Record<string, KeywordPattern> = {
  name: {
    keywords: ['name', 'asset', 'item', 'equipment', 'description', 'title'],
    aliases: ['asset_name', 'item_name', 'equipment_name'],
    weight: 10,
  },
  category: {
    keywords: ['category', 'type', 'class', 'asset type', 'equipment type'],
    aliases: ['asset_category', 'asset_type', 'asset_class'],
    weight: 8,
  },
  purchase_date: {
    keywords: ['purchase date', 'date purchased', 'acquisition date', 'bought date', 'date'],
    aliases: ['purchase_date', 'acquired_date', 'acquisition_date', 'bought'],
    weight: 9,
  },
  purchase_cost: {
    keywords: ['purchase cost', 'cost', 'price', 'amount', 'purchase price', 'acquisition cost', 'value', 'total', 'line total', 'extended'],
    aliases: ['purchase_cost', 'purchase_price', 'original_cost', 'acquisition_cost', 'line_total', 'ext_price', 'extended_price', 'unit_price'],
    weight: 9,
  },
  salvage_value: {
    keywords: ['salvage value', 'salvage', 'residual value', 'residual', 'scrap value'],
    aliases: ['salvage_value', 'residual_value', 'scrap_value'],
    weight: 7,
  },
  useful_life_months: {
    keywords: ['useful life', 'life', 'lifespan', 'depreciation period', 'months'],
    aliases: ['useful_life', 'useful_life_months', 'life_months', 'depreciation_months'],
    weight: 7,
  },
  serial_number: {
    keywords: ['serial number', 'serial', 'sn', 'serial #', 'model number', 'asset tag'],
    aliases: ['serial_number', 'serial_no', 'asset_tag', 'model_number'],
    weight: 8,
  },
  description: {
    keywords: ['description', 'details', 'notes', 'memo', 'remarks', 'specs'],
    aliases: ['asset_description', 'item_description'],
    weight: 6,
  },
  location: {
    keywords: ['location', 'site', 'place', 'room', 'area', 'department'],
    aliases: ['asset_location', 'installed_at'],
    weight: 6,
  },
  vendor: {
    keywords: ['vendor', 'supplier', 'manufacturer', 'brand', 'make', 'seller'],
    aliases: ['vendor_name', 'supplier_name', 'purchased_from'],
    weight: 6,
  },
  warranty_expiry: {
    keywords: ['warranty', 'warranty expiry', 'warranty end', 'warranty date'],
    aliases: ['warranty_expiry', 'warranty_end_date', 'warranty_expires'],
    weight: 5,
  },
  condition: {
    keywords: ['condition', 'status', 'state'],
    aliases: ['asset_condition', 'current_condition'],
    weight: 5,
  },
};

/**
 * Calculate confidence score for a potential field mapping
 */
function calculateConfidence(csvColumn: string, targetField: string): {
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
} {
  const pattern = ASSET_FIELD_PATTERNS[targetField];
  if (!pattern) return { score: 0, confidence: 'none' };

  const normalizedColumn = csvColumn.toLowerCase().trim();
  let score = 0;

  // Check for exact matches
  if (pattern.keywords.some(kw => normalizedColumn === kw.toLowerCase())) {
    score = pattern.weight * 10;
  }
  // Check for aliases
  else if (pattern.aliases?.some(alias => normalizedColumn === alias.toLowerCase())) {
    score = pattern.weight * 9;
  }
  // Check for contains
  else if (pattern.keywords.some(kw => normalizedColumn.includes(kw.toLowerCase()))) {
    score = pattern.weight * 7;
  }
  // Check for partial match (word boundaries)
  else if (pattern.keywords.some(kw => {
    const kwWords = kw.toLowerCase().split(' ');
    return kwWords.every(word => normalizedColumn.includes(word));
  })) {
    score = pattern.weight * 5;
  }

  let confidence: 'high' | 'medium' | 'low' | 'none';
  if (score >= 70) {
    confidence = 'high';
  } else if (score >= 40) {
    confidence = 'medium';
  } else if (score >= 20) {
    confidence = 'low';
  } else {
    confidence = 'none';
  }

  return { score, confidence };
}

/**
 * Suggest column mappings based on CSV headers and sample data
 */
export function suggestAssetColumnMappings(
  headers: string[],
  sampleData: Record<string, string>[]
): AssetColumnMapping[] {
  const mappings: AssetColumnMapping[] = [];

  // Track which target fields have been mapped to avoid duplicates
  const mappedFields = new Set<string>();

  headers.forEach(csvColumn => {
    let bestMatch: { field: string; score: number; confidence: 'high' | 'medium' | 'low' | 'none' } | null = null;

    // Try to match against each target field
    Object.keys(ASSET_FIELD_PATTERNS).forEach(targetField => {
      const { score, confidence } = calculateConfidence(csvColumn, targetField);

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        if (!mappedFields.has(targetField)) {
          bestMatch = { field: targetField, score, confidence };
        }
      }
    });

    if (bestMatch && bestMatch.confidence !== 'none') {
      mappedFields.add(bestMatch.field);

      mappings.push({
        csvColumn,
        targetField: bestMatch.field,
        confidence: bestMatch.confidence,
      });
    } else {
      // No confident match - leave unmapped
      mappings.push({
        csvColumn,
        targetField: null,
        confidence: 'none',
      });
    }
  });

  // Post-process: ensure we have at least asset name
  const hasName = mappings.some(m => m.targetField === 'name');
  if (!hasName) {
    // Find the first text column and suggest it as name
    const firstTextColumn = mappings.find(m => {
      const samples = sampleData.slice(0, 5).map(row => row[m.csvColumn]);
      const hasText = samples.some(v => v && Number.isNaN(Number.parseFloat(v)));
      return hasText && !m.targetField;
    });

    if (firstTextColumn) {
      firstTextColumn.targetField = 'name';
      firstTextColumn.confidence = 'low';
    }
  }

  // Post-process: try to infer date columns from sample data format
  const unmappedColumns = mappings.filter(m => !m.targetField);
  const datePattern = /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/;

  for (const mapping of unmappedColumns) {
    const samples = sampleData.slice(0, 5).map(row => row[mapping.csvColumn]);
    const hasDateFormat = samples.some(v => v && datePattern.test(v.trim()));

    if (hasDateFormat && !mappedFields.has('purchase_date')) {
      mapping.targetField = 'purchase_date';
      mapping.confidence = 'medium';
      mappedFields.add('purchase_date');
      break;
    }
  }

  // Post-process: try to infer cost columns from numeric data with currency patterns
  const currencyPattern = /^[$€£]?\s*[\d,]+\.?\d*$/;
  for (const mapping of unmappedColumns) {
    if (mapping.targetField) continue;

    const samples = sampleData.slice(0, 5).map(row => row[mapping.csvColumn]);
    const hasCurrencyFormat = samples.some(v => v && currencyPattern.test(v.trim()));

    if (hasCurrencyFormat && !mappedFields.has('purchase_cost')) {
      mapping.targetField = 'purchase_cost';
      mapping.confidence = 'medium';
      mappedFields.add('purchase_cost');
      break;
    }
  }

  return mappings;
}

/**
 * Check if mappings are sufficient for asset import
 */
export function validateAssetMappings(mappings: AssetColumnMapping[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasName = mappings.some(m => m.targetField === 'name');
  if (!hasName) {
    errors.push('Asset Name field is required - please map at least one column to Name');
  }

  const hasPurchaseDate = mappings.some(m => m.targetField === 'purchase_date');
  if (!hasPurchaseDate) {
    errors.push('Purchase Date field is required - please map a column to Purchase Date');
  }

  const hasPurchaseCost = mappings.some(m => m.targetField === 'purchase_cost');
  if (!hasPurchaseCost) {
    errors.push('Purchase Cost field is required - please map a column to Purchase Cost');
  }

  // Warnings for optional but recommended fields
  const hasCategory = mappings.some(m => m.targetField === 'category');
  if (!hasCategory) {
    warnings.push('No Category column mapped - assets will use default category based on name');
  }

  const hasUsefulLife = mappings.some(m => m.targetField === 'useful_life_months');
  if (!hasUsefulLife) {
    warnings.push('No Useful Life column mapped - depreciation will use category defaults');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Target fields available for asset mapping
 */
export const ASSET_TARGET_FIELDS = [
  { value: 'name', label: 'Asset Name', required: true },
  { value: 'category', label: 'Category', required: false },
  { value: 'purchase_date', label: 'Purchase Date', required: true },
  { value: 'purchase_cost', label: 'Purchase Cost', required: true },
  { value: 'salvage_value', label: 'Salvage Value', required: false },
  { value: 'useful_life_months', label: 'Useful Life (Months)', required: false },
  { value: 'serial_number', label: 'Serial Number', required: false },
  { value: 'description', label: 'Description', required: false },
  { value: 'location', label: 'Location', required: false },
  { value: 'vendor', label: 'Vendor/Supplier', required: false },
  { value: 'warranty_expiry', label: 'Warranty Expiry', required: false },
  { value: 'condition', label: 'Condition', required: false },
  { value: 'ignore', label: '(Ignore this column)', required: false },
];
