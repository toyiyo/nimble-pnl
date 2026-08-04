import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { UserPlus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAssignPeopleToRole } from '@/hooks/useAssignRole';
import { useRestaurantMembers } from '@/hooks/useRestaurantMembers';
import { useToast } from '@/hooks/use-toast';
import { MemberIdentity } from '@/components/roles/MemberIdentity';
import { memberDisplayName } from '@/components/roles/memberDisplay';
import { CUSTOM_ROLE } from '@/lib/permissions/invitations';
import { legacyRoleIndex, resolveMembershipRoleId } from '@/lib/permissions/roleMembership';
import type { RoleWithGrants } from '@/hooks/useRoles';
import type { Role } from '@/lib/permissions/types';

/**
 * AssignPeopleDialog — put existing members into a role, several at a time.
 *
 * The reverse of `RolePicker`, which starts from a person and picks their role.
 * This starts from the role, which is the direction an empty custom role leaves
 * you facing. Both write through the same `assign_membership_role` RPC.
 */

export interface AssignPeopleDialogProps {
  role: RoleWithGrants;
  restaurantId: string;
  /** The signed-in user's role in this restaurant. */
  callerRole: Role;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function selectionLabel(count: number): string {
  if (count === 0) return 'Nobody selected';
  return count === 1 ? '1 person selected' : `${count} people selected`;
}

function submitLabel(submitting: boolean, count: number): string {
  if (submitting) return 'Assigning…';
  if (count === 0) return 'Assign';
  return `Assign ${count}`;
}

/**
 * The members query refetches in the background while the dialog sits open, so
 * someone ticked a moment ago may no longer be a candidate — another admin put
 * them in this role, or made them an owner. The button promised a number; say
 * when we assigned fewer rather than letting the toast quietly disagree.
 */
function droppedNoteText(dropped: number): string | undefined {
  if (dropped <= 0) return undefined;
  if (dropped === 1) return 'One person was already handled elsewhere and was skipped.';
  return `${dropped} people were already handled elsewhere and were skipped.`;
}

export function AssignPeopleDialog({
  role,
  restaurantId,
  callerRole,
  open,
  onOpenChange,
}: AssignPeopleDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: members, isLoading, error } = useRestaurantMembers(restaurantId);
  const { mutateAsync: assignPeople, isPending: submitting } = useAssignPeopleToRole(restaurantId);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const candidates = useMemo(() => {
    if (!members) return [];
    const byLegacy = legacyRoleIndex([role]);
    return members.filter((m) => {
      // Already here. Resolved the way role_member_counts resolves it, so this
      // list and the card's count agree on who is already in.
      if (resolveMembershipRoleId(m, byLegacy) === role.id) return false;
      // RPC rule 2: never self-target.
      if (user && m.userId === user.id) return false;
      // RPC rule 4: a kiosk is a shared device credential, not a person.
      if (m.role === 'kiosk') return false;
      // RPC rule 5a: only an owner may change an owner.
      if (m.role === 'owner' && callerRole !== 'owner') return false;
      return true;
    });
  }, [members, role, user, callerRole]);

  const toggle = (membershipId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(membershipId)) next.delete(membershipId);
      else next.add(membershipId);
      return next;
    });
  };

  const close = (nextOpen: boolean) => {
    // Every dismissal funnels through Radix's onOpenChange — Escape, the
    // overlay, and the X button alike — so one guard covers all three. Closing
    // mid-run would clear `selected` while the loop is still writing, so a
    // partial failure would have nothing left to re-tick, and the failure toast
    // would name rows the user can no longer see. Cancel is already disabled
    // while submitting; this makes the other exits agree with it.
    if (!nextOpen && submitting) return;
    if (!nextOpen) setSelected(new Set());
    onOpenChange(nextOpen);
  };

  const submit = async () => {
    const chosen = candidates.filter((m) => selected.has(m.membershipId));
    const droppedNote = droppedNoteText(selected.size - chosen.length);

    if (chosen.length === 0) {
      // Everyone ticked has since left the candidate list, so `renderCandidates`
      // no longer draws a row for any of them — there is nothing left to untick.
      // Clearing the selection is the only way back to a button that means what
      // it says; returning without it leaves an enabled "Assign N" that can
      // never do anything.
      setSelected(new Set());
      if (droppedNote) toast({ title: 'Nothing left to assign', description: droppedNote });
      return;
    }

    // Mirrors RolePicker.tsx:133-141 — a builtin role names itself and carries
    // no role_id; a custom role is the bare literal plus its id.
    const payload = role.legacy_role
      ? { role: role.legacy_role as Role, roleId: undefined }
      : { role: CUSTOM_ROLE, roleId: role.id };

    // The mutation owns the sequential loop, the per-person failure capture and
    // the single batch invalidation; it resolves rather than throwing, because a
    // partial failure is a result to report, not an exception. See
    // useAssignRole.ts for why none of that is optimistic.
    const { landed, failures } = await assignPeople({ members: chosen, ...payload });

    if (failures.length === 0) {
      toast({
        title:
          landed === 1
            ? `${memberDisplayName(chosen[0])} is now ${role.name}`
            : `${landed} people are now ${role.name}`,
        description: droppedNote,
      });
      close(false);
      return;
    }

    // Partial failure keeps the dialog open with the failed rows still ticked,
    // so a retry does not re-assign the ones that already landed.
    setSelected(new Set(failures.map((f) => f.member.membershipId)));
    toast({
      title: landed > 0 ? `${landed} assigned, ${failures.length} failed` : "Couldn't assign",
      description: [
        ...failures.map((f) => `${memberDisplayName(f.member)}: ${f.message}`),
        ...(droppedNote ? [droppedNote] : []),
      ].join('\n'),
      variant: 'destructive',
    });
  };

  // One state per branch, as sequential returns rather than a ternary chain.
  // A plain function, not a component: it closes over the six values below, and
  // it is called — not mounted — so React never remounts the list.
  const renderCandidates = () => {
    if (isLoading) {
      return (
        <div className="space-y-2" data-testid="assign-people-loading">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      );
    }
    if (error) {
      return (
        <p role="alert" className="text-[13px] text-destructive">
          Couldn&apos;t load your team. Please try again.
        </p>
      );
    }
    if (candidates.length === 0) {
      return <p className="text-[13px] text-muted-foreground">Everyone already holds this role.</p>;
    }
    return (
      <div className="space-y-1">
        {candidates.map((member) => (
          <label
            key={member.membershipId}
            className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
          >
            <Checkbox
              checked={selected.has(member.membershipId)}
              onCheckedChange={() => toggle(member.membershipId)}
              disabled={submitting}
            />
            <MemberIdentity member={member} size="md" />
          </label>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <UserPlus className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Assign to {role.name}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Everyone you pick leaves the role they&apos;re in now.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5">{renderCandidates()}</div>

        <DialogFooter className="px-6 py-4 border-t border-border/40 sm:justify-between items-center gap-3">
          <span className="text-[13px] text-muted-foreground">{selectionLabel(selected.size)}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => close(false)}
              disabled={submitting}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={selected.size === 0 || submitting}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {submitLabel(submitting, selected.size)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
