import { memberInitials } from '@/components/roles/memberDisplay';
import type { RestaurantMember } from '@/hooks/useRestaurantMembers';
import { cn } from '@/lib/utils';

/**
 * The overlapping initials next to a role card's member count.
 *
 * Purely decorative: the count beside it already says how many people are in
 * the role, and the button's aria-label says whose role it is, so announcing
 * three sets of initials would add nothing a screen reader user could act on.
 * Hence `aria-hidden` on the wrapper rather than per-avatar labels.
 *
 * Renders nothing when `members` is empty — including while the roster query is
 * still in flight. The count comes from the server (`role.memberCount`), so a
 * slow or failed members query costs faces, never correctness.
 *
 * `ring-card` (not `ring-background`): these sit on the card's surface, and the
 * ring exists to cut the overlap.
 */
export function RoleFacePile({
  members,
  max = 3,
  className,
}: {
  members: readonly RestaurantMember[];
  max?: number;
  className?: string;
}) {
  if (members.length === 0) return null;

  return (
    <span className={cn('flex -space-x-1.5', className)} aria-hidden="true">
      {members.slice(0, max).map((member) => (
        <span
          key={member.membershipId}
          className="h-[22px] w-[22px] flex-shrink-0 rounded-full bg-muted ring-2 ring-card flex items-center justify-center text-[10px] font-medium text-muted-foreground"
        >
          {memberInitials(member)}
        </span>
      ))}
    </span>
  );
}
