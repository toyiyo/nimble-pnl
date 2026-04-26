import { isValidAbaRouting } from '@/lib/abaChecksum';

/** MICR E-13B "on-us" symbol (⑈) — flanks check number and ends account field. */
export const MICR_ON_US = '⑈';

/** MICR E-13B "transit" symbol (⑆) — flanks the 9-digit routing number. */
export const MICR_TRANSIT = '⑆';

export interface MicrLineInput {
  checkNumber: number;
  routingNumber: string;
  accountNumber: string;
}

export function formatMicrLine({ checkNumber, routingNumber, accountNumber }: MicrLineInput): string {
  if (!Number.isInteger(checkNumber) || checkNumber < 1) {
    throw new Error('check number must be a positive integer');
  }
  if (!isValidAbaRouting(routingNumber)) {
    throw new Error('routing number is not a valid 9-digit ABA');
  }
  if (!/^\d{4,17}$/.test(accountNumber)) {
    throw new Error('account number must be 4-17 digits');
  }
  return (
    `${MICR_ON_US}${checkNumber}${MICR_ON_US}` +
    `  ${MICR_TRANSIT}${routingNumber}${MICR_TRANSIT}` +
    `  ${accountNumber}${MICR_ON_US}`
  );
}
