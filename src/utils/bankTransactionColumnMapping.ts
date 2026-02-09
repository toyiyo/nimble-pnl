/**
 * Heuristics-based column mapping for bank CSV/Excel imports.
 * Uses keyword pattern matching and confidence scoring to auto-detect columns.
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

export interface BankColumnMapping {
  csvColumn: string;
  targetField: string | null;
  confidence: ConfidenceLevel;
}

export interface BankMappingValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface DetectedAccountInfo {
  accountMask?: string;
  institutionName?: string;
  accountType?: string;
}

// Target field definitions
export const BANK_TARGET_FIELDS = [
  { value: 'transactionDate', label: 'Transaction Date', required: true },
  { value: 'postedDate', label: 'Posted Date', required: false },
  { value: 'description', label: 'Description', required: true },
  { value: 'amount', label: 'Amount (signed)', required: false },
  { value: 'debitAmount', label: 'Debit / Withdrawal', required: false },
  { value: 'creditAmount', label: 'Credit / Deposit', required: false },
  { value: 'balance', label: 'Balance', required: false },
  { value: 'checkNumber', label: 'Check Number', required: false },
  { value: 'referenceNumber', label: 'Reference Number', required: false },
  { value: 'category', label: 'Category', required: false },
  { value: 'ignore', label: '(Ignore this column)', required: false },
] as const;

interface KeywordPattern {
  keywords: string[];
  weight: number;
}

const FIELD_PATTERNS: Record<string, KeywordPattern> = {
  transactionDate: {
    keywords: [
      'transaction date', 'trans date', 'date', 'transaction_date',
      'effective date', 'value date',
    ],
    weight: 10,
  },
  postedDate: {
    keywords: [
      'posted date', 'posting date', 'post date', 'posted_date', 'posting_date',
    ],
    weight: 9,
  },
  description: {
    keywords: [
      'description', 'memo', 'payee', 'merchant', 'details', 'narrative',
      'transaction description', 'particulars', 'name',
    ],
    weight: 10,
  },
  amount: {
    keywords: [
      'amount', 'transaction amount', 'trans amount',
    ],
    weight: 8,
  },
  debitAmount: {
    keywords: [
      'debit', 'withdrawal', 'withdrawals', 'money out', 'charges',
      'debit amount', 'debits',
    ],
    weight: 9,
  },
  creditAmount: {
    keywords: [
      'credit', 'deposit', 'deposits', 'money in',
      'credit amount', 'credits',
    ],
    weight: 9,
  },
  balance: {
    keywords: [
      'balance', 'running balance', 'available balance', 'ending balance',
      'ledger balance',
    ],
    weight: 7,
  },
  checkNumber: {
    keywords: [
      'check number', 'check #', 'check no', 'check or slip #',
      'check', 'cheque number',
    ],
    weight: 6,
  },
  referenceNumber: {
    keywords: [
      'reference', 'ref', 'reference number', 'ref #', 'transaction id',
      'confirmation', 'trace number',
    ],
    weight: 6,
  },
  category: {
    keywords: [
      'category', 'type', 'transaction type',
    ],
    weight: 5,
  },
};

function scoreToConfidence(score: number): ConfidenceLevel {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'low';
  return 'none';
}

function calculateConfidence(
  csvColumn: string,
  targetField: string
): { score: number; confidence: ConfidenceLevel } {
  const pattern = FIELD_PATTERNS[targetField];
  if (!pattern) return { score: 0, confidence: 'none' };

  const normalized = csvColumn.toLowerCase().trim();
  let score = 0;

  // Exact match
  if (pattern.keywords.some((kw) => normalized === kw.toLowerCase())) {
    score = pattern.weight * 10;
  }
  // Contains match
  else if (pattern.keywords.some((kw) => normalized.includes(kw.toLowerCase()))) {
    score = pattern.weight * 7;
  }
  // Partial word match
  else if (
    pattern.keywords.some((kw) => {
      const kwWords = kw.toLowerCase().split(' ');
      return kwWords.every((word) => normalized.includes(word));
    })
  ) {
    score = pattern.weight * 5;
  }

  return { score, confidence: scoreToConfidence(score) };
}

/**
 * Auto-detect column mappings from CSV headers and sample data.
 */
