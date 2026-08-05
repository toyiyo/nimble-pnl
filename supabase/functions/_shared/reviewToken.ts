// HMAC-SHA256 signed tokens proving a guest owns the review_responses row they
// are about to comment on.
//
// Same mechanism as unsubscribeToken.ts — both build on hmacToken.ts's
// `<payload>.<signature>` primitives — but a different payload: this one
// expires. An unsubscribe link is always allowed to work; a comment window is
// not.

import { signPayloadBytes, splitToken, verifySignature } from './hmacToken.ts';

export interface ReviewTokenPayload {
  /** review_responses.id */
  rid: string;
  /** Unix seconds. */
  exp: number;
}

/** 30 minutes: long enough to type a paragraph, short enough to be worthless later. */
export const REVIEW_TOKEN_TTL_SECONDS = 1800;

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
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  return signPayloadBytes(payloadBytes, secret);
}

export async function verifyReviewToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<ReviewTokenPayload | null> {
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

  // Signature first, expiry second: an expired token that was never ours
  // should look identical to an expired token that was.
  if (parsed.exp < nowSeconds) return null;

  return { rid: parsed.rid, exp: parsed.exp };
}
