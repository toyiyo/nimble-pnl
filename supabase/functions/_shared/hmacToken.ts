// Shared low-level primitives for `<payload>.<signature>` HMAC-SHA256 tokens.
//
// Both halves are base64url (no padding); the signature is HMAC-SHA256 over
// the raw payload bytes. Uses Web Crypto so it runs unchanged in Deno
// (edge-function runtime) and in Vitest (jsdom + Node 19+ globalThis.crypto).
//
// Callers own their own payload shape and validation — this module only
// handles the encode/sign/verify mechanics common to every token format
// (see reviewToken.ts and unsubscribeToken.ts).

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(padLen));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Splits `<payload>.<signature>` and decodes both halves, or null on any malformed input. */
export function splitToken(token: string): { payloadBytes: Uint8Array; sigBytes: Uint8Array } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts;
  if (!payloadPart || !sigPart) return null;

  try {
    return { payloadBytes: fromBase64Url(payloadPart), sigBytes: fromBase64Url(sigPart) };
  } catch {
    return null;
  }
}

export async function signPayloadBytes(payloadBytes: Uint8Array, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

export async function verifySignature(
  payloadBytes: Uint8Array,
  sigBytes: Uint8Array,
  secret: string
): Promise<boolean> {
  const key = await importHmacKey(secret);
  const expectedBuf = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return constantTimeEqual(new Uint8Array(expectedBuf), sigBytes);
}
