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

describe('stripe-sync-transactions auto-link call', () => {
  const source = readFileSync(EDGE_FN_PATH, 'utf-8');

  it('calls auto_link_pending_outflows_internal with the sync-time arguments', () => {
    expect(source).toContain("'auto_link_pending_outflows_internal'");

    // The call must skip the per-call balance rebuild and keep the batch
    // small — the edge function runs inside a ~10s CPU budget. The
    // 5-minute sweep links any remainder.
    const callBlock = source.slice(source.indexOf("'auto_link_pending_outflows_internal'"));
    const argsBlock = callBlock.slice(0, callBlock.indexOf('}') + 1);
    expect(argsBlock).toContain('p_restaurant_id');
    expect(argsBlock).toContain('p_batch_limit: 25');
    expect(argsBlock).toContain('p_skip_rebuild: true');
  });

  it('logs an auto-link failure instead of a sync failure', () => {
    // The call sits inside try/catch, and both failure paths log with the
    // sync-transactions prefix. No `throw` may appear between the RPC call
    // and the end of its catch block.
    const tryStart = source.lastIndexOf('try {', source.indexOf("'auto_link_pending_outflows_internal'"));
    const catchEnd = source.indexOf('}', source.indexOf('catch (error)', tryStart) + 1);
    const block = source.slice(tryStart, catchEnd);
    expect(tryStart).toBeGreaterThan(-1);
    expect(block).toContain('catch (error)');
    expect(block).toContain('Error auto-linking pending outflows');
    expect(block).not.toContain('throw');
  });
});
