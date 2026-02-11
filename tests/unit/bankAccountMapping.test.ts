import { describe, it, expect } from 'vitest';
import {
  extractUniqueAccounts,
  matchAccountToBank,
  detectTransferPairs,
} from '@/utils/bankTransactionColumnMapping';

describe('extractUniqueAccounts', () => {
  it('groups rows by source account and extracts Mercury account info', () => {
    const rows = [
      { Account: 'Mercury Checking xx7138', Date: '2024-01-01', Amount: '-100' },
      { Account: 'Mercury Checking xx7138', Date: '2024-01-02', Amount: '-200' },
      { Account: 'Mercury Credit', Date: '2024-01-01', Amount: '50' },
      { Account: 'ColdStone Franchise fees (Mercury Checking xx0381)', Date: '2024-01-03', Amount: '-500' },
    ];

    const accounts = extractUniqueAccounts(rows, 'Account');

    expect(accounts).toHaveLength(3);

    // Mercury Checking xx7138
    const checking = accounts.find((a) => a.rawValue === 'Mercury Checking xx7138');
    expect(checking).toBeDefined();
    expect(checking!.rowCount).toBe(2);
    expect(checking!.rowIndices).toEqual([0, 1]);
    expect(checking!.institutionName).toBe('Mercury');
    expect(checking!.accountType).toBe('checking');
    expect(checking!.accountMask).toBe('7138');

    // Mercury Credit
    const credit = accounts.find((a) => a.rawValue === 'Mercury Credit');
    expect(credit).toBeDefined();
    expect(credit!.rowCount).toBe(1);
    expect(credit!.institutionName).toBe('Mercury');
    expect(credit!.accountType).toBe('credit_card');

    // ColdStone account
    const franchise = accounts.find((a) =>
      a.rawValue.includes('ColdStone')
    );
    expect(franchise).toBeDefined();
    expect(franchise!.accountMask).toBe('0381');
    expect(franchise!.institutionName).toBe('Mercury');
    expect(franchise!.accountType).toBe('checking');
  });

  it('skips rows with empty source account values', () => {
    const rows = [
      { Account: 'Mercury Checking', Date: '2024-01-01', Amount: '-100' },
      { Account: '', Date: '2024-01-02', Amount: '-200' },
      { Account: '  ', Date: '2024-01-03', Amount: '-300' },
    ];

    const accounts = extractUniqueAccounts(rows, 'Account');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].rawValue).toBe('Mercury Checking');
  });

  it('returns empty array when column does not exist', () => {
    const rows = [{ Date: '2024-01-01', Amount: '-100' }];
    const accounts = extractUniqueAccounts(rows, 'NonExistentCol');
    expect(accounts).toHaveLength(0);
  });
});

describe('matchAccountToBank', () => {
  const banks = [
    {
      id: 'bank-1',
      institution_name: 'Mercury Checking ****7138',
      bank_account_balances: [{ account_mask: '7138', account_type: 'checking' }],
    },
    {
      id: 'bank-2',
      institution_name: 'Chase Business Checking',
      bank_account_balances: [{ account_mask: '4521', account_type: 'checking' }],
    },
  ];

  it('returns high confidence match when institution + mask match', () => {
    const accountInfo = {
      rawValue: 'Mercury Checking xx7138',
      accountMask: '7138',
      institutionName: 'Mercury',
      accountType: 'checking',
      rowCount: 5,
      rowIndices: [0, 1, 2, 3, 4],
    };

    const result = matchAccountToBank(accountInfo, banks);
    expect(result.confidence).toBe('high');
    expect(result.matchedBank?.id).toBe('bank-1');
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it('returns medium confidence when only institution matches', () => {
    const accountInfo = {
      rawValue: 'Mercury Credit',
      accountMask: undefined,
      institutionName: 'Mercury',
      accountType: 'credit_card',
      rowCount: 2,
      rowIndices: [0, 1],
    };

    const result = matchAccountToBank(accountInfo, banks);
    expect(result.confidence).toBe('medium');
    expect(result.matchedBank?.id).toBe('bank-1');
  });

  it('returns none confidence when nothing matches', () => {
    const accountInfo = {
      rawValue: 'Wells Fargo Savings',
      accountMask: '9999',
      institutionName: 'Wells Fargo',
      accountType: 'savings',
      rowCount: 1,
      rowIndices: [0],
    };

    const result = matchAccountToBank(accountInfo, banks);
    expect(result.confidence).toBe('none');
    expect(result.matchedBank).toBeUndefined();
  });
});

describe('detectTransferPairs', () => {
  it('finds opposite-amount pairs across different accounts on same date', () => {
    const rows = [
      { Account: 'Checking', Date: '2024-01-15', Amount: '-1000.00' },
      { Account: 'Savings', Date: '2024-01-15', Amount: '1000.00' },
      { Account: 'Checking', Date: '2024-01-16', Amount: '-50.00' },
    ];

    const pairs = detectTransferPairs(rows, 'Account', 'Date', 'Amount');

    expect(pairs).toHaveLength(1);
    expect(pairs[0].amount).toBe(1000);
    expect(pairs[0].date).toBe('2024-01-15');
    expect(pairs[0].debitAccount).toBe('Checking');
    expect(pairs[0].creditAccount).toBe('Savings');
  });

  it('does not pair transactions in the same account', () => {
    const rows = [
      { Account: 'Checking', Date: '2024-01-15', Amount: '-500' },
      { Account: 'Checking', Date: '2024-01-15', Amount: '500' },
    ];

    const pairs = detectTransferPairs(rows, 'Account', 'Date', 'Amount');
    expect(pairs).toHaveLength(0);
  });

  it('does not pair transactions on different dates', () => {
    const rows = [
      { Account: 'Checking', Date: '2024-01-15', Amount: '-500' },
      { Account: 'Savings', Date: '2024-01-16', Amount: '500' },
    ];

    const pairs = detectTransferPairs(rows, 'Account', 'Date', 'Amount');
    expect(pairs).toHaveLength(0);
  });

  it('works with split debit/credit columns', () => {
    const rows = [
      { Account: 'Checking', Date: '2024-01-15', Debit: '2000', Credit: '' },
      { Account: 'Savings', Date: '2024-01-15', Debit: '', Credit: '2000' },
    ];

    const pairs = detectTransferPairs(
      rows,
      'Account',
      'Date',
      undefined,
      'Debit',
      'Credit'
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0].amount).toBe(2000);
  });

  it('returns empty array when no transfers exist', () => {
    const rows = [
      { Account: 'Checking', Date: '2024-01-15', Amount: '-100' },
      { Account: 'Savings', Date: '2024-01-15', Amount: '200' },
    ];

    const pairs = detectTransferPairs(rows, 'Account', 'Date', 'Amount');
    expect(pairs).toHaveLength(0);
  });
});
