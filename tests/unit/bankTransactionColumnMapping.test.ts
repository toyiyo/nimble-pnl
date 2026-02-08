import { describe, it, expect } from 'vitest';
import {
  suggestBankColumnMappings,
  validateBankMappings,
  parseBankAmount,
  detectAccountInfoFromCSV,
  type BankColumnMapping,
} from '@/utils/bankTransactionColumnMapping';

describe('suggestBankColumnMappings', () => {
  it('maps standard Chase CSV headers correctly', () => {
    // Chase CSV: Details contains transaction narrative, Description has merchant info
    const headers = ['Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance', 'Check or Slip #'];
    const mappings = suggestBankColumnMappings(headers, []);

    const dateMapping = mappings.find((m) => m.targetField === 'transactionDate');
    expect(dateMapping).toBeDefined();
    expect(dateMapping!.csvColumn).toBe('Posting Date');

    // "Details" matches description keyword "details" first via contains check
    const descMapping = mappings.find((m) => m.targetField === 'description');
    expect(descMapping).toBeDefined();
    expect(descMapping!.csvColumn).toBe('Details');

    const amountMapping = mappings.find((m) => m.targetField === 'amount');
    expect(amountMapping).toBeDefined();
    expect(amountMapping!.csvColumn).toBe('Amount');

    const balanceMapping = mappings.find((m) => m.targetField === 'balance');
    expect(balanceMapping).toBeDefined();
    expect(balanceMapping!.csvColumn).toBe('Balance');

    const checkMapping = mappings.find((m) => m.targetField === 'checkNumber');
    expect(checkMapping).toBeDefined();
    expect(checkMapping!.csvColumn).toBe('Check or Slip #');
  });

  it('maps split debit/credit columns (BofA format)', () => {
    const headers = ['Date', 'Description', 'Debit', 'Credit', 'Running Balance'];
    const mappings = suggestBankColumnMappings(headers, []);

    expect(mappings.find((m) => m.targetField === 'transactionDate')).toBeDefined();
    expect(mappings.find((m) => m.targetField === 'description')).toBeDefined();
    expect(mappings.find((m) => m.targetField === 'debitAmount')).toBeDefined();
    expect(mappings.find((m) => m.targetField === 'creditAmount')).toBeDefined();
    expect(mappings.find((m) => m.targetField === 'balance')).toBeDefined();
  });

  it('disambiguates Transaction Date vs Posted Date when both present', () => {
    const headers = ['Transaction Date', 'Posted Date', 'Description', 'Amount'];
    const mappings = suggestBankColumnMappings(headers, []);

    expect(mappings.find((m) => m.targetField === 'transactionDate')?.csvColumn).toBe(
      'Transaction Date'
    );
    expect(mappings.find((m) => m.targetField === 'postedDate')?.csvColumn).toBe(
      'Posted Date'
    );
  });

  it('promotes postedDate to transactionDate when no transactionDate found', () => {
    const headers = ['Posted Date', 'Memo', 'Amount'];
    const mappings = suggestBankColumnMappings(headers, []);

    // Should remap posted date → transaction date since no explicit txn date exists
    expect(mappings.find((m) => m.targetField === 'transactionDate')).toBeDefined();
    expect(mappings.find((m) => m.targetField === 'postedDate')).toBeUndefined();
  });

  it('sets unmapped columns to null targetField', () => {
    const headers = ['Date', 'Description', 'Amount', 'SomeRandomColumn'];
    const mappings = suggestBankColumnMappings(headers, []);

    const unmapped = mappings.find((m) => m.csvColumn === 'SomeRandomColumn');
    expect(unmapped).toBeDefined();
    expect(unmapped!.targetField).toBeNull();
    expect(unmapped!.confidence).toBe('none');
  });
});

