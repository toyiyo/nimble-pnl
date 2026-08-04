import { useState } from 'react';
import { RolesList } from '@/components/roles/RolesList';
import { RoleEditor, type RoleEditorTab } from '@/components/roles/RoleEditor';
import type { RoleWithGrants } from '@/hooks/useRoles';
import type { Role } from '@/lib/permissions/types';

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
  /** The signed-in user's role in this restaurant. */
  userRole: Role;
}

export function RolesTab({ restaurantId, userRole }: RolesTabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleWithGrants | null>(null);
  // Which door the card was opened by. Lives here rather than in the editor so
  // the editor stays controlled and a second click on the other door of the
  // same card still switches tabs.
  const [activeTab, setActiveTab] = useState<RoleEditorTab>('areas');

  const openRole = (role: RoleWithGrants | null, tab: RoleEditorTab) => {
    setSelectedRole(role);
    setActiveTab(tab);
    setIsEditing(true);
  };

  if (isEditing) {
    return (
      <RoleEditor
        restaurantId={restaurantId}
        role={selectedRole}
        callerRole={userRole}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onBack={() => {
          setIsEditing(false);
          setSelectedRole(null);
          setActiveTab('areas');
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
        {/* Sibling elements rather than the hint nested inside the heading:
            nested, the heading's accessible name became "Your roles Click a
            role to change the areas it can reach." A baseline-aligned flex row
            keeps the design's single-line look. */}
        <div className="flex flex-wrap items-baseline gap-x-2 mb-3">
          <h3 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Your roles
          </h3>
          <p className="text-[12px] text-muted-foreground">
            Click a role to change the areas it can reach.
          </p>
        </div>
        <RolesList
          restaurantId={restaurantId}
          onSelectRole={(role) => openRole(role, 'areas')}
          onOpenPeople={(role) => openRole(role, 'people')}
          onNewRole={() => openRole(null, 'areas')}
        />
      </div>
    </div>
  );
}
