// HMAC-SHA256 signed tokens proving a guest owns the review_responses row they
// are about to comment on.
//
// Same mechanism as unsubscribeToken.ts — `<payload>.<signature>`, both halves
// base64url without padding, Web Crypto so it runs unchanged in Deno and in
// Vitest — but a different payload: this one expires. An unsubscribe link is
// always allowed to work; a comment window is not.

export interface ReviewTokenPayload {
  /** review_responses.id */
  rid: string;
  /** Unix seconds. */
  exp: number;
}

/** 30 minutes: long enough to type a paragraph, short enough to be worthless later. */
export const REVIEW_TOKEN_TTL_SECONDS = 1800;

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

function isValidPayload(p: unknown): p is ReviewTokenPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.rid === 'string' &&
    o.rid.length > 0 &&
    typeof o.exp === 'number' &&
    Number.isFinite(o.exp)
  );
}

export async function signReviewToken(
  payload: ReviewTokenPayload,
  secret: string
): Promise<string> {
  const key = await importHmacKey(secret);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sigBuf = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

export async function verifyReviewToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<ReviewTokenPayload | null> {
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
  if (!constantTimeEqual(new Uint8Array(expectedBuf), sigBytes)) return null;

  // Signature first, expiry second: an expired token that was never ours
  // should look identical to an expired token that was.
  if (parsed.exp < nowSeconds) return null;

  return { rid: parsed.rid, exp: parsed.exp };
}
