import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

import { Mail } from 'lucide-react';

import { usePendingInvitations } from '@/hooks/usePendingInvitations';

import type { Role } from '@/lib/permissions/types';

import { ROLE_METADATA } from '@/lib/permissions/definitions';
import { formatExpiresIn } from '@/lib/invitationUtils';

/**
 * Pending team invitations for a signed-in user with no restaurant.
 * Shown on the empty dashboard so an invitee joins the team instead of
 * creating an owner account. The parent gates the mount on
 * `restaurants.length === 0`.
 */
export function PendingInvitationsCard() {
  const { invitations, isLoading, error, accept, accepting, acceptingId } = usePendingInvitations();

  if (isLoading) {
    return (
      <div className="w-full max-w-xl mx-auto" data-testid="pending-invitations-loading">
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  // On a query error the card stays silent by design: the dashboard must
  // stay usable, and the emailed invite link is the fallback path.
  if (error || invitations.length === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center gap-2">
          <Mail className="h-4 w-4 text-foreground" aria-hidden="true" />
          <h3 className="text-[13px] font-semibold text-foreground">
            {invitations.length > 1 ? 'You have team invitations' : 'You have a team invitation'}
          </h3>
        </div>
        <div className="p-4 space-y-3">
          {invitations.map((invitation) => (
            <div
              key={invitation.invitationId}
              className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border/40 bg-background"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-foreground truncate">
                  {invitation.restaurantName}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {ROLE_METADATA[invitation.role as Role]?.label ?? invitation.role}
                  {' · '}
                  {formatExpiresIn(invitation.expiresAt)}
                </p>
              </div>
              <Button
                onClick={() => accept(invitation.invitationId)}
                disabled={accepting}
                aria-label={`Accept invitation to ${invitation.restaurantName}`}
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium shrink-0"
              >
                {acceptingId === invitation.invitationId ? 'Accepting...' : 'Accept'}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