describe('validateBankMappings', () => {
  it('accepts valid mappings with date + description + amount', () => {
    const mappings: BankColumnMapping[] = [
      { csvColumn: 'Date', targetField: 'transactionDate', confidence: 'high' },
      { csvColumn: 'Desc', targetField: 'description', confidence: 'high' },
      { csvColumn: 'Amount', targetField: 'amount', confidence: 'high' },
    ];

    const result = validateBankMappings(mappings);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid mappings with date + description + debit + credit', () => {
    const mappings: BankColumnMapping[] = [
      { csvColumn: 'Date', targetField: 'transactionDate', confidence: 'high' },
      { csvColumn: 'Desc', targetField: 'description', confidence: 'high' },
      { csvColumn: 'Debit', targetField: 'debitAmount', confidence: 'high' },
      { csvColumn: 'Credit', targetField: 'creditAmount', confidence: 'high' },
    ];

    const result = validateBankMappings(mappings);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing date', () => {
    const mappings: BankColumnMapping[] = [
      { csvColumn: 'Desc', targetField: 'description', confidence: 'high' },
      { csvColumn: 'Amount', targetField: 'amount', confidence: 'high' },
    ];

    const result = validateBankMappings(mappings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('date'))).toBe(true);
  });

  it('rejects missing description', () => {
    const mappings: BankColumnMapping[] = [
      { csvColumn: 'Date', targetField: 'transactionDate', confidence: 'high' },
      { csvColumn: 'Amount', targetField: 'amount', confidence: 'high' },
    ];

    const result = validateBankMappings(mappings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('description'))).toBe(true);
  });

  it('rejects missing amount when no debit+credit', () => {
    const mappings: BankColumnMapping[] = [
      { csvColumn: 'Date', targetField: 'transactionDate', confidence: 'high' },
      { csvColumn: 'Desc', targetField: 'description', confidence: 'high' },
    ];

    const result = validateBankMappings(mappings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('amount') || e.includes('Amount'))).toBe(true);
  });

  it('rejects debit without credit', () => {
    const mappings: BankColumnMapping[] = [
      { csvColumn: 'Date', targetField: 'transactionDate', confidence: 'high' },
      { csvColumn: 'Desc', targetField: 'description', confidence: 'high' },
      { csvColumn: 'Debit', targetField: 'debitAmount', confidence: 'high' },
    ];

    const result = validateBankMappings(mappings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Credit'))).toBe(true);
  });

  it('warns when both amount and debit/credit are mapped', () => {
    const mappings: BankColumnMapping[] = [
      { csvColumn: 'Date', targetField: 'transactionDate', confidence: 'high' },
      { csvColumn: 'Desc', targetField: 'description', confidence: 'high' },
      { csvColumn: 'Amount', targetField: 'amount', confidence: 'high' },
      { csvColumn: 'Debit', targetField: 'debitAmount', confidence: 'high' },
      { csvColumn: 'Credit', targetField: 'creditAmount', confidence: 'high' },
    ];

    const result = validateBankMappings(mappings);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects duplicate mappings', () => {
    const mappings: BankColumnMapping[] = [
      { csvColumn: 'Date', targetField: 'transactionDate', confidence: 'high' },
      { csvColumn: 'Date2', targetField: 'transactionDate', confidence: 'high' },
      { csvColumn: 'Desc', targetField: 'description', confidence: 'high' },
      { csvColumn: 'Amount', targetField: 'amount', confidence: 'high' },
    ];

    const result = validateBankMappings(mappings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });
});

