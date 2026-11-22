import { describe, it, expect } from 'vitest';
import {
  HttpError,
  toErrorResponse,
  isUniqueViolation,
} from '../../supabase/functions/_shared/httpError';

describe('toErrorResponse', () => {
  it('maps HttpError to its status and public message', () => {
    expect(toErrorResponse(new HttpError(403, 'Forbidden'))).toEqual({
      status: 403,
      body: { error: 'Forbidden' },
    });
  });

  it('maps an unknown Error to 500 with a generic message', () => {
    const result = toErrorResponse(new Error('secret db detail'));
    expect(result).toEqual({ status: 500, body: { error: 'Request failed' } });
  });

  it('maps a non-Error value to 500 with a generic message', () => {
    expect(toErrorResponse('boom')).toEqual({
      status: 500,
      body: { error: 'Request failed' },
    });
  });
});

describe('isUniqueViolation', () => {
  it('returns true for code 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });
  it('returns false for other codes and null', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
