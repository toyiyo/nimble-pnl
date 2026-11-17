import { describe, it, expect } from 'vitest';
import { parseSearchAmount, buildBankSearchFilter } from '@/lib/bankTransactionSearch';

describe('parseSearchAmount', () => {
  const accepted: Array<[string, string]> = [
    ['$1,260.05', '1260.05'],
    ['1260.05', '1260.05'],
    ['-$1,260.05', '1260.05'],
    ['$-50', '50'],
    ['.5', '0.5'],
    ['-.5', '0.5'],
    ['1,260', '1260'],
    ['1,260.5', '1260.5'],
    ['007', '007'],
    ['0.00', '0.00'],
  ];
  it.each(accepted)('accepts %s', (input, output) => {
    expect(parseSearchAmount(input)).toBe(output);
  });

  const rejected = [
    '1,26', '1,2603', '12,34,567', '1260.', '1260.055', '1.260,05', '+5', '--5',
    '5-', '-', '.', '$.', '($50.00)', '$ 50', '1e5', 'NaN', 'USD 50', 'coffee',
    '$', '１２', '',
  ];
  it.each(rejected)('rejects %s', (input) => {
    expect(parseSearchAmount(input)).toBeNull();
  });
});

describe('buildBankSearchFilter', () => {
  it('quotes the three text conditions and keeps commas', () => {
    expect(buildBankSearchFilter('a,b')).toBe(
      'description.ilike."%a,b%",merchant_name.ilike."%a,b%",normalized_payee.ilike."%a,b%"'
    );
  });

  it('escapes double quotes and backslashes', () => {
    expect(buildBankSearchFilter('a"b\\c')).toContain('description.ilike."%a\\"b\\\\c%"');
  });

  it('adds both signs for an amount', () => {
    const filter = buildBankSearchFilter('$1,260.05');
    expect(filter).toContain('description.ilike."%$1,260.05%"');
    expect(filter.endsWith(',amount.eq.1260.05,amount.eq.-1260.05')).toBe(true);
  });

  it('adds one condition for a zero amount', () => {
    const filter = buildBankSearchFilter('0.00');
    expect(filter.endsWith(',amount.eq.0.00')).toBe(true);
    expect(filter).not.toContain('amount.eq.-');
  });

  it('adds no amount condition for plain text', () => {
    expect(buildBankSearchFilter('coffee')).not.toContain('amount.eq');
  });
});
