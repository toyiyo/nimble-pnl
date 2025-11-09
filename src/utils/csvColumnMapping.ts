import { ColumnMapping } from '@/components/ColumnMappingDialog';

/**
 * Heuristics-based column mapping for CSV imports
 * Uses pattern matching and keyword detection to suggest field mappings
 */

interface KeywordPattern {
  keywords: string[];
  aliases?: string[];
  weight: number;
}

// Patterns for detecting different field types
const FIELD_PATTERNS: Record<string, KeywordPattern> = {
  itemName: {
    keywords: ['item', 'name', 'product', 'menu', 'dish', 'modifier'],
    weight: 10,
  },
  quantity: {
    keywords: ['qty', 'quantity', 'count', 'number', 'amount sold'],
    aliases: ['qty sold', '#'],
    weight: 8,
  },
  unitPrice: {
    keywords: ['unit price', 'price', 'default price', 'avg price', 'avg. price', 'avg. item price'],
    aliases: ['unit_price', 'item price'],
    weight: 7,
  },
  totalPrice: {
    keywords: ['total', 'amount', 'total price', 'total amount'],
    aliases: ['total_price', 'total_amount'],
    weight: 6,
  },
  grossSales: {
    keywords: ['gross sales', 'gross', 'gross revenue'],
    weight: 9,
  },
  netSales: {
    keywords: ['net sales', 'net', 'net revenue', 'net sales w/o'],
    weight: 9,
  },
  discount: {
    keywords: ['discount', 'discounts', 'discount amount', 'discount total'],
    weight: 8,
  },
  tax: {
    keywords: ['tax', 'taxes', 'sales tax', 'tax amount'],
    weight: 8,
  },
  tip: {
    keywords: ['tip', 'tips', 'gratuity'],
    weight: 8,
  },
  serviceCharge: {
    keywords: ['service charge', 'service', 'surcharge', 'auto gratuity'],
    weight: 8,
  },
  fee: {
    keywords: ['fee', 'fees', 'processing fee', 'delivery fee'],
    weight: 7,
  },
  saleDate: {
    keywords: ['date', 'sale date', 'order date', 'transaction date'],
    aliases: ['sale_date', 'order_date'],
    weight: 9,
  },
  saleTime: {
    keywords: ['time', 'sale time', 'order time'],
    aliases: ['sale_time'],
    weight: 7,
  },
  orderId: {
    keywords: ['order id', 'transaction id', 'check', 'check number', 'receipt'],
    aliases: ['order_id', 'transaction_id', 'check #'],
    weight: 8,
  },
  category: {
    keywords: ['category', 'sales category', 'item category'],
    weight: 6,
  },
  department: {
    keywords: ['department', 'dept', 'revenue class'],
    weight: 6,
  },
};

/**
 * Calculate confidence score for a potential field mapping
 */
function calculateConfidence(csvColumn: string, targetField: string): {
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
} {
  const pattern = FIELD_PATTERNS[targetField];
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

  const confidence: 'high' | 'medium' | 'low' | 'none' =
    score >= 70 ? 'high' :
    score >= 40 ? 'medium' :
    score >= 20 ? 'low' :
    'none';

  return { score, confidence };
}

/**
 * Detect if a row appears to be a summary/total row
 */
export function isSummaryRow(row: Record<string, string>): {
  isSummary: boolean;
  reason?: string;
} {
  const firstColumn = Object.values(row)[0]?.toLowerCase().trim() || '';
  const firstKey = Object.keys(row)[0]?.toLowerCase().trim() || '';

  // Check for "totals", "total", "summary", "subtotal" etc. in first column value
  const summaryKeywords = ['total', 'totals:', 'subtotal', 'summary', 'grand total'];
  if (summaryKeywords.some(kw => firstColumn.startsWith(kw))) {
    return {
      isSummary: true,
      reason: `Row starts with "${firstColumn}" which appears to be a summary row`,
    };
  }

  // Check if the first column is empty but other numeric columns have values
  // (common in POS exports where totals row has no item name)
  if (!firstColumn && firstKey.includes('item')) {
    const hasNumericValues = Object.entries(row).some(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      return (
        (normalizedKey.includes('total') || normalizedKey.includes('sum')) &&
        value && !isNaN(parseFloat(value))
      );
    });
    if (hasNumericValues) {
      return {
        isSummary: true,
        reason: 'Row has no item name but contains total amounts',
      };
    }
  }

  return { isSummary: false };
}