export function suggestBankColumnMappings(
  headers: string[],
  _sampleData: Record<string, string>[]
): BankColumnMapping[] {
  const mappings: BankColumnMapping[] = [];
  const mappedFields = new Set<string>();

  // First pass: find best match for each header
  headers.forEach((csvColumn) => {
    let bestMatch: {
      field: string;
      score: number;
      confidence: ConfidenceLevel;
    } | null = null;

    Object.keys(FIELD_PATTERNS).forEach((targetField) => {
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
      mappings.push({
        csvColumn,
        targetField: null,
        confidence: 'none',
      });
    }
  });

  // Disambiguation: if both transactionDate and postedDate are mapped,
  // keep both. If only one date-like column is found, prefer transactionDate.
  const hasTransactionDate = mappings.some((m) => m.targetField === 'transactionDate');
  if (!hasTransactionDate) {
    const postedDateMapping = mappings.find((m) => m.targetField === 'postedDate');
    if (postedDateMapping) {
      postedDateMapping.targetField = 'transactionDate';
    }
  }

  return mappings;
}

/**
 * Validate that mappings have all required fields.
 */
export function validateBankMappings(mappings: BankColumnMapping[]): BankMappingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasDate = mappings.some(
    (m) => m.targetField === 'transactionDate' || m.targetField === 'postedDate'
  );
  const hasDescription = mappings.some((m) => m.targetField === 'description');
  const hasAmount = mappings.some((m) => m.targetField === 'amount');
  const hasDebit = mappings.some((m) => m.targetField === 'debitAmount');
  const hasCredit = mappings.some((m) => m.targetField === 'creditAmount');
  const hasAmountInfo = hasAmount || (hasDebit && hasCredit);

  if (!hasDate) {
    errors.push('A date column is required (Transaction Date or Posted Date)');
  }
  if (!hasDescription) {
    errors.push('A description column is required');
  }
  if (!hasAmountInfo) {
    if (hasDebit && !hasCredit) {
      errors.push('When using Debit column, a Credit column is also required');
    } else if (hasCredit && !hasDebit) {
      errors.push('When using Credit column, a Debit column is also required');
    } else {
      errors.push(
        'An amount column is required — either a single Amount column or separate Debit and Credit columns'
      );
    }
  }

  if (hasAmount && (hasDebit || hasCredit)) {
    warnings.push(
      'Both Amount and Debit/Credit columns are mapped. The Amount column will take precedence.'
    );
  }

  // Check for duplicate non-ignore mappings
  const nonIgnoreMappings = mappings.filter(
    (m): m is BankColumnMapping & { targetField: string } =>
      m.targetField !== null && m.targetField !== 'ignore'
  );
  const seen = new Set<string>();
  for (const m of nonIgnoreMappings) {
    if (seen.has(m.targetField)) {
      errors.push(`Duplicate mapping: "${m.targetField}" is mapped to multiple columns`);
    }
    seen.add(m.targetField);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Account mask patterns: ****1234, ...1234, x1234, ending in 1234
const ACCOUNT_MASK_PATTERNS = [
  /\*{2,}(\d{4})/,
  /\.{3,}(\d{4})/,
  /[xX]{2,}(\d{4})/,
  /ending\s+in\s+(\d{4})/i,
  /account\s+#?\s*\*+\s*(\d{4})/i,
];

const INSTITUTION_PATTERNS = [
  { keywords: ['chase', 'jpmorgan'], name: 'Chase' },
  { keywords: ['bank of america', 'bofa', 'bankofamerica'], name: 'Bank of America' },
  { keywords: ['wells fargo', 'wellsfargo'], name: 'Wells Fargo' },
  { keywords: ['citi', 'citibank'], name: 'Citibank' },
  { keywords: ['capital one', 'capitalone'], name: 'Capital One' },
  { keywords: ['us bank', 'usbank'], name: 'US Bank' },
  { keywords: ['pnc'], name: 'PNC Bank' },
  { keywords: ['td bank', 'tdbank'], name: 'TD Bank' },
  { keywords: ['american express', 'amex'], name: 'American Express' },
  { keywords: ['discover'], name: 'Discover' },
];

const ACCOUNT_TYPE_PATTERNS = [
  { keywords: ['checking', 'dda'], type: 'checking' },
  { keywords: ['savings', 'sav'], type: 'savings' },
  { keywords: ['credit card', 'credit_card', 'cc'], type: 'credit_card' },
  { keywords: ['money market', 'mma'], type: 'money_market' },
];

/**
 * Scan raw CSV lines and filename for account information.
 */
export function detectAccountInfoFromCSV(
  rawLines: string[],
  filename: string
): DetectedAccountInfo {
  const result: DetectedAccountInfo = {};
  const linesToScan = rawLines.slice(0, 10).join('\n');

  for (const pattern of ACCOUNT_MASK_PATTERNS) {
    const match = pattern.exec(linesToScan) || pattern.exec(filename);
    if (match) {
      result.accountMask = match[1];
      break;
    }
  }

  const searchText = `${linesToScan} ${filename}`.toLowerCase();

  for (const inst of INSTITUTION_PATTERNS) {
    if (inst.keywords.some((kw) => searchText.includes(kw))) {
      result.institutionName = inst.name;
      break;
    }
  }

  for (const tp of ACCOUNT_TYPE_PATTERNS) {
    if (tp.keywords.some((kw) => searchText.includes(kw))) {
      result.accountType = tp.type;
      break;
    }
  }

  return result;
}

/**
 * Parse a bank amount string, handling various formats:
 * - Signed amounts: -123.45, 123.45
 * - Currency symbols: $123.45, ($123.45)
 * - Parentheses negatives: (123.45)
 * - Comma separators: 1,234.56
 * - Split debit/credit columns
 */
export function parseBankAmount(
  value?: string,
  debitValue?: string,
  creditValue?: string
): number | null {
  // If we have a single amount value, parse it
  if (value != null && value !== '') {
    return parseSingleAmount(value);
  }

  // Handle split debit/credit columns
  const debit = debitValue ? parseSingleAmount(debitValue) : null;
  const credit = creditValue ? parseSingleAmount(creditValue) : null;

  if (debit !== null && debit !== 0) {
    // Debits are negative (money out)
    return -Math.abs(debit);
  }
  if (credit !== null && credit !== 0) {
    // Credits are positive (money in)
    return Math.abs(credit);
  }

  // Both empty or zero
  if (debit === 0 && credit === 0) return 0;
  if (debit !== null) return -Math.abs(debit);
  if (credit !== null) return Math.abs(credit);

  return null;
}

function parseSingleAmount(raw: string): number | null {
  if (!raw || typeof raw !== 'string') return null;

  let str = raw.trim();
  if (str === '' || str === '-') return null;

  // Check for parentheses negatives: (123.45)
  let isNegative = false;
  if (str.startsWith('(') && str.endsWith(')')) {
    isNegative = true;
    str = str.slice(1, -1);
  }

  // Remove currency symbols and whitespace
  str = str.replaceAll(/[$€£¥₹\s]/g, '');

  // Handle explicit negative sign
  if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1);
  }

  // Remove comma separators
  str = str.replaceAll(',', '');

  const num = Number.parseFloat(str);
  if (Number.isNaN(num)) return null;

  return isNegative ? -num : num;
}
