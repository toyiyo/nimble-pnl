// HMAC-SHA256 signed tokens for one-click email unsubscribe links.
//
// Token format: `<payload>.<signature>`, built on hmacToken.ts's shared
// base64url + HMAC primitives. The payload is JSON; the signature is
// HMAC-SHA256 over the raw payload bytes. We only need a stateless way to
// prove the link came from us — no expiry, since unsubscribe is always
// allowed and the link is already user-specific.

import { signPayloadBytes, splitToken, verifySignature } from './hmacToken.ts';

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
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  return signPayloadBytes(payloadBytes, secret);
}

export async function verifyUnsubscribe(
  token: string,
  secret: string
): Promise<UnsubPayload | null> {
  const split = splitToken(token);
  if (!split) return null;
  const { payloadBytes, sigBytes } = split;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isValidPayload(parsed)) return null;

  if (!(await verifySignature(payloadBytes, sigBytes, secret))) return null;

  return { user_id: parsed.user_id, list: parsed.list };
}
