// Rate limiting for the public review endpoint.
//
// 120 per hour per (review_page_id, ip_hash) is generous for a busy dining
// room behind one NAT and useless for a script. The raw IP is never stored:
// what lands in review_responses.ip_hash is sha256(ip || pepper), so the
// column is a correlation key and not a record of who visited.

export const REVIEW_RATE_LIMIT_PER_HOUR = 120;
export const REVIEW_RATE_WINDOW_MS = 3_600_000;

export async function hashIp(ip: string, pepper: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${ip}${pepper}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isOverLimit(existingCount: number): boolean {
  return existingCount >= REVIEW_RATE_LIMIT_PER_HOUR;
}
