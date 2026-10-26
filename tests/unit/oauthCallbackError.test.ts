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
  it('asks the user to sign in on 401', () => {
    expect(describeOAuthCallbackError(httpError(401), 'Square')).toBe(
      'Sign in, then connect Square again.'
    );
  });

  it('asks the user to start again on 403', () => {
    expect(describeOAuthCallbackError(httpError(403), 'Clover')).toBe(
      'This connection link expired or belongs to a different account. Start the Clover connection again.'
    );
  });

  it('gives a generic message for other statuses', () => {
    expect(describeOAuthCallbackError(httpError(400), 'Toast')).toBe(
      'Failed to complete the Toast connection.'
    );
  });

  it('gives a generic message for a plain error', () => {
    expect(describeOAuthCallbackError(new Error('network'), 'Square')).toBe(
      'Failed to complete the Square connection.'
    );
  });

  it.each([null, undefined, 'text', { context: null }])('gives a generic message for %s', (value) => {
    expect(describeOAuthCallbackError(value, 'Square')).toBe('Failed to complete the Square connection.');
  });
});
