import { quoteForOrFilter } from '@/lib/utils';

const AMOUNT_PATTERN = /^(-?)(\$?)(-?)((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)?)(?:\.([0-9]{1,2}))?$/;

/**
 * Parse search text as a money amount.
 * Return the absolute amount as a decimal string, or null if the text is not an amount.
 * Return a string so float conversion cannot change the digits.
 */
export function parseSearchAmount(text: string): string | null {
  const match = AMOUNT_PATTERN.exec(text);
  if (!match) return null;
  const [, signBefore, , signAfter, whole, fraction] = match;
  if (signBefore && signAfter) return null;
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
    if (!/^[0.]+$/.test(amount)) conditions.push(`amount.eq.-${amount}`);
  }
  return conditions.join(',');
}
