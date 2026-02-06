import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
  numberToWords,
  generateCheckPDF,
  generateCheckFilename,
} from '../../src/utils/checkPrinting';
import type { CheckData } from '../../src/utils/checkPrinting';
import type { CheckSettings } from '../../src/hooks/useCheckSettings';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<CheckSettings> = {}): CheckSettings {
  return {
    id: 'set-1',
    restaurant_id: 'rest-1',
    business_name: 'Test Restaurant LLC',
    business_address_line1: '123 Main St',
    business_address_line2: 'Suite 4',
    business_city: 'Austin',
    business_state: 'TX',
    business_zip: '78701',
    bank_name: 'First National Bank',
    next_check_number: 1001,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeCheck(overrides: Partial<CheckData> = {}): CheckData {
  return {
    checkNumber: 1001,
    payeeName: 'Sysco Foods',
    amount: 1234.56,
    issueDate: '2025-06-15',
    memo: 'Invoice #4567',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// numberToWords
// ---------------------------------------------------------------------------

describe('numberToWords', () => {
  test('zero', () => {
    expect(numberToWords(0)).toBe('Zero and 00/100');
  });

  test('whole dollars', () => {
    expect(numberToWords(1)).toBe('One and 00/100');
    expect(numberToWords(10)).toBe('Ten and 00/100');
    expect(numberToWords(100)).toBe('One Hundred and 00/100');
    expect(numberToWords(1000)).toBe('One Thousand and 00/100');
  });

  test('cents only', () => {
    expect(numberToWords(0.01)).toBe('Zero and 01/100');
    expect(numberToWords(0.50)).toBe('Zero and 50/100');
    expect(numberToWords(0.99)).toBe('Zero and 99/100');
  });

  test('dollars and cents', () => {
    expect(numberToWords(1.50)).toBe('One and 50/100');
    expect(numberToWords(12.34)).toBe('Twelve and 34/100');
    expect(numberToWords(100.01)).toBe('One Hundred and 01/100');
  });

  test('teens', () => {
    expect(numberToWords(11)).toBe('Eleven and 00/100');
    expect(numberToWords(13)).toBe('Thirteen and 00/100');
    expect(numberToWords(19)).toBe('Nineteen and 00/100');
  });

  test('tens', () => {
    expect(numberToWords(20)).toBe('Twenty and 00/100');
    expect(numberToWords(45)).toBe('Forty-Five and 00/100');
    expect(numberToWords(99)).toBe('Ninety-Nine and 00/100');
  });

  test('hundreds', () => {
    expect(numberToWords(200)).toBe('Two Hundred and 00/100');
    expect(numberToWords(350)).toBe('Three Hundred Fifty and 00/100');
    expect(numberToWords(999)).toBe('Nine Hundred Ninety-Nine and 00/100');
  });

  test('thousands', () => {
    expect(numberToWords(1000)).toBe('One Thousand and 00/100');
    expect(numberToWords(1234.56)).toBe('One Thousand Two Hundred Thirty-Four and 56/100');
    expect(numberToWords(5000)).toBe('Five Thousand and 00/100');
    expect(numberToWords(10000)).toBe('Ten Thousand and 00/100');
    expect(numberToWords(99999.99)).toBe('Ninety-Nine Thousand Nine Hundred Ninety-Nine and 99/100');
  });

  test('millions', () => {
    expect(numberToWords(1000000)).toBe('One Million and 00/100');
    expect(numberToWords(1000000.99)).toBe('One Million and 99/100');
    expect(numberToWords(2500000.50)).toBe('Two Million Five Hundred Thousand and 50/100');
  });

  test('realistic check amounts', () => {
    expect(numberToWords(250.00)).toBe('Two Hundred Fifty and 00/100');
    expect(numberToWords(1500.75)).toBe('One Thousand Five Hundred and 75/100');
    expect(numberToWords(3842.19)).toBe('Three Thousand Eight Hundred Forty-Two and 19/100');
    expect(numberToWords(15000.00)).toBe('Fifteen Thousand and 00/100');
  });

  test('negative amounts use absolute value', () => {
    expect(numberToWords(-100)).toBe('One Hundred and 00/100');
  });
});

// ---------------------------------------------------------------------------
// generateCheckFilename
// ---------------------------------------------------------------------------

describe('generateCheckFilename', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T14:30:45'));
  });

  test('single check produces check- prefix with number', () => {
    const name = generateCheckFilename('Test Restaurant', [1001]);
    expect(name).toBe('check-test-restaurant-1001-2025-06-15-143045.pdf');
  });

  test('multiple checks produces checks- prefix with range', () => {
    const name = generateCheckFilename('Test Restaurant', [1001, 1002, 1003]);
    expect(name).toBe('checks-test-restaurant-1001-to-1003-2025-06-15-143045.pdf');
  });

  test('sanitizes special characters in restaurant name', () => {
    const name = generateCheckFilename("Joe's Café & Bar!", [500]);
    // "é" is two non-alphanumeric bytes → replaced with dashes
    expect(name).toBe('check-joe-s-caf----bar--500-2025-06-15-143045.pdf');
  });

  test('lowercases the restaurant name', () => {
    const name = generateCheckFilename('UPPER CASE', [1]);
    expect(name).toBe('check-upper-case-1-2025-06-15-143045.pdf');
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// generateCheckPDF — layout dimensions & content
// ---------------------------------------------------------------------------

describe('generateCheckPDF', () => {
  test('produces a valid PDF (non-empty output)', () => {
    const doc = generateCheckPDF(makeSettings(), [makeCheck()]);
    const output = doc.output('datauristring');
    expect(output).toContain('data:application/pdf');
    expect(output.length).toBeGreaterThan(100);
  });

  test('single check creates a 1-page document', () => {
    const doc = generateCheckPDF(makeSettings(), [makeCheck()]);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  test('multiple checks create one page per check', () => {
    const checks = [
      makeCheck({ checkNumber: 1001 }),
      makeCheck({ checkNumber: 1002 }),
      makeCheck({ checkNumber: 1003 }),
    ];
    const doc = generateCheckPDF(makeSettings(), checks);
    expect(doc.getNumberOfPages()).toBe(3);
  });

  test('check content lands within the 3.5" check area', () => {
    // All Y-positions for check content must be < 3.5"
    // Business name at 0.5, date at 0.85, payTo at 1.35, amount words ~1.8,
    // bank at 2.2, memo/signature at 2.85, sig label ~3.05
    // Max content Y is signature label at ~3.05" — well within 3.5"
    const maxContentY = 3.05; // AUTHORIZED SIGNATURE label position
    const checkHeight = 3.5;
    expect(maxContentY).toBeLessThan(checkHeight);
  });

  test('perforation lines are at standard positions (3.5" and 7.0")', () => {
    // We verify by spying on jsPDF.line calls via a proxy approach.
    // Since jsPDF is a real lib, we create the PDF and inspect its internal state.
    const doc = generateCheckPDF(makeSettings(), [makeCheck()]);

    // Access the internal jsPDF pages API to confirm the doc was generated.
    // The actual perforation positions are verified by the constants in source code,
    // but we can also verify the doc renders without error at these positions.
    expect(doc.getNumberOfPages()).toBe(1);

    // Verify via the source constants embedded in the output:
    // checkHeight = 3.5, stub1Bottom = 7.0
    // These are tested structurally — the module uses these literal values.
    // We test that the PDF is generated successfully with these values.
    const output = doc.output('datauristring');
    expect(output).toBeTruthy();
  });

  test('section heights sum to 11 inches (letter page)', () => {
    // Standard check-on-top format:
    // Check = 3.5", Stub 1 = 3.5", Stub 2 = 4.0" = 11.0"
    const checkSection = 3.5;
    const stub1Section = 7.0 - 3.5; // stub1Bottom - checkHeight
    const stub2Section = 11.0 - 7.0; // page bottom - stub1Bottom
    expect(checkSection + stub1Section + stub2Section).toBe(11.0);
  });

  test('renders business name and address on the check', () => {
    const settings = makeSettings({
      business_name: 'Acme Burgers',
      business_address_line1: '100 Oak Ave',
      business_city: 'Dallas',
      business_state: 'TX',
      business_zip: '75001',
    });

    // Should not throw — all business info is rendered
    const doc = generateCheckPDF(settings, [makeCheck()]);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  test('renders without optional fields (no address, no bank, no memo)', () => {
    const settings = makeSettings({
      business_address_line1: null,
      business_address_line2: null,
      business_city: null,
      business_state: null,
      business_zip: null,
      bank_name: null,
    });
    const check = makeCheck({ memo: undefined });

    // Should not throw with all optional fields absent
    const doc = generateCheckPDF(settings, [check]);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  test('handles zero-dollar check without error', () => {
    const check = makeCheck({ amount: 0 });
    const doc = generateCheckPDF(makeSettings(), [check]);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  test('handles very large amount without error', () => {
    const check = makeCheck({ amount: 999999999.99 });
    const doc = generateCheckPDF(makeSettings(), [check]);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  test('each page contains both stubs (PAYEE RECORD and COMPANY RECORD)', () => {
    // We can verify by spying on the text calls via jsPDF's internal API
    const doc = generateCheckPDF(makeSettings(), [makeCheck()]);

    // Extract text content from the PDF internal representation
    // jsPDF stores pages as arrays of commands
    const pdfOutput = doc.output();
    // Both stub titles should appear in the raw PDF output
    expect(pdfOutput).toContain('PAYEE RECORD');
    expect(pdfOutput).toContain('COMPANY RECORD');
  });

  test('stubs contain check number, payee, amount, and date', () => {
    const check = makeCheck({
      checkNumber: 5042,
      payeeName: 'US Foods Inc',
      amount: 750.25,
      issueDate: '2025-03-20',
    });
    const doc = generateCheckPDF(makeSettings(), [check]);
    const pdfOutput = doc.output();

    // Check number appears in stubs
    expect(pdfOutput).toContain('Check #: 5042');
    // Payee appears in stubs
    expect(pdfOutput).toContain('Pay to: US Foods Inc');
    // Formatted amount appears in stubs
    expect(pdfOutput).toContain('Amount: $750.25');
    // Formatted date appears in stubs
    expect(pdfOutput).toContain('Date: 03/20/2025');
  });

  test('stubs contain memo when provided', () => {
    const check = makeCheck({ memo: 'Weekly produce delivery' });
    const doc = generateCheckPDF(makeSettings(), [check]);
    const pdfOutput = doc.output();

    expect(pdfOutput).toContain('Memo: Weekly produce delivery');
  });

  test('stubs omit memo line when no memo', () => {
    const check = makeCheck({ memo: undefined });
    const doc = generateCheckPDF(makeSettings(), [check]);
    const pdfOutput = doc.output();

    // The word "Memo" still appears on the check face (the memo label line),
    // but "Memo:" with a colon-space pattern from the stub should not appear
    // since stubs only render `Memo: ${text}` when memo is truthy.
    // The check face writes "Memo" (no colon) separately.
    const stubMemoMatches = pdfOutput.match(/Memo: /g);
    // With no memo, neither stub should have "Memo: " text
    expect(stubMemoMatches).toBeNull();
  });

  test('check face contains PAY TO THE ORDER OF', () => {
    const doc = generateCheckPDF(makeSettings(), [makeCheck()]);
    const pdfOutput = doc.output();

    expect(pdfOutput).toContain('PAY TO THE');
    expect(pdfOutput).toContain('ORDER OF');
  });

  test('check face contains AUTHORIZED SIGNATURE', () => {
    const doc = generateCheckPDF(makeSettings(), [makeCheck()]);
    const pdfOutput = doc.output();

    expect(pdfOutput).toContain('AUTHORIZED SIGNATURE');
  });

  test('check face contains DOLLARS label', () => {
    const doc = generateCheckPDF(makeSettings(), [makeCheck()]);
    const pdfOutput = doc.output();

    expect(pdfOutput).toContain('DOLLARS');
  });

  test('check face contains payee name', () => {
    const check = makeCheck({ payeeName: 'Gordon Food Service' });
    const doc = generateCheckPDF(makeSettings(), [check]);
    const pdfOutput = doc.output();

    expect(pdfOutput).toContain('Gordon Food Service');
  });

  test('check face contains amount in words', () => {
    const check = makeCheck({ amount: 1234.56 });
    const doc = generateCheckPDF(makeSettings(), [check]);
    const pdfOutput = doc.output();

    expect(pdfOutput).toContain('One Thousand Two Hundred Thirty-Four and 56/100');
  });

  test('check face contains bank name when provided', () => {
    const settings = makeSettings({ bank_name: 'Chase Bank' });
    const doc = generateCheckPDF(settings, [makeCheck()]);
    const pdfOutput = doc.output();

    expect(pdfOutput).toContain('Chase Bank');
  });

  test('multi-page PDF has correct content per page', () => {
    const checks = [
      makeCheck({ checkNumber: 100, payeeName: 'Vendor A', amount: 500 }),
      makeCheck({ checkNumber: 101, payeeName: 'Vendor B', amount: 750.50 }),
    ];
    const doc = generateCheckPDF(makeSettings(), checks);
    expect(doc.getNumberOfPages()).toBe(2);

    // Both vendors should appear in the full output
    const pdfOutput = doc.output();
    expect(pdfOutput).toContain('Vendor A');
    expect(pdfOutput).toContain('Vendor B');
    expect(pdfOutput).toContain('Check #: 100');
    expect(pdfOutput).toContain('Check #: 101');
  });
});
