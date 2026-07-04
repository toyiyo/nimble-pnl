/**
 * RED test (task 6a): assert stripe-sync-transactions calls the internal engine.
 *
 * The public `apply_rules_to_bank_transactions` raises "Permission denied" when
 * called from a service-role context (auth.uid() IS NULL). The edge function MUST
 * call `apply_rules_to_bank_transactions_internal` instead.
 *
 * This is a static-source audit — no mocking required. It FAILS until task 6b
 * renames the RPC call in the edge function source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const EDGE_FN_PATH = resolve(
  __dirname,
  '../../supabase/functions/stripe-sync-transactions/index.ts',
);

describe('stripe-sync-transactions RPC safety', () => {
  it('calls apply_rules_to_bank_transactions_internal (not the auth-gated public wrapper)', () => {
    const source = readFileSync(EDGE_FN_PATH, 'utf-8');

    // The internal engine must be called
    expect(source).toContain("'apply_rules_to_bank_transactions_internal'");

    // The auth-gated public wrapper must NOT be called (it raises for service-role callers)
    expect(source).not.toContain("'apply_rules_to_bank_transactions'");
  });
});
