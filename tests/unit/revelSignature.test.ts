import { describe, it, expect } from 'vitest';
import { computeRevelSignature, verifyRevelSignature } from '../../supabase/functions/_shared/revelSignature';

const SECRET = 'test-webhook-secret';
const BODY = '{"eventType":"order.finalized","order":{"id":"order-1"}}';

describe('revel signature', () => {
  it('computes a stable base64 HMAC-SHA1 for a known body', async () => {
    const sig = await computeRevelSignature(BODY, SECRET);
    expect(await computeRevelSignature(BODY, SECRET)).toBe(sig);
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('verifies a valid signature', async () => {
    const sig = await computeRevelSignature(BODY, SECRET);
    expect(await verifyRevelSignature(BODY, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const sig = await computeRevelSignature(BODY, SECRET);
    expect(await verifyRevelSignature(BODY + ' ', sig, SECRET)).toBe(false);
  });

  it('rejects a wrong secret', async () => {
    const sig = await computeRevelSignature(BODY, SECRET);
    expect(await verifyRevelSignature(BODY, sig, 'other-secret')).toBe(false);
  });

  it('rejects a null/empty signature safely', async () => {
    expect(await verifyRevelSignature(BODY, null, SECRET)).toBe(false);
    expect(await verifyRevelSignature(BODY, '', SECRET)).toBe(false);
  });
});
