import { quoteForOrFilter } from '@/lib/utils';

// Accepted forms: optional sign before or after an optional $ (not both),
// a whole part with or without thousands commas, and up to 2 decimals.
const AMOUNT_PATTERN = /^(-?)\$?(-?)([\d,]*)(?:\.(\d{1,2}))?$/;
const WHOLE_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d*)$/;

/**
 * Parse search text as a money amount.
 * Return the absolute amount as a decimal string, or null if the text is not an amount.
 * Return a string so float conversion cannot change the digits.
 */
export function parseSearchAmount(text: string): string | null {
  const match = AMOUNT_PATTERN.exec(text);
  if (!match) return null;
  const [, signBefore, signAfter, whole, fraction] = match;
  if (signBefore && signAfter) return null;
  if (!WHOLE_PATTERN.test(whole)) return null;
  if (!whole && fraction === undefined) return null;
  const digits = whole.replace(/,/g, '') || '0';
  return fraction === undefined ? digits : `${digits}.${fraction}`;
}

/**
 * Build the .or() filter string for the bank transaction search.
 * Debits are negative and credits are positive, so an amount adds both signs.
 */
export function buildBankSearchFilter(text: string): string {
  const pattern = quoteForOrFilter(`%${text}%`);
  const conditions = [
    `description.ilike.${pattern}`,
    `merchant_name.ilike.${pattern}`,
    `normalized_payee.ilike.${pattern}`,
  ];
  const amount = parseSearchAmount(text);
  if (amount !== null) {
    conditions.push(`amount.eq.${amount}`);
    // A zero amount has no negative twin, so skip the negative condition.
    if (!/^[0.]+$/.test(amount)) conditions.push(`amount.eq.-${amount}`);
  }
  return conditions.join(',');
}
