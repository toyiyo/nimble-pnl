/**
 * Revel webhook signature verification.
 * Revel sends `X-Revel-Signature` = base64( HMAC-SHA1( rawBody, sharedSecret ) ).
 * Uses Web Crypto so it runs in both Deno (edge) and Node (Vitest).
 */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function computeRevelSignature(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return bytesToBase64(new Uint8Array(mac));
}

/** Constant-time-ish comparison to avoid early-exit timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function verifyRevelSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;
  const expected = await computeRevelSignature(rawBody, secret);
  return safeEqual(signature, expected);
}
