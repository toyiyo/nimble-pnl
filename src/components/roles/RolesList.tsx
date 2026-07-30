import { AlertCircle, LayoutGrid, Plus, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRoles, type RoleWithGrants } from '@/hooks/useRoles';
import { AREA_DEFINITIONS, type AreaKey, type AreaLevel } from '@/lib/permissions/areas';
import { rowLevel } from '@/lib/permissions/preview';
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
 * navigating to the (read-only, for a builtin) role editor, or to a blank
 * draft — belongs to the caller via `onSelectRole`/`onNewRole`; that keeps
 * this component usable from wherever the "Roles & areas" tab ends up living
 * (a later task), without this file needing to know about routing.
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
}

/** The grant level per area_key for one role, keyed the way `expandAreas`/`rowLevel` expect. */
function grantMap(role: RoleWithGrants): Partial<Record<AreaKey, AreaLevel>> {
  const map: Partial<Record<AreaKey, AreaLevel>> = {};
  for (const grant of role.role_areas) {
    map[grant.area_key] = grant.level;
  }
  return map;
}

function memberCountLabel(count: number): string {
  return count === 1 ? '1 person' : `${count} people`;
}

function RoleCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-[18px] rounded-xl border border-border/40 bg-background">
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

function RoleCard({ role, onClick }: { role: RoleWithGrants; onClick: () => void }) {
  const grants = grantMap(role);
  const grantedRows = AREA_DEFINITIONS.filter((row) => rowLevel(row, grants) !== null);
  const Icon = role.builtin ? LayoutGrid : Users;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-3 p-[18px] text-left rounded-xl border border-border/40 bg-background',
        'hover:border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      <div className="flex items-start gap-[11px]">
        <span className="h-[34px] w-[34px] flex-shrink-0 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-foreground">{role.name}</span>
          {role.description && (
            <span className="block text-[13px] text-muted-foreground mt-0.5">{role.description}</span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {grantedRows.length === 0 ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">No areas yet</span>
        ) : (
          grantedRows.map((row) => {
            const level = rowLevel(row, grants);
            const isManage = level === 'manage';
            return (
              <span
                key={row.key}
                className={cn(
                  'text-[11px] px-1.5 py-0.5 rounded-md whitespace-nowrap',
                  isManage ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}
              >
                {row.label}
                {isManage && ' · manage'}
              </span>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between mt-auto pt-[11px] border-t border-border/40 text-[12px] text-muted-foreground">
        <span>{memberCountLabel(role.memberCount)}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-border/40 font-mono uppercase tracking-wider text-muted-foreground">
          {role.builtin ? 'Built-in' : 'Custom'}
        </span>
      </div>
    </button>
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

export function RolesList({ restaurantId, onSelectRole, onNewRole }: RolesListProps) {
  const { roles, isLoading, error } = useRoles(restaurantId);

  if (isLoading) {
    return (
      <div
        data-testid="roles-list-loading"
        className="grid gap-3.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(292px, 1fr))' }}
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
    <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(292px, 1fr))' }}>
      {roles.map((role) => (
        <RoleCard key={role.id} role={role} onClick={() => onSelectRole(role)} />
      ))}
      <NewRoleCard onClick={onNewRole} />
    </div>
  );
}
