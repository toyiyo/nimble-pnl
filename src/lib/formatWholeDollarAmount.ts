const baseDollarFormatOptions: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'USD',
};

const wholeDollarFormatter = new Intl.NumberFormat('en-US', {
  ...baseDollarFormatOptions,
  maximumFractionDigits: 0,
});

/** Format a whole-dollar amount for display, for example "$1,240". */
export function formatWholeDollarAmount(amount: number): string {
  return wholeDollarFormatter.format(amount);
}
