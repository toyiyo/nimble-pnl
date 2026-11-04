// Bearer check for edge functions that only a pg_cron job calls.
//
// No Deno imports: the unit tests run this file in Node.

/** Compares two strings in time that does not depend on where they differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True when the Authorization header is exactly `Bearer <serviceRoleKey>`.
 * An empty key never matches, so a missing env value cannot open the door.
 */
export function isServiceRoleBearer(authHeader: string | null, serviceRoleKey: string): boolean {
  if (!serviceRoleKey) return false;
  return timingSafeEqual(authHeader ?? '', `Bearer ${serviceRoleKey}`);
}