/**
 * Suggest column mappings based on CSV headers and sample data
 */
export function suggestColumnMappings(
  headers: string[],
  sampleData: Record<string, string>[]
): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];

  // Track which target fields have been mapped to avoid duplicates
  const mappedFields = new Set<string>();

  headers.forEach(csvColumn => {
    let bestMatch: { field: string; score: number; confidence: 'high' | 'medium' | 'low' | 'none' } | null = null;

    // Try to match against each target field
    Object.keys(FIELD_PATTERNS).forEach(targetField => {
      const { score, confidence } = calculateConfidence(csvColumn, targetField);
      
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        // Don't duplicate non-adjustment fields
        const fieldDef = FIELD_PATTERNS[targetField];
        const isAdjustment = ['discount', 'tax', 'tip', 'serviceCharge', 'fee'].includes(targetField);
        
        if (isAdjustment || !mappedFields.has(targetField)) {
          bestMatch = { field: targetField, score, confidence };
        }
      }
    });

    if (bestMatch && bestMatch.confidence !== 'none') {
      mappedFields.add(bestMatch.field);
      
      const isAdjustment = ['discount', 'tax', 'tip', 'serviceCharge', 'fee'].includes(bestMatch.field);
      const adjustmentTypeMap: Record<string, 'discount' | 'tax' | 'tip' | 'service_charge' | 'fee'> = {
        discount: 'discount',
        tax: 'tax',
        tip: 'tip',
        serviceCharge: 'service_charge',
        fee: 'fee',
      };

      mappings.push({
        csvColumn,
        targetField: bestMatch.field,
        confidence: bestMatch.confidence,
        isAdjustment,
        adjustmentType: isAdjustment ? adjustmentTypeMap[bestMatch.field] : undefined,
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

  // Post-process: ensure we have at least item name
  const hasItemName = mappings.some(m => m.targetField === 'itemName');
  if (!hasItemName) {
    // Find the first text column and suggest it as item name
    const firstTextColumn = mappings.find(m => {
      const samples = sampleData.slice(0, 5).map(row => row[m.csvColumn]);
      const hasText = samples.some(v => v && isNaN(parseFloat(v)));
      return hasText && !m.targetField;
    });
    
    if (firstTextColumn) {
      firstTextColumn.targetField = 'itemName';
      firstTextColumn.confidence = 'low';
    }
  }

  // Post-process: if we have both gross and net sales, prefer net sales
  const hasGrossSales = mappings.some(m => m.targetField === 'grossSales');
  const hasNetSales = mappings.some(m => m.targetField === 'netSales');
  if (hasGrossSales && hasNetSales) {
    // Keep netSales, unmap grossSales (user can re-map if needed)
    const grossMapping = mappings.find(m => m.targetField === 'grossSales');
    if (grossMapping) {
      grossMapping.targetField = null;
      grossMapping.confidence = 'none';
    }
  }

  return mappings;
}

/**
 * Check if mappings are sufficient for import
 */
export function validateMappings(mappings: ColumnMapping[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  const hasItemName = mappings.some(m => m.targetField === 'itemName');
  if (!hasItemName) {
    errors.push('Item Name field is required');
  }

  const hasPrice = mappings.some(m => 
    m.targetField === 'totalPrice' || 
    m.targetField === 'unitPrice' || 
    m.targetField === 'grossSales' ||
    m.targetField === 'netSales'
  );
  if (!hasPrice) {
    errors.push('At least one price field is required (Total Price, Unit Price, Gross Sales, or Net Sales)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
