import { AREA_DEFINITIONS, grantMap, type AreaKey, type AreaLevel } from '@/lib/permissions/areas';
import { rowLevel } from '@/lib/permissions/preview';
import { cn } from '@/lib/utils';

/**
 * The area chips a role's grants render as — accent-tinted with a `· manage`
 * suffix at manage level, muted at view level, absent when ungranted.
 *
 * Conventions transcribed from the approved prototype's `renderRoles`
 * (docs/design-reference/roles-and-areas.html) and extracted here once the
 * collaborator invite picker needed the same chips as the roles list: the
 * design's argument for chips is that "the difference between two roles is
 * visible without opening either", which only holds if both screens draw them
 * the same way.
 */
export interface RoleAreaChipsProps {
  /** A role's `role_areas` rows, straight off `RoleWithGrants`. */
  areas: ReadonlyArray<{ area_key: AreaKey; level: AreaLevel }>;
  className?: string;
}

export function RoleAreaChips({ areas, className }: RoleAreaChipsProps) {
  const grants = grantMap(areas);
  const grantedRows = AREA_DEFINITIONS.filter((row) => rowLevel(row, grants) !== null);

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {grantedRows.length === 0 ? (
        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
          No areas yet
        </span>
      ) : (
        grantedRows.map((row) => {
          const isManage = rowLevel(row, grants) === 'manage';
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
  );
}
