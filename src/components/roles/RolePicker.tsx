import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useInsideScrollLock } from '@/components/ui/scroll-lock-boundary';
import { Check, ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useRoles, type RoleWithGrants } from '@/hooks/useRoles';
import { useAssignRole, assignRoleErrorMessage } from '@/hooks/useAssignRole';
import { useToast } from '@/hooks/use-toast';
import { RoleAreaChips } from '@/components/roles/RoleAreaChips';
import { ROLE_METADATA } from '@/lib/permissions/definitions';
import {
  CUSTOM_ROLE,
  canInviteCustomRole,
  getInvitableRoles,
} from '@/lib/permissions/invitations';
import { roleDelta, type RoleGrantSet } from '@/lib/permissions/roleDelta';
import type { Role } from '@/lib/permissions/types';
import { cn } from '@/lib/utils';

export interface RolePickerProps {
  membershipId: string;
  restaurantId: string;
  /** Display name of the person whose role this is — for the accessible name. */
  personName: string;
  currentRole: string;
  currentRoleId: string | null;
  /** The signed-in user's role in this restaurant — gates the option list. */
  callerRole: Role;
  disabled?: boolean;
  /**
   * Called after the assignment lands. Only needed by hosts that keep their
   * member list outside React Query — `useAssignRole` invalidates
   * `['roles'|'collaborators'|'restaurants']`, which cannot reach a list held
   * in `useState`. TeamMembers is such a host; Collaborators is not.
   */
  onAssigned?: () => void;
}

const grantSetOf = (role: RoleWithGrants | undefined): RoleGrantSet => ({
  areas: role?.role_areas ?? [],
  flags: (role?.role_flags ?? []).map((f) => f.flag),
});

