/**
 * Validate an ABA routing number using the standard checksum:
 *   3·d1 + 7·d2 + d3 + 3·d4 + 7·d5 + d6 + 3·d7 + 7·d8 + d9 ≡ 0 (mod 10)
 * Also rejects all-zero routing numbers (special-case: reserved/invalid).
 */
export function isValidAbaRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  if (routing === '000000000') return false;
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(routing[i]) * weights[i];
  }
  return sum % 10 === 0;
}
