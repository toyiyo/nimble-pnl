import { describe, it, expect } from 'vitest';
import {
  signUnsubscribe,
  verifyUnsubscribe,
  type UnsubPayload,
} from '../../supabase/functions/_shared/unsubscribeToken';

const SECRET = 'test-secret-do-not-use-in-prod';
const OTHER_SECRET = 'other-secret';

const PAYLOAD: UnsubPayload = {
  user_id: '11111111-1111-1111-1111-111111111111',
  list: 'trial_lifecycle',
};

describe('unsubscribeToken', () => {
  it('produces a token shaped like <payload>.<signature>', async () => {
    const token = await signUnsubscribe(PAYLOAD, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('round-trips a valid signed payload', async () => {
    const token = await signUnsubscribe(PAYLOAD, SECRET);
    const verified = await verifyUnsubscribe(token, SECRET);
    expect(verified).toEqual(PAYLOAD);
  });

  it('returns null when the signature was made with a different secret', async () => {
    const token = await signUnsubscribe(PAYLOAD, SECRET);
    const verified = await verifyUnsubscribe(token, OTHER_SECRET);
    expect(verified).toBeNull();
  });

  it('returns null when the payload portion has been tampered with', async () => {
    const token = await signUnsubscribe(PAYLOAD, SECRET);
    const [, sig] = token.split('.');
    const tamperedPayload = btoa(
      JSON.stringify({ ...PAYLOAD, list: 'all' })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tampered = `${tamperedPayload}.${sig}`;
    const verified = await verifyUnsubscribe(tampered, SECRET);
    expect(verified).toBeNull();
  });

  it('returns null when the signature portion has been tampered with', async () => {
    const token = await signUnsubscribe(PAYLOAD, SECRET);
    const [payload, sig] = token.split('.');
    const flippedSig = sig.startsWith('A') ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    const tampered = `${payload}.${flippedSig}`;
    const verified = await verifyUnsubscribe(tampered, SECRET);
    expect(verified).toBeNull();
  });

  it('returns null for malformed tokens', async () => {
    expect(await verifyUnsubscribe('', SECRET)).toBeNull();
    expect(await verifyUnsubscribe('no-dot-here', SECRET)).toBeNull();
    expect(await verifyUnsubscribe('a.b.c', SECRET)).toBeNull();
    expect(await verifyUnsubscribe('!!!.&&&', SECRET)).toBeNull();
  });

  it('returns null when the payload is not valid JSON', async () => {
    const fakePayload = btoa('not json at all')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const token = await signUnsubscribe(PAYLOAD, SECRET);
    const [, sig] = token.split('.');
    const malformed = `${fakePayload}.${sig}`;
    const verified = await verifyUnsubscribe(malformed, SECRET);
    expect(verified).toBeNull();
  });

  it('returns null when payload JSON is missing required fields', async () => {
    const incomplete = btoa(JSON.stringify({ user_id: 'abc' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const token = await signUnsubscribe(PAYLOAD, SECRET);
    const [, sig] = token.split('.');
    const malformed = `${incomplete}.${sig}`;
    expect(await verifyUnsubscribe(malformed, SECRET)).toBeNull();
  });

  it('rejects unknown list values', async () => {
    const bad = btoa(
      JSON.stringify({ user_id: PAYLOAD.user_id, list: 'newsletter' })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const token = await signUnsubscribe(PAYLOAD, SECRET);
    const [, sig] = token.split('.');
    expect(await verifyUnsubscribe(`${bad}.${sig}`, SECRET)).toBeNull();
  });

  it('produces deterministic signatures for the same payload + secret', async () => {
    const a = await signUnsubscribe(PAYLOAD, SECRET);
    const b = await signUnsubscribe(PAYLOAD, SECRET);
    expect(a).toBe(b);
  });

  it('produces different tokens for different lists', async () => {
    const a = await signUnsubscribe({ ...PAYLOAD, list: 'trial_lifecycle' }, SECRET);
    const b = await signUnsubscribe({ ...PAYLOAD, list: 'marketing' }, SECRET);
    const c = await signUnsubscribe({ ...PAYLOAD, list: 'all' }, SECRET);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
