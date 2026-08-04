import { useMemo } from 'react';
import { AlertCircle, ChevronRight, LayoutGrid, Plus, UserPlus, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRoles, type RoleWithGrants } from '@/hooks/useRoles';
import { useRestaurantMembers, type RestaurantMember } from '@/hooks/useRestaurantMembers';
import { RoleAreaChips } from '@/components/roles/RoleAreaChips';
import { RoleFacePile } from '@/components/roles/RoleFacePile';
import { groupMembersByRole, legacyRoleIndex } from '@/lib/permissions/roleMembership';
import { cn } from '@/lib/utils';

/**
 * RolesList — the card grid on the "Roles & areas" tab (roles-and-areas
 * design, Phase 4 task 9c).
 *
 * Chip/badge/copy conventions (the " · manage" suffix at manage level, the
 * "No areas yet" fallback, "N person"/"N people", the outlined BUILT-IN/
 * Custom badge, the dashed "New role" card) are transcribed verbatim from the
 * approved prototype's `renderRoles` function
 * (docs/design-reference/roles-and-areas.html), not invented. Area *labels*
 * come from `AREA_DEFINITIONS` (src/lib/permissions/areas.ts) — the real
 * single source of truth — rather than the prototype's own copy, which
 * predates that file and uses different placeholder wording for a few rows
 * (e.g. "Scheduling & Labor" vs. this file's "Scheduling").
 *
 * This component only fetches and renders. Deciding what happens on click —
 * navigating to the (read-only, for a builtin) role editor, to a blank draft,
 * or to the role's roster — belongs to the caller via `onSelectRole`,
 * `onNewRole` and `onOpenPeople`; that keeps this component usable from
 * wherever the "Roles & areas" tab ends up living (a later task), without this
 * file needing to know about routing.
 *
 * "Read-only open for builtins" (this task's own description) means exactly
 * that a builtin role's card stays clickable, calling `onSelectRole` like any
 * other card — the read-only *behavior* is the editor's concern (a later
 * task), not something this list disables or special-cases.
 */

export interface RolesListProps {
  restaurantId: string;
  onSelectRole: (role: RoleWithGrants) => void;
  onNewRole: () => void;
  /**
   * The card's second door: who is in this role. Separate from `onSelectRole`
   * because the two go to different places — the role's definition, and the
   * people holding it.
   */
  onOpenPeople: (role: RoleWithGrants) => void;
}

/**
 * The card grid, shared by the loading skeleton and the loaded list so the two
 * cannot drift. 292px is the prototype's card width; auto-fill keeps the grid
 * responsive without a breakpoint ladder.
 */
const ROLE_GRID_CLASS = 'grid gap-3.5 grid-cols-[repeat(auto-fill,minmax(292px,1fr))]';

function memberCountLabel(count: number): string {
  return count === 1 ? '1 person' : `${count} people`;
}

function RoleCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-[18px] rounded-xl border border-border/40 bg-card shadow-sm">
      <div className="flex items-start gap-[11px]">
        <Skeleton className="h-[34px] w-[34px] rounded-lg flex-shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Skeleton className="h-5 w-20 rounded-md" />
        <Skeleton className="h-5 w-24 rounded-md" />
      </div>
      <div className="flex items-center justify-between pt-[11px] border-t border-border/40">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-4 w-14 rounded-md" />
      </div>
    </div>
  );
}

/**
 * A card is two doors, not one.
 *
 * The chrome moved from a single `<button>` onto an `<article>` so the footer
 * can hold its own control: a button inside a button is invalid HTML, and so
 * was the `RoleAreaChips` `<div>` that used to sit inside the outer button. The
 * hit area for "open this role's definition" is now the name block alone, which
 * is also what the prototype does (`.rolecard__hit`).
 */