/** One "Gains X" / "Loses X" line per label, styled and iconed by `kind`. */
function renderDeltaLines(labels: string[], kind: 'gain' | 'lose') {
  const Icon = kind === 'gain' ? ArrowUp : ArrowDown;
  const colorClass = kind === 'gain' ? 'text-success' : 'text-destructive';
  const verb = kind === 'gain' ? 'Gains' : 'Loses';
  return labels.map((label) => (
    <p key={`${kind}-${label}`} className={`flex items-center gap-1.5 text-[13px] ${colorClass}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {verb} {label}
    </p>
  ));
}

export function RolePicker({
  membershipId,
  restaurantId,
  personName,
  currentRole,
  currentRoleId,
  callerRole,
  disabled = false,
  onAssigned,
}: RolePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const modal = useInsideScrollLock();
  const { toast } = useToast();

  // useRoles returns { roles, isLoading, error, ... } — NOT a raw React Query
  // result, so there is no `data` here.
  const { roles, isLoading, error } = useRoles(restaurantId);
  const assign = useAssignRole(restaurantId);

  const invitable = useMemo(() => getInvitableRoles(callerRole), [callerRole]);
  const mayAssignCustom = canInviteCustomRole(callerRole);

  const searchQuery = search.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(searchQuery);

  const customRoles = roles.filter(
    (r) => r.restaurant_id === restaurantId && matches(r.name)
  );
  const builtinRoles = roles.filter(
    (r) =>
      r.legacy_role !== null &&
      (invitable as readonly string[]).includes(r.legacy_role) &&
      matches(r.name)
  );

  const isCurrent = (r: RoleWithGrants) =>
    currentRoleId ? r.id === currentRoleId : r.legacy_role === currentRole;

  const currentRow = roles.find(isCurrent);
  const candidateRow = roles.find((r) => r.id === candidateId);
  const delta = candidateRow
    ? roleDelta(grantSetOf(currentRow), grantSetOf(candidateRow))
    : null;

  const currentLabel =
    currentRow?.name ?? ROLE_METADATA[currentRole as Role]?.label ?? currentRole;

  const commit = () => {
    if (!candidateRow) return;
    const isCustom = candidateRow.legacy_role === null;
    assign.mutate(
      {
        membershipId,
        role: isCustom ? CUSTOM_ROLE : candidateRow.legacy_role!,
        roleId: isCustom ? candidateRow.id : undefined,
      },
      {
        onSuccess: () => {
          toast({ title: `${personName} is now ${candidateRow.name}` });
          setOpen(false);
          setCandidateId(null);
          setSearch('');
          onAssigned?.();
        },
        onError: (err) =>
          toast({
            title: "Couldn't change that role",
            description: assignRoleErrorMessage(err),
            variant: 'destructive',
          }),
      }
    );
  };

  // The chip IS the control, so the visible text is the role name alone. WCAG
  // 2.5.3 Label in Name requires the accessible name to CONTAIN that visible
  // text, so a voice-control user saying "click Manager" still hits it —
  // hence the name is embedded rather than replaced.
  const triggerLabel = `${personName}: role is ${currentLabel}. Change role`;

  const renderRow = (r: RoleWithGrants) => (
    // value={r.name} is load-bearing: cmdk filters on the `value` prop, and
    // with chips and a description as children its default text extraction
    // would match the concatenated blob instead of the name.
    <CommandItem
      key={r.id}
      value={r.name}
      onSelect={() => setCandidateId(r.id)}
      className="flex flex-col items-start gap-1.5 py-2.5"
    >
      <div className="flex w-full items-center gap-2">
        <Check
          className={cn('h-4 w-4 shrink-0', isCurrent(r) ? 'opacity-100' : 'opacity-0')}
        />
        <span className="text-[14px] font-medium text-foreground">{r.name}</span>
      </div>
      {r.description && (
        <p className="pl-6 text-[13px] text-muted-foreground">{r.description}</p>
      )}
      <div className="pl-6">
        <RoleAreaChips areas={r.role_areas} />
      </div>
    </CommandItem>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCandidateId(null);
          setSearch('');
        }
      }}
      modal={modal}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={triggerLabel}
          disabled={disabled}
          className="h-7 max-w-[220px] gap-1 rounded-full border-border/40 px-2.5 text-[13px] font-medium"
        >
          <span className="truncate">{currentLabel}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[340px] p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search roles..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {/*
              These three states are direct children of CommandList, never
              routed through CommandEmpty. CommandEmpty means "no rows
              registered" — it cannot distinguish a load failure from an empty
              restaurant, and rendering an error through it would tell the
              admin there are no roles when in fact the request failed.

              !restaurantId is checked alongside isLoading because useRoles is
              enabled: !!restaurantId, and a disabled React Query reports
              isLoading === false.
            */}
            {(!restaurantId || isLoading) && (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                Loading roles…
              </p>
            )}
            {error && (
              <p className="px-3 py-6 text-center text-[13px] text-destructive">
                Couldn't load roles. Please try again.
              </p>
            )}
            {!isLoading && !error && customRoles.length === 0 && builtinRoles.length === 0 && (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                No roles match. Create one in Team → Roles.
              </p>
            )}

            {/*
              The custom group renders for a caller who cannot assign custom
              roles too — visibly, with the reason. Hiding it is what produced
              the original "I made a role and it's nowhere" confusion.
            */}
            {customRoles.length > 0 && (
              <CommandGroup heading="Your custom roles">
                {mayAssignCustom ? (
                  customRoles.map(renderRow)
                ) : (
                  <p className="px-2 py-2 text-[13px] text-muted-foreground">
                    Only an owner or manager can assign a custom role.
                  </p>
                )}
              </CommandGroup>
            )}

            {builtinRoles.length > 0 && (
              <CommandGroup heading="Built-in">{builtinRoles.map(renderRow)}</CommandGroup>
            )}
          </CommandList>

          {delta && candidateRow && (
            <div className="space-y-2 border-t border-border/40 px-3 py-3">
              {delta.isSame ? (
                <p className="text-[13px] text-muted-foreground">
                  Same access — only the label changes.
                </p>
              ) : (
                <div className="space-y-1">
                  {renderDeltaLines(
                    [...delta.gains.map((g) => g.label), ...delta.flagGains.map((f) => f.label)],
                    'gain'
                  )}
                  {renderDeltaLines(
                    [...delta.loses.map((l) => l.label), ...delta.flagLoses.map((f) => f.label)],
                    'lose'
                  )}
                </div>
              )}
              <Button
                onClick={commit}
                disabled={assign.isPending}
                aria-label={`Change role to ${candidateRow.name}`}
                className="h-9 w-full rounded-lg bg-foreground text-[13px] font-medium text-background hover:bg-foreground/90"
              >
                {assign.isPending ? 'Changing…' : `Change role to ${candidateRow.name}`}
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
