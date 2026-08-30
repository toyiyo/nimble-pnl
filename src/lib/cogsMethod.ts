export type COGSMethod = 'inventory' | 'financials';

/**
 * Normalize a stored COGS method value to a valid method.
 * The removed 'combined' method, and any null, undefined, or
 * unknown value, falls back to 'inventory' (the system default).
 */
export function normalizeCOGSMethod(
  value: string | null | undefined,
): COGSMethod {
  return value === 'financials' ? 'financials' : 'inventory';
}
