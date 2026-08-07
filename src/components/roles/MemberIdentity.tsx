import { MemberAvatar } from '@/components/roles/MemberAvatar';
import { memberDisplayName } from '@/components/roles/memberDisplay';
import type { RestaurantMember } from '@/hooks/useRestaurantMembers';
import { cn } from '@/lib/utils';

/**
 * Who a row is about: initials, name, and email if we have one.
 *
 * Shared by the roster and the assign dialog so truncation and spacing cannot
 * drift between the two lists showing the same people. All spans, no divs — one
 * of the two hosts is a `<label>`, and block elements inside a label are as
 * wrong as a button inside a button.
 */
export function MemberIdentity({
  member,
  size = 'lg',
  className,
}: {
  member: RestaurantMember;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <span className={cn('flex items-center gap-3 min-w-0', className)}>
      <MemberAvatar member={member} size={size} />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-foreground truncate">
          {memberDisplayName(member)}
        </span>
        {member.email && (
          <span className="block text-[12px] text-muted-foreground truncate">{member.email}</span>
        )}
      </span>
    </span>
  );
}
