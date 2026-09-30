/** Format a whole-dollar amount for display, for example "$1,240". */
export function formatWholeDollarAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}
