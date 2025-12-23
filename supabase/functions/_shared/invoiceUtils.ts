export function computeProcessingFeeCents(baseCents: number, rate = 0.029, fixedCents = 30): number {
  if (baseCents <= 0) return 0;
  const gross = Math.round((baseCents + fixedCents) / (1 - rate));
  const fee = gross - baseCents;
  return Math.max(0, fee);
}
