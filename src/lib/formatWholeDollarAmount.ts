const baseDollarFormatOptions: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'USD',
};

const wholeDollarFormatter = new Intl.NumberFormat('en-US', {
  ...baseDollarFormatOptions,
  maximumFractionDigits: 0,
});

const compactDollarFormatter = new Intl.NumberFormat('en-US', {
  ...baseDollarFormatOptions,
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Format a whole-dollar amount for display, for example "$1,240". */
export function formatWholeDollarAmount(amount: number): string {
  return wholeDollarFormatter.format(amount);
}

/** Format a dollar amount in compact notation, for example "$1.2K". */
export function formatCompactDollarAmount(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return compactDollarFormatter.format(amount);
  }
  return wholeDollarFormatter.format(amount);
}
