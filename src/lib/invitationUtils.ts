const DAY_MS = 1000 * 60 * 60 * 24;

export function formatExpiresIn(expiresAt: string): string {
  const expiresDate = new Date(expiresAt);
  if (isNaN(expiresDate.getTime())) return 'Unknown expiration';
  const ms = expiresDate.getTime() - Date.now();
  const days = ms >= 0 ? Math.floor(ms / DAY_MS) : Math.ceil(ms / DAY_MS);
  if (days > 1) return `Expires in ${days} days`;
  if (days === 1) return 'Expires tomorrow';
  if (days === 0) return ms >= 0 ? 'Expires today' : 'Expired today';
  if (days === -1) return 'Expired yesterday';
  return `Expired ${Math.abs(days)} days ago`;
}

export function classifyInvitationError(message: string): 'expired' | 'invalid' {
  return message === 'Invitation has expired' ? 'expired' : 'invalid';
}
