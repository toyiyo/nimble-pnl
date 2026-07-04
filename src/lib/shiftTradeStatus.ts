/** A trade is expired when its offered shift started in the past. */
export function isTradeExpired(startTimeIso: string | undefined, now: Date): boolean {
  if (!startTimeIso) return false;
  return new Date(startTimeIso).getTime() < now.getTime();
}
