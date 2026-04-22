export function formatExpiresIn(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days > 1) return `Expires in ${days} days`;
  if (days === 1) return 'Expires tomorrow';
  if (days === 0) return ms > 0 ? 'Expires today' : 'Expired yesterday';
  if (days === -1) return 'Expired yesterday';
  return `Expired ${Math.abs(days)} days ago`;
}

export function classifyInvitationError(message: string): 'expired' | 'invalid' {
  return message === 'Invitation has expired' ? 'expired' : 'invalid';
}
