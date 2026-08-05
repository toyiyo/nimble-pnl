import { describe, it, expect } from 'vitest';
import {
  signReviewToken,
  verifyReviewToken,
  REVIEW_TOKEN_TTL_SECONDS,
  type ReviewTokenPayload,
} from '../../supabase/functions/_shared/reviewToken';

const SECRET = 'test-review-token-secret';
const NOW = 1_770_000_000;

function payload(overrides: Partial<ReviewTokenPayload> = {}): ReviewTokenPayload {
  return {
    rid: '33333333-0000-0000-0000-000000000001',
    exp: NOW + REVIEW_TOKEN_TTL_SECONDS,
    ...overrides,
  };
}

describe('reviewToken', () => {
  it('round-trips a payload', async () => {
    const token = await signReviewToken(payload(), SECRET);
    expect(await verifyReviewToken(token, SECRET, NOW)).toEqual(payload());
  });

  it('has a 30-minute time-to-live', () => {
    expect(REVIEW_TOKEN_TTL_SECONDS).toBe(1800);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signReviewToken(payload(), SECRET);
    expect(await verifyReviewToken(token, 'other-secret', NOW)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signReviewToken(payload(), SECRET);
    const [, sig] = token.split('.');
    const forged = btoa(JSON.stringify(payload({ rid: 'attacker-row' })))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyReviewToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signReviewToken(payload({ exp: NOW - 1 }), SECRET);
    expect(await verifyReviewToken(token, SECRET, NOW)).toBeNull();
  });

  it('accepts a token in its final second', async () => {
    const token = await signReviewToken(payload({ exp: NOW }), SECRET);
    expect(await verifyReviewToken(token, SECRET, NOW)).not.toBeNull();
  });

  it('rejects malformed input', async () => {
    expect(await verifyReviewToken('', SECRET, NOW)).toBeNull();
    expect(await verifyReviewToken('no-dot', SECRET, NOW)).toBeNull();
    expect(await verifyReviewToken('a.b.c', SECRET, NOW)).toBeNull();
    expect(await verifyReviewToken('!!!.!!!', SECRET, NOW)).toBeNull();
  });

  it('rejects a payload missing exp', async () => {
    const bare = btoa(JSON.stringify({ rid: 'x' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyReviewToken(`${bare}.${bare}`, SECRET, NOW)).toBeNull();
  });
});
