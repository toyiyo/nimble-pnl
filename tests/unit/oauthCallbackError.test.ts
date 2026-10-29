import { describe, it, expect } from 'vitest';
import { describeOAuthCallbackError } from '@/lib/oauthCallbackError';

// supabase-js FunctionsHttpError keeps the fetch Response in `context`.
function httpError(status: number) {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & {
    context: { status: number };
  };
  error.context = { status };
  return error;
}

describe('describeOAuthCallbackError', () => {
  it('should ask the user to sign in when the status is 401', () => {
    expect(describeOAuthCallbackError(httpError(401), 'Square')).toBe(
      'Sign in, then connect Square again.'
    );
  });

  it('should ask the user to start again when the status is 403', () => {
    expect(describeOAuthCallbackError(httpError(403), 'Clover')).toBe(
      'This connection link expired or belongs to a different account. Start the Clover connection again.'
    );
  });

  it('should give the generic message when the status is another error', () => {
    expect(describeOAuthCallbackError(httpError(400), 'Toast')).toBe(
      'Failed to complete the Toast connection.'
    );
  });

  it('should give the generic message when the error has no HTTP context', () => {
    expect(describeOAuthCallbackError(new Error('network'), 'Square')).toBe(
      'Failed to complete the Square connection.'
    );
  });

  it.each([null, undefined, '', 'text', 0, -1, { context: null }])(
    'should give the generic message when the error is %s',
    (value) => {
      expect(describeOAuthCallbackError(value, 'Square')).toBe('Failed to complete the Square connection.');
    }
  );

  it.each([0, -1, 401.5, Number.NaN])('should give the generic message when the status is %s', (status) => {
    expect(describeOAuthCallbackError(httpError(status), 'Square')).toBe('Failed to complete the Square connection.');
  });
});