describe('parseBankAmount', () => {
  it('parses simple positive amounts', () => {
    expect(parseBankAmount('123.45')).toBe(123.45);
    expect(parseBankAmount('0.01')).toBe(0.01);
    expect(parseBankAmount('1000')).toBe(1000);
  });

  it('parses simple negative amounts', () => {
    expect(parseBankAmount('-123.45')).toBe(-123.45);
    expect(parseBankAmount('-0.01')).toBe(-0.01);
  });

  it('parses parentheses negatives', () => {
    expect(parseBankAmount('(123.45)')).toBe(-123.45);
    expect(parseBankAmount('(1,234.56)')).toBe(-1234.56);
  });

  it('parses amounts with currency symbols', () => {
    expect(parseBankAmount('$123.45')).toBe(123.45);
    expect(parseBankAmount('-$123.45')).toBe(-123.45);
    expect(parseBankAmount('($123.45)')).toBe(-123.45);
  });

  it('parses amounts with comma separators', () => {
    expect(parseBankAmount('1,234.56')).toBe(1234.56);
    expect(parseBankAmount('1,234,567.89')).toBe(1234567.89);
    expect(parseBankAmount('-1,234.56')).toBe(-1234.56);
  });

  it('handles split debit/credit columns', () => {
    // Debit (money out) → negative
    expect(parseBankAmount(undefined, '100.00', '')).toBe(-100);
    expect(parseBankAmount(undefined, '100.00', undefined)).toBe(-100);

    // Credit (money in) → positive
    expect(parseBankAmount(undefined, '', '200.00')).toBe(200);
    expect(parseBankAmount(undefined, undefined, '200.00')).toBe(200);
  });

  it('returns null for empty/invalid values', () => {
    expect(parseBankAmount('')).toBeNull();
    expect(parseBankAmount(undefined)).toBeNull();
    expect(parseBankAmount('abc')).toBeNull();
    expect(parseBankAmount('-')).toBeNull();
  });

  it('returns null when no values provided at all', () => {
    expect(parseBankAmount(undefined, undefined, undefined)).toBeNull();
    expect(parseBankAmount(undefined, '', '')).toBeNull();
  });

  it('handles zero values in split columns', () => {
    expect(parseBankAmount(undefined, '0', '0')).toBe(0);
  });

  it('prefers single amount over split columns', () => {
    // When value is provided, debit/credit should be ignored
    expect(parseBankAmount('50.00', '100.00', '200.00')).toBe(50);
  });
});

describe('detectAccountInfoFromCSV', () => {
  it('detects account mask from raw lines', () => {
    const rawLines = ['Account Number: ****1234', 'Date,Description,Amount'];
    const result = detectAccountInfoFromCSV(rawLines, 'statement.csv');
    expect(result.accountMask).toBe('1234');
  });

  it('detects account mask with dots pattern', () => {
    const rawLines = ['Account: ...5678', 'Date,Description,Amount'];
    const result = detectAccountInfoFromCSV(rawLines, 'statement.csv');
    expect(result.accountMask).toBe('5678');
  });

  it('detects account mask from "ending in" pattern', () => {
    const rawLines = ['Account ending in 9012', 'Date,Description,Amount'];
    const result = detectAccountInfoFromCSV(rawLines, 'statement.csv');
    expect(result.accountMask).toBe('9012');
  });

  it('detects institution name from filename', () => {
    const result = detectAccountInfoFromCSV([], 'Chase_Checking_2024.csv');
    expect(result.institutionName).toBe('Chase');
  });

  it('detects institution name from raw lines', () => {
    const rawLines = ['Bank of America Statement', 'Date,Description,Amount'];
    const result = detectAccountInfoFromCSV(rawLines, 'statement.csv');
    expect(result.institutionName).toBe('Bank of America');
  });

  it('detects account type from filename', () => {
    const result = detectAccountInfoFromCSV([], 'Chase_Checking_2024.csv');
    expect(result.accountType).toBe('checking');
  });

  it('detects credit card type', () => {
    const rawLines = ['Credit Card Statement'];
    const result = detectAccountInfoFromCSV(rawLines, 'amex_cc.csv');
    expect(result.accountType).toBe('credit_card');
  });

  it('returns empty object when nothing detected', () => {
    const result = detectAccountInfoFromCSV([], 'data.csv');
    expect(result.accountMask).toBeUndefined();
    expect(result.institutionName).toBeUndefined();
    expect(result.accountType).toBeUndefined();
  });
});
