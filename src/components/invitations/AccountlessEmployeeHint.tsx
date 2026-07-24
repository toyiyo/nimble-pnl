import { Link2 } from 'lucide-react';

interface AccountlessEmployeeHintProps {
  /** Element id wired into the invite email input's `aria-describedby`. */
  id: string;
  employeeName: string;
  /** Display label for the role being granted (e.g. "Manager", "Recipe Consultant"). */
  roleLabel: string;
}

/**
 * Inform panel shown when an invite email matches an active employee who has
 * no linked account yet. Shared between TeamInvitations and
 * CollaboratorInvitations — same copy, same markup, only the role label and
 * panel id differ per caller.
 */
export function AccountlessEmployeeHint({ id, employeeName, roleLabel }: AccountlessEmployeeHintProps) {
  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 p-3 rounded-lg bg-info/10 border border-info/20 text-[13px]"
    >
      <Link2 className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <p className="text-foreground">
        <strong>{employeeName}</strong> is already set up for scheduling here. Accepting this
        invite will link their new <strong>{roleLabel}</strong> login to that same record — no
        duplicate profile.
      </p>
    </div>
  );
}
