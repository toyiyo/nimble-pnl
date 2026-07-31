import { useState } from 'react';
import { RolesList } from '@/components/roles/RolesList';
import { RoleEditor } from '@/components/roles/RoleEditor';
import type { RoleWithGrants } from '@/hooks/useRoles';

/**
 * RolesTab — the "Roles & areas" tab body on Team Management.
 *
 * The only thing this adds over `RolesList` + `RoleEditor` is the one piece
 * of state neither of them owns: *which* role is open. `RolesList` was built
 * deliberately free of routing knowledge (see its header comment), and
 * `RoleEditor` takes `role: RoleWithGrants | null` plus an `onBack` — so the
 * list/editor swap lives here, in the one place that has both.
 *
 * `null` selection with `isEditing` true is the new-role draft, which is why
 * the open role is modelled as two fields rather than one nullable one: the
 * editor's own "brand-new, unsaved draft" contract is `role === null`, so a
 * single `selected: RoleWithGrants | null` could not distinguish "list" from
 * "blank draft".
 *
 * The page chrome above the grid (eyebrow, heading, the "click a role"
 * instruction) is transcribed from the approved prototype's roles view —
 * docs/design-reference/list.png — rather than invented, and is deliberately
 * hidden while the editor is open, matching the prototype's editor screen.
 */

export interface RolesTabProps {
  restaurantId: string;
}

export function RolesTab({ restaurantId }: RolesTabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleWithGrants | null>(null);

  if (isEditing) {
    return (
      <RoleEditor
        restaurantId={restaurantId}
        role={selectedRole}
        onBack={() => {
          setIsEditing(false);
          setSelectedRole(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] font-semibold text-foreground">Roles &amp; areas</h2>
        <p className="text-[13px] text-muted-foreground mt-1 max-w-2xl">
          A role is a name plus the areas it can reach. Everyone you invite gets one, and it
          decides what they see. Built-in roles cover the usual jobs; make your own when they
          don&apos;t.
        </p>
      </div>

      <div>
        <h3 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Your roles
          <span className="ml-2 normal-case tracking-normal font-normal">
            Click a role to change the areas it can reach.
          </span>
        </h3>
        <RolesList
          restaurantId={restaurantId}
          onSelectRole={(role) => {
            setSelectedRole(role);
            setIsEditing(true);
          }}
          onNewRole={() => {
            setSelectedRole(null);
            setIsEditing(true);
          }}
        />
      </div>
    </div>
  );
}
