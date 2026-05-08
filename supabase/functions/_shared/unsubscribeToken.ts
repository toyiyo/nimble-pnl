// HMAC-SHA256 signed tokens for one-click email unsubscribe links.
//
// Token format: `<payload>.<signature>` where both halves are base64url
// (no padding). The payload is JSON; the signature is HMAC-SHA256 over the
// raw payload bytes. We only need a stateless way to prove the link came
// from us — no expiry, since unsubscribe is always allowed and the link is
// already user-specific.
//
// Uses Web Crypto so it runs unchanged in Deno (edge-function runtime) and
// in Vitest (jsdom + Node 19+ globalThis.crypto).

export type UnsubList = 'trial_lifecycle' | 'marketing' | 'all';

export interface UnsubPayload {
  user_id: string;
  list: UnsubList;
}

const VALID_LISTS: ReadonlySet<UnsubList> = new Set([
  'trial_lifecycle',
  'marketing',
  'all',
]);

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(padLen));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function isValidPayload(p: unknown): p is UnsubPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.user_id === 'string' &&
    o.user_id.length > 0 &&
    typeof o.list === 'string' &&
    VALID_LISTS.has(o.list as UnsubList)
  );
}

export async function signUnsubscribe(
  payload: UnsubPayload,
  secret: string
): Promise<string> {
  const key = await importHmacKey(secret);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sigBuf = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

export async function verifyUnsubscribe(
  token: string,
  secret: string
): Promise<UnsubPayload | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts;
  if (!payloadPart || !sigPart) return null;

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(payloadPart);
    sigBytes = fromBase64Url(sigPart);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isValidPayload(parsed)) return null;

  const key = await importHmacKey(secret);
  const expectedBuf = await crypto.subtle.sign('HMAC', key, payloadBytes);
  const expected = new Uint8Array(expectedBuf);
  if (!constantTimeEqual(expected, sigBytes)) return null;

  return { user_id: parsed.user_id, list: parsed.list };
}
