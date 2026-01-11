import { describe, it, expect } from 'vitest';
import { queryClientConfig } from '@/lib/react-query-config';

describe('queryClientConfig', () => {
  // Cast the functions to the correct types for testing purposes
  // The types in TanStack Query can be complex, so we cast to the signature we expect
  const retryFn = queryClientConfig.defaultOptions?.queries?.retry as (failureCount: number, error: any) => boolean;
  const retryDelayFn = queryClientConfig.defaultOptions?.queries?.retryDelay as (attemptIndex: number, error: any) => number;

  describe('retry logic', () => {
    it('should be defined', () => {
      expect(retryFn).toBeDefined();
    });

    it('should not retry on 404 status', () => {
      expect(retryFn(0, { status: 404 })).toBe(false);
    });

    it('should not retry on 404 message', () => {
      expect(retryFn(0, { message: 'Not found 404' })).toBe(false);
    });

    it('should retry auth errors (401) up to 2 times', () => {
      const authError = { status: 401 };
      // Attempt 0 (1st failure) -> Retry
      expect(retryFn(0, authError)).toBe(true);
      // Attempt 1 (2nd failure) -> Retry
      expect(retryFn(1, authError)).toBe(true);
      // Attempt 2 (3rd failure) -> Stop
      expect(retryFn(2, authError)).toBe(false);
    });

    it('should retry auth errors (403) up to 2 times', () => {
      const authError = { status: 403 };
      expect(retryFn(1, authError)).toBe(true);
      expect(retryFn(2, authError)).toBe(false);
    });

    it('should retry JWT expired errors up to 2 times', () => {
      const jwtError = { message: 'JWT expired' };
      expect(retryFn(1, jwtError)).toBe(true);
      expect(retryFn(2, jwtError)).toBe(false);
    });

    it('should retry PGRST303 errors up to 2 times', () => {
      const pgrstError = { code: 'PGRST303' };
      expect(retryFn(1, pgrstError)).toBe(true);
      expect(retryFn(2, pgrstError)).toBe(false);
    });

    it('should retry other errors up to 3 times', () => {
      const otherError = { status: 500 };
      expect(retryFn(2, otherError)).toBe(true);
      expect(retryFn(3, otherError)).toBe(false);
    });
  });

  describe('retryDelay logic', () => {
    it('should be defined', () => {
      expect(retryDelayFn).toBeDefined();
    });

    it('should use 1000ms fixed delay for JWT expired messages', () => {
      expect(retryDelayFn(0, { message: 'JWT expired' })).toBe(1000);
      expect(retryDelayFn(5, { message: 'JWT expired' })).toBe(1000);
    });

    it('should use 1000ms fixed delay for PGRST303 errors', () => {
      expect(retryDelayFn(0, { code: 'PGRST303' })).toBe(1000);
    });

    it('should use exponential backoff for other errors', () => {
      // 1000 * 2^0 = 1000
      expect(retryDelayFn(0, { status: 500 })).toBe(1000);
      // 1000 * 2^1 = 2000
      expect(retryDelayFn(1, { status: 500 })).toBe(2000);
      // 1000 * 2^2 = 4000
      expect(retryDelayFn(2, { status: 500 })).toBe(4000);
    });

    it('should cap exponential backoff at 30000ms', () => {
      // 1000 * 2^10 = 1024000 -> capped at 30000
      expect(retryDelayFn(10, { status: 500 })).toBe(30000);
    });
  });
});
