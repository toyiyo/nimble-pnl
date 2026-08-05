import { useEffect, useState, type ReactNode } from 'react';
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
import { Check, ChevronsUpDown } from 'lucide-react';
import { useRoles, type RoleWithGrants } from '@/hooks/useRoles';
import { RoleAreaChips } from '@/components/roles/RoleAreaChips';
import {
  canInviteCustomRole,
  getInvitableRoles,
  isAssignableCustomRole,
} from '@/lib/permissions/invitations';
import type { Role } from '@/lib/permissions/types';
import { cn } from '@/lib/utils';

export interface RoleSelectProps {
  restaurantId: string;
  callerRole: Role;
  /**
   * The role id the checkmark sits on, or null for none.
   *
   * This is "what is true", NOT "what is highlighted". `RolePicker` passes the
   * CURRENT role here and leaves the candidate to its footer — today's
   * `isCurrent` check never moves when you click an option, and moving it
   * would erase the only on-screen record of what the person has now.
   */
  value: string | null;
  onSelect: (role: RoleWithGrants) => void;
  /** Accessible name. MUST contain `triggerText` (WCAG 2.5.3). */
  triggerLabel: string;
  /** Visible chip text. */
  triggerText: string;
  disabled?: boolean;
  /** Rendered as a sibling of CommandList, inside Command. Never inside CommandList. */
  footer?: ReactNode;
  /** Optional: control `open` only when the popover has to close on something
   * other than a click outside — the invite pickers close on select, RolePicker
   * closes when the assignment lands. Left off, the popover manages itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function RoleSelect({
  restaurantId,
  callerRole,
  value,
  onSelect,
  triggerLabel,
  triggerText,
  disabled = false,
  footer,
  open: openProp,
  onOpenChange,
}: RoleSelectProps) {
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const open = openProp ?? openUncontrolled;
  const setOpen = (next: boolean) => {
    // Only track internally while nobody else is driving `open`. Writing both
    // would leave the two out of step for a caller that passes `open` without
    // `onOpenChange`, and whichever one it stopped agreeing with would win.
    if (openProp === undefined) setOpenUncontrolled(next);
    onOpenChange?.(next);
  };

  const [search, setSearch] = useState('');
  // Clearing on the `open` value rather than inside onOpenChange: a caller that
  // drives `open` itself never routes through Radix's callback, so both real
  // call sites (RolePicker closes in onSuccess, the invite pickers close on
  // select) would reopen still filtered by the last thing typed.
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const modal = useInsideScrollLock();

  // useRoles returns { roles, isLoading, error, ... } — NOT a raw React Query
  // result, so there is no `data` here.
  const { roles, isLoading, error } = useRoles(restaurantId);

  const invitable = getInvitableRoles(callerRole);
  const mayAssignCustom = canInviteCustomRole(callerRole);

  const searchQuery = search.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(searchQuery);

  // Only roles `assign_membership_role` will actually accept for
  // `collaborator_custom` — see `isAssignableCustomRole` for why the three
  // checks are all needed. Shared with `canAssignTargetRole`, which gates the
  // "Assign people" entry points, so the options here and the door that leads to
  // them agree.
  const customRoles = roles.filter((r) => isAssignableCustomRole(r, restaurantId) && matches(r.name));
  const builtinRoles = roles.filter(
    (r) =>
      r.legacy_role !== null &&
      (invitable as readonly string[]).includes(r.legacy_role) &&
      matches(r.name)
  );

  const renderRow = (r: RoleWithGrants) => (
    // value={r.name} is load-bearing: cmdk filters on the `value` prop, and
    // with chips and a description as children its default text extraction
    // would match the concatenated blob instead of the name.
    <CommandItem
      key={r.id}
      value={r.name}
      onSelect={() => onSelect(r)}
      className="flex flex-col items-start gap-1.5 py-2.5"
    >
      <div className="flex w-full items-center gap-2">
        <Check
          className={cn('h-4 w-4 shrink-0', r.id === value ? 'opacity-100' : 'opacity-0')}
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
      onOpenChange={setOpen}
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
          <span className="truncate">{triggerText}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      {/*
        The height cap is load-bearing, not cosmetic. Search box + a 300px list
        + RolePicker's delta footer is ~450px of panel; anchored to a chip
        partway down the employee dialog on a 720px-tall screen, neither side
        has room, so Radix picks the roomier one and the footer — which holds
        the only button that commits the change — lands below the fold with no
        way to scroll to it. `--radix-popover-content-available-height` is the
        space Radix measured on the side it chose, so capping to it lets the
        LIST absorb the shortfall (min-h-0 below) and keeps the footer on
        screen. collisionPadding keeps the panel off the viewport edge.
      */}
      <PopoverContent
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[340px] flex-col p-0"
        align="end"
        collisionPadding={12}
      >
        <Command shouldFilter={false} className="min-h-0">
          <CommandInput
            placeholder="Search roles..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="min-h-0 flex-1">
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
              <p
                role="status"
                aria-live="polite"
                className="px-3 py-6 text-center text-[13px] text-muted-foreground"
              >
                Loading roles…
              </p>
            )}
            {error && (
              <p role="alert" className="px-3 py-6 text-center text-[13px] text-destructive">
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

          {/* shrink-0 so the list, not the footer, gives up the space. */}
          {footer && <div className="shrink-0">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
