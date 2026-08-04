import { memberInitials } from '@/components/roles/memberDisplay';
import type { RestaurantMember } from '@/hooks/useRestaurantMembers';
import { cn } from '@/lib/utils';

/**
 * A member's initials in a circle — the same face in the three places this
 * feature shows one: the card's face pile, the roster row, and the assign
 * dialog's candidate list.
 *
 * Always `aria-hidden`. Initials are a visual shorthand for a name that is
 * already announced beside them (or, in the face pile's case, for a count that
 * is); reading "DC" aloud tells a screen reader user nothing they can act on.
 */

const SIZES = {
  /** Face pile, where three overlap inside a card footer. */
  sm: 'h-[22px] w-[22px] text-[10px]',
  /** Assign-dialog rows. */
  md: 'h-8 w-8 text-[11px]',
  /** Roster rows, beside a name and an email. */
  lg: 'h-9 w-9 text-[12px]',
} as const;

export function MemberAvatar({
  member,
  size = 'lg',
  className,
}: {
  member: RestaurantMember;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex-shrink-0 rounded-full bg-muted flex items-center justify-center font-medium text-muted-foreground',
        SIZES[size],
        className
      )}
    >
      {memberInitials(member)}
    </span>
  );
}