function RoleCard({
  role,
  roster,
  onClick,
  onOpenPeople,
}: {
  role: RoleWithGrants;
  roster: readonly RestaurantMember[];
  onClick: () => void;
  onOpenPeople: () => void;
}) {
  const Icon = role.builtin ? LayoutGrid : Users;
  // The server's count, not `roster.length`: it is the number the editor's save
  // banner quotes, and it survives a members query that is slow or denied.
  const count = role.memberCount;

  return (
    <article
      // Named so the card is one addressable unit: it now holds two controls
      // plus a badge, and a screen reader jumping between articles should hear
      // which role it landed on.
      aria-label={role.name}
      className={cn(
        'group flex flex-col gap-3 p-[18px] rounded-xl border border-border/40 bg-card shadow-sm',
        'hover:border-border transition-colors'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex items-start gap-[11px] text-left rounded-lg',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        <span className="h-[34px] w-[34px] flex-shrink-0 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-foreground">{role.name}</span>
          {role.description && (
            <span className="block text-[13px] text-muted-foreground mt-0.5">{role.description}</span>
          )}
        </span>
      </button>

      <RoleAreaChips areas={role.role_areas} />

      <div className="flex items-center justify-between gap-2.5 mt-auto pt-[11px] border-t border-border/40 text-[12px] text-muted-foreground">
        {count > 0 ? (
          <button
            type="button"
            onClick={onOpenPeople}
            aria-label={`${memberCountLabel(count)} in ${role.name}. Manage who's in this role`}
            className={cn(
              'group/people inline-flex items-center gap-[7px] rounded-lg -mx-1 px-1 py-0.5',
              'hover:bg-muted hover:text-foreground transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <RoleFacePile members={roster} />
            <span>{memberCountLabel(count)}</span>
            <ChevronRight
              className="h-3 w-3 opacity-0 group-hover/people:opacity-70 transition-opacity"
              aria-hidden="true"
            />
          </button>
        ) : (
          // The case the user actually hit: an empty custom role used to show a
          // dead "0 people". Make it the loudest thing on the card.
          <button
            type="button"
            onClick={onOpenPeople}
            aria-label={`Nobody is in ${role.name} yet. Assign people`}
            className={cn(
              'inline-flex items-center gap-[7px] rounded-lg -mx-1 px-1 py-0.5 font-medium text-foreground',
              'hover:bg-muted transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Assign people</span>
          </button>
        )}
        <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-border/40 font-mono uppercase tracking-wider text-muted-foreground">
          {role.builtin ? 'Built-in' : 'Custom'}
        </span>
      </div>
    </article>
  );
}

function NewRoleCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-[7px] min-h-[148px] p-[18px]',
        'rounded-xl border border-dashed border-border/40 text-muted-foreground',
        'hover:text-primary hover:border-primary transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      <Plus className="h-5 w-5" aria-hidden="true" />
      <span className="text-[14px] font-medium text-foreground">New role</span>
      <span className="text-[12.5px] text-muted-foreground">Name it, then pick its areas</span>
    </button>
  );
}

export function RolesList({
  restaurantId,
  onSelectRole,
  onNewRole,
  onOpenPeople,
}: RolesListProps) {
  const { roles, isLoading, error } = useRoles(restaurantId);
  // One members query for the whole grid, bucketed once — not one per card.
  const { data: members } = useRestaurantMembers(restaurantId);

  const rostersByRole = useMemo(
    () => groupMembersByRole(members ?? [], legacyRoleIndex(roles)),
    [members, roles]
  );

  if (isLoading) {
    return (
      <div
        data-testid="roles-list-loading"
        className={ROLE_GRID_CLASS}
      >
        {[1, 2, 3].map((i) => (
          <RoleCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5 flex-shrink-0" />
        <p className="text-sm">Failed to load roles</p>
      </div>
    );
  }

  // No separate "empty" branch: the dashed New-role card below always closes
  // the grid, so a restaurant with zero custom roles (builtins are always
  // present from useRoles) still has an actionable, non-empty grid.
  return (
    <div className={ROLE_GRID_CLASS}>
      {roles.map((role) => (
        <RoleCard
          key={role.id}
          role={role}
          roster={rostersByRole.get(role.id) ?? []}
          onClick={() => onSelectRole(role)}
          onOpenPeople={() => onOpenPeople(role)}
        />
      ))}
      <NewRoleCard onClick={onNewRole} />
    </div>
  );
}
