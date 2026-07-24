import { describe, it, expect } from 'vitest';
import {
  buildRelinkSessionParams,
  isRelinkOptionsRejected,
  resolveSessionMode,
  type BaseSessionParams,
} from '../../supabase/functions/_shared/bankRelinkSession';

// Design §4.5 / Plan Task 13 RED:
// 1. With `connectedBankId` in the body, the session is created with
//    `relink_options.authorization` and the response carries `mode: 'relink'`.
// 2. When Stripe rejects `relink_options` (private beta), fall back to a
//    normal session with `mode: 'link'` rather than erroring.
// 3. Without `connectedBankId`, behaviour is byte-identical to today (no
//    `relink_options` sent, `mode: 'link'`).
const baseParams: BaseSessionParams = {
  account_holder: { type: 'customer', customer: 'cus_123' },
  permissions: ['payment_method', 'balances', 'transactions'],
  filters: { countries: ['US'] },
  return_url: 'https://app.example.com/banking?restaurant_id=r1',
};

describe('buildRelinkSessionParams', () => {
  it('adds relink_options.authorization set to the bank identifier, on top of the base params', () => {
    const result = buildRelinkSessionParams(baseParams, 'fca_abc123');
    expect(result).toEqual({
      ...baseParams,
      relink_options: { authorization: 'fca_abc123' },
    });
  });

  it('does not mutate the base params object passed in', () => {
    const before = JSON.stringify(baseParams);
    buildRelinkSessionParams(baseParams, 'fca_abc123');
    expect(JSON.stringify(baseParams)).toBe(before);
  });
});

describe('isRelinkOptionsRejected', () => {
  it('is true when the Stripe error names relink_options as the offending param', () => {
    expect(
      isRelinkOptionsRejected({
        type: 'invalid_request_error',
        param: 'relink_options',
        message: 'Received unknown parameter: relink_options',
      }),
    ).toBe(true);
  });

  it('is true when the error message mentions relink_options even without a param field', () => {
    expect(
      isRelinkOptionsRejected({
        type: 'invalid_request_error',
        message: 'Unknown parameter: relink_options',
      }),
    ).toBe(true);
  });

  it('is false for an invalid_request_error about a different, unrelated param', () => {
    expect(
      isRelinkOptionsRejected({
        type: 'invalid_request_error',
        param: 'permissions',
        message: 'Invalid permissions',
      }),
    ).toBe(false);
  });

  it('is false for a non-relink authentication error, so it is never swallowed', () => {
    expect(
      isRelinkOptionsRejected({
        type: 'authentication_error',
        message: 'Invalid API key provided',
      }),
    ).toBe(false);
  });

  it('is false for a plain network/JS error with no Stripe shape', () => {
    expect(isRelinkOptionsRejected(new TypeError('fetch failed'))).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(isRelinkOptionsRejected(null)).toBe(false);
    expect(isRelinkOptionsRejected(undefined)).toBe(false);
  });
});

describe('resolveSessionMode', () => {
  it('is "relink" when a relink was attempted and succeeded', () => {
    expect(resolveSessionMode(true, true)).toBe('relink');
  });

  it('is "link" when a relink was attempted but Stripe rejected relink_options (fallback)', () => {
    expect(resolveSessionMode(true, false)).toBe('link');
  });

  it('is "link" when no connectedBankId was supplied at all — byte-identical to today', () => {
    expect(resolveSessionMode(false, false)).toBe('link');
  });
});
