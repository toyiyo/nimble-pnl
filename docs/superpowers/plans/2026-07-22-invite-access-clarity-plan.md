# Invite / Access Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "grant EasyShiftHQ platform access" and "let an employee use the self-service app" two visibly different actions, so a restaurant owner can no longer provision an accountant as payroll staff by typing an email into a compensation form.

**Architecture:** No table schema changes. One migration repairs an existing RPC before UI traffic is routed to it. A new React Query hook resolves "is this email already a member of this restaurant?" and feeds three surfaces: the two invite dialogs (which block a provably-no-op invite) and the employee dialog (which offers to link to the existing account instead of creating a second one). Role vocabulary gains an explicit `accessGroup` field so the invite dropdown can group platform access separately from employee self-service.

**Tech Stack:** React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui (Radix), React Query, Supabase (Postgres + Deno edge functions), Vitest + Testing Library, pgTAP.

**Design doc:** `docs/superpowers/specs/2026-07-22-invite-access-clarity-design.md`

## Global Constraints

- **Never use direct colors.** Semantic tokens only (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border/40`, `bg-muted/30`). The one sanctioned exception is the documented amber panel: `bg-amber-500/10 border border-amber-500/20`.
- **Typography scale (exact values):** `text-[14px] font-medium text-foreground` for control titles, `text-[13px] text-muted-foreground` for body copy, `text-[12px] font-medium text-muted-foreground uppercase tracking-wider` for form labels, `text-[12px] text-muted-foreground` for Select item descriptions. Introduce no new sizes.
- **No native `disabled` on any control this plan adds or blocks.** Use `aria-disabled="true"` plus a guard inside the handler, so the control stays in the tab order. (Native `disabled` is fine where it already exists for in-flight states.)
- **Radix dialog subtitles are `<DialogDescription>`, never a plain `<p>`.**
- **Server state is React Query only** — never `useEffect` + `useState` + `supabase.from()`, and never `localStorage`. `staleTime: 30000`.
- **Every new async view renders three states:** in-flight, error, and empty/default. Lookup failures in this feature **fail open** (fall back to the unblocked path).
- **Test assertions use accessible roles and labels** (`getByRole`, `getByLabelText`), never text-node fragments.
- **The invite matrix exists in two files** — `src/lib/permissions/invitations.ts` and its verbatim Deno mirror in `supabase/functions/send-team-invitation/index.ts`. Any change touches both in the same commit.
- Run `npm run typecheck` and `npm run lint` before every commit.

---

### Task 1: Remove `kiosk` from the human invite matrix, with a structural mirror test

A kiosk is a shared device credential, not a person with an inbox. It currently appears in the same dropdown as "Accountant".

**Files:**
- Modify: `src/lib/permissions/invitations.ts:13,18`
- Modify: `supabase/functions/send-team-invitation/index.ts:15,20`
- Modify: `tests/unit/invitationMatrix.test.ts:23-33`
- Create: `tests/unit/inviteMatrixMirror.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getInvitableRoles(inviter: Role): Role[]` and `canInviteRole(inviter: Role, target: Role): boolean` keep their exact signatures; only the data changes. After this task no role can invite `'kiosk'`.

- [ ] **Step 1: Write the failing mirror test**

Create `tests/unit/inviteMatrixMirror.test.ts`. This must *structurally compare* both matrices — two independent "does not contain kiosk" assertions would still pass if a future change added a role to one file only, which is the exact drift this guards against. The Deno file cannot be `import`ed into Vitest (it uses `https://deno.land/...` specifiers), so it is read as text; precedent is `tests/unit/stripe-sync-rpc-name.test.ts`.

```ts
/**
 * The invite matrix is duplicated: the TS source of truth in
 * src/lib/permissions/invitations.ts and a verbatim Deno mirror in the
 * send-team-invitation edge function. There is no compiler link between
 * them, so this test is the only thing preventing silent drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Extract `const INVITABLE_ROLES ... = { ... };` and parse it into a plain object. */
function parseMatrix(source: string, file: string): Record<string, string[]> {
  const start = source.indexOf('const INVITABLE_ROLES');
  expect(start, `INVITABLE_ROLES not found in ${file}`).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  expect(end, `unbalanced braces in ${file}`).toBeGreaterThan(open);

  const body = source.slice(open, end + 1);
  const matrix: Record<string, string[]> = {};
  // Matches:  owner: [ 'a', 'b', ],   across newlines
  const entry = /(\w+)\s*:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(body)) !== null) {
    matrix[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((r) => r[1]);
  }
  return matrix;
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const TS_PATH = 'src/lib/permissions/invitations.ts';
const DENO_PATH = 'supabase/functions/send-team-invitation/index.ts';

describe('invite matrix mirror', () => {
  const ts = parseMatrix(read(TS_PATH), TS_PATH);
  const deno = parseMatrix(read(DENO_PATH), DENO_PATH);

  it('the Deno mirror defines every inviter role the TS matrix grants invites to', () => {
    const tsInviters = Object.entries(ts).filter(([, t]) => t.length > 0).map(([r]) => r).sort();
    expect(Object.keys(deno).sort()).toEqual(tsInviters);
  });

  it('every shared inviter row is deep-equal between TS and Deno', () => {
    for (const inviter of Object.keys(deno)) {
      expect(deno[inviter], `row "${inviter}" drifted between TS and Deno`)
        .toEqual(ts[inviter]);
    }
  });

  it('no role can invite kiosk — a kiosk is a device credential, not a person', () => {
    for (const [inviter, targets] of Object.entries(ts)) {
      expect(targets, `${inviter} should not be able to invite kiosk`).not.toContain('kiosk');
    }
    for (const [inviter, targets] of Object.entries(deno)) {
      expect(targets, `${inviter} (Deno) should not be able to invite kiosk`).not.toContain('kiosk');
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- tests/unit/inviteMatrixMirror.test.ts`
Expected: the mirror/deep-equal tests PASS (the files agree today), the kiosk test FAILS with `expected [ 'owner', 'manager', ..., 'kiosk', ... ] not to contain 'kiosk'`.

- [ ] **Step 3: Remove `'kiosk'` from both matrices**

In `src/lib/permissions/invitations.ts`, delete `'kiosk',` from the `owner` array (line 13) and the `manager` array (line 18). Leave the `kiosk: []` *inviter* row — a kiosk still invites nobody. Update the `owner` comment:

```ts
  // owner can invite every internal + collaborator role.
  // 'kiosk' is deliberately absent: it is a shared device credential, not a
  // person with an inbox. Kiosk access is provisioned from device setup.
  owner: [
    'owner', 'manager', 'operations_manager', 'chef', 'staff',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
  ],
```

Make the identical edit to `supabase/functions/send-team-invitation/index.ts:15,20`, including the comment, so the mirror stays verbatim.

- [ ] **Step 4: Invert the stale assertion in the existing matrix test**

`tests/unit/invitationMatrix.test.ts:23-33` currently asserts kiosk *is* invitable "(preserving pre-existing behavior)". Replace that block:

```ts
  it('owner and manager can invite collaborator roles, but never kiosk', () => {
    for (const target of ['collaborator_accountant', 'collaborator_inventory', 'collaborator_chef'] as const) {
      expect(canInviteRole('owner', target)).toBe(true);
      expect(canInviteRole('manager', target)).toBe(true);
    }
    expect(canInviteRole('owner', 'kiosk')).toBe(false);
    expect(canInviteRole('manager', 'kiosk')).toBe(false);
  });

  it('operations_manager cannot invite kiosk or collaborator roles', () => {
    for (const target of ['kiosk', 'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef'] as const) {
      expect(canInviteRole('operations_manager', target)).toBe(false);
    }
  });
```

- [ ] **Step 5: Run both test files**

Run: `npm run test -- tests/unit/inviteMatrixMirror.test.ts tests/unit/invitationMatrix.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/lib/permissions/invitations.ts supabase/functions/send-team-invitation/index.ts tests/unit/inviteMatrixMirror.test.ts tests/unit/invitationMatrix.test.ts
git commit -m "fix(permissions): remove kiosk from the human invite matrix

A kiosk is a shared device credential, not a person with an inbox, but it
sat in the same dropdown as Accountant. Removed from both the TS source of
truth and its verbatim Deno mirror in send-team-invitation.

Adds a structural mirror test that deep-equals the two matrices rather than
checking kiosk's absence in each separately — the shallow version would
still pass if a future change touched only one file."
```

---

### Task 2: Add `accessGroup` to role metadata and rename `staff`

"Staff" reads as a generic bucket any restaurant worker belongs in — including the accountant, in the mind of the person inviting. The Select also needs groups, and they cannot be derived from `category` (which has two values and would file `chef` under management).

**Files:**
- Modify: `src/lib/permissions/types.ts` (add `AccessGroup`, extend `RoleMetadata`)
- Modify: `src/lib/permissions/definitions.ts:259-332` (add `accessGroup` to all 9 entries; change `staff` label/description; add `ACCESS_GROUP_LABELS` and `groupRolesForInvite`)
- Modify: `tests/unit/permissions.test.ts`

**Interfaces:**
- Consumes: `Role` from `./types`.
- Produces:
  - `type AccessGroup = 'platform' | 'employee' | 'collaborator' | 'device'`
  - `RoleMetadata.accessGroup: AccessGroup` (required on all 9 roles)
  - `ACCESS_GROUP_LABELS: Record<AccessGroup, string>`
  - `groupRolesForInvite(roles: Role[]): Array<{ group: AccessGroup; label: string; roles: Role[] }>` — ordered `platform`, `employee`, `collaborator`; omits `device` entirely and omits any group with no roles.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/permissions.test.ts`:

```ts
import {
  ROLE_METADATA,
  ACCESS_GROUP_LABELS,
  groupRolesForInvite,
} from '@/lib/permissions/definitions';
import type { Role } from '@/lib/permissions/types';

describe('access groups', () => {
  it('every role declares an accessGroup', () => {
    for (const role of Object.keys(ROLE_METADATA) as Role[]) {
      expect(ROLE_METADATA[role].accessGroup, `${role} is missing accessGroup`).toBeDefined();
    }
  });

  it('chef is platform access, not employee self-service', () => {
    // chef has view:dashboard/edit:recipes/edit:inventory — it is platform
    // access without being management. Grouping it with staff (or labelling
    // its group "Management") is the category error this feature exists to fix.
    expect(ROLE_METADATA.chef.accessGroup).toBe('platform');
    expect(ROLE_METADATA.staff.accessGroup).toBe('employee');
    expect(ROLE_METADATA.kiosk.accessGroup).toBe('device');
    expect(ROLE_METADATA.collaborator_accountant.accessGroup).toBe('collaborator');
  });

  it('staff is labelled by capability, not by a generic bucket name', () => {
    expect(ROLE_METADATA.staff.label).toBe('Employee (self-service)');
    expect(ROLE_METADATA.staff.description).toBe(
      'Clock in/out, view their own schedule, request time off'
    );
  });

  it('groupRolesForInvite orders platform, then employee, then collaborator', () => {
    const groups = groupRolesForInvite([
      'collaborator_accountant', 'staff', 'manager', 'chef',
    ]);
    expect(groups.map((g) => g.group)).toEqual(['platform', 'employee', 'collaborator']);
    expect(groups[0].roles).toEqual(['manager', 'chef']);
    expect(groups[0].label).toBe(ACCESS_GROUP_LABELS.platform);
  });

  it('groupRolesForInvite omits empty groups and never surfaces device roles', () => {
    const groups = groupRolesForInvite(['staff', 'kiosk']);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe('employee');
    expect(groups[0].roles).toEqual(['staff']);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -- tests/unit/permissions.test.ts`
Expected: FAIL — `groupRolesForInvite is not a function`.

- [ ] **Step 3: Extend the types**

In `src/lib/permissions/types.ts`, after `RoleCategory`:

```ts
/**
 * Which door a role comes through.
 *
 * `category` ('internal' | 'collaborator') describes *tenancy* and cannot
 * express this: 'internal' contains both chef (platform access) and staff
 * (self-service only), which is precisely the distinction users get wrong
 * when inviting people.
 *
 * - platform:     signs into EasyShiftHQ proper
 * - employee:     self-service app only (clock in, own schedule, time off)
 * - collaborator: external specialist, isolated to one surface
 * - device:       shared credential, not a person — never invitable by email
 */
export type AccessGroup = 'platform' | 'employee' | 'collaborator' | 'device';
```

and add the required field to `RoleMetadata`:

```ts
export interface RoleMetadata {
  role: Role;
  label: string;
  description: string;
  category: RoleCategory;
  accessGroup: AccessGroup;
  landingPath: string;
  color: 'default' | 'secondary' | 'outline' | 'destructive';
}
```

- [ ] **Step 4: Populate `accessGroup` and rename `staff`**

In `src/lib/permissions/definitions.ts`, import `AccessGroup` alongside the existing type imports, then add `accessGroup` to each of the 9 `ROLE_METADATA` entries: `owner`, `manager`, `operations_manager`, `chef` → `'platform'`; `staff` → `'employee'`; `kiosk` → `'device'`; the three `collaborator_*` → `'collaborator'`.

Replace the `staff` entry wholesale:

```ts
  staff: {
    role: 'staff',
    label: 'Employee (self-service)',
    description: 'Clock in/out, view their own schedule, request time off',
    category: 'internal',
    accessGroup: 'employee',
    landingPath: '/employee/clock',
    color: 'outline',
  },
```

TypeScript will now error on any `ROLE_METADATA` entry still missing `accessGroup` — that is the intended safety net.

- [ ] **Step 5: Add the grouping helpers**

At the end of `src/lib/permissions/definitions.ts`:

```ts
/**
 * Headings for the invite dropdown. 'device' has no heading because device
 * roles are never offered by email invite (see INVITABLE_ROLES).
 */
export const ACCESS_GROUP_LABELS: Record<AccessGroup, string> = {
  platform: 'Platform access (EasyShiftHQ)',
  employee: 'Employee self-service',
  collaborator: 'External collaborators',
  device: 'Devices',
};

/** Display order for invite groups. 'device' is deliberately absent. */
const INVITE_GROUP_ORDER: AccessGroup[] = ['platform', 'employee', 'collaborator'];

/**
 * Bucket invitable roles into ordered groups for the invite dropdown.
 * Preserves the caller's role order within each group; omits empty groups.
 */
export function groupRolesForInvite(
  roles: Role[]
): Array<{ group: AccessGroup; label: string; roles: Role[] }> {
  return INVITE_GROUP_ORDER
    .map((group) => ({
      group,
      label: ACCESS_GROUP_LABELS[group],
      roles: roles.filter((r) => ROLE_METADATA[r]?.accessGroup === group),
    }))
    .filter((g) => g.roles.length > 0);
}
```

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `npm run test -- tests/unit/permissions.test.ts && npm run typecheck && npm run lint`
Expected: PASS. If typecheck flags other files consuming `RoleMetadata` object literals, add `accessGroup` there too.

- [ ] **Step 7: Run the full suite to catch label-dependent assertions**

Run: `npm run test`
Expected: PASS. Any test asserting the literal string `'Staff'` for the role label must be updated to `'Employee (self-service)'` — that rename is intended.

- [ ] **Step 8: Commit**

```bash
git add src/lib/permissions/types.ts src/lib/permissions/definitions.ts tests/unit/permissions.test.ts
git commit -m "feat(permissions): add accessGroup and rename staff to Employee (self-service)

'Staff' reads as a generic bucket any restaurant worker belongs in — which
is how an accountant ends up provisioned as payroll staff. The new label
names the actual capability boundary.

accessGroup is a new explicit field rather than something derived from
`category`: category has two values and 'internal' contains both chef
(platform access) and staff (self-service), so deriving groups from it
would file Chef under management — the same category error this fixes."
```

---

### Task 3: `useRestaurantMembers` — the shared existing-member lookup

Three surfaces need to answer "is this email already a member of *this* restaurant?". Scoped to the current restaurant deliberately: a global "does this email have an account" check would be an account-enumeration oracle.

**Files:**
- Create: `src/hooks/useRestaurantMembers.ts`
- Create: `tests/unit/useRestaurantMembers.test.ts`

**Interfaces:**
- Consumes: `supabase` from `@/integrations/supabase/client`; `Role` from `@/lib/permissions/types`.
- Produces:
  - `interface RestaurantMember { userId: string; email: string | null; fullName: string | null; role: Role }`
  - `useRestaurantMembers(restaurantId: string | undefined): UseQueryResult<RestaurantMember[]>`
  - `findMemberByEmail(members: RestaurantMember[] | undefined, email: string): RestaurantMember | null` — pure and case-insensitive; returns `null` for blank input or `undefined` members (the fail-open / still-loading case).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/useRestaurantMembers.test.ts`. Test the pure matcher directly — it carries all the logic that can be wrong.

```ts
import { describe, it, expect } from 'vitest';
import { findMemberByEmail, type RestaurantMember } from '@/hooks/useRestaurantMembers';

const members: RestaurantMember[] = [
  { userId: 'u1', email: 'Alexis@Rushbowls.com', fullName: 'Alexis Sanchez', role: 'manager' },
  { userId: 'u2', email: 'book@cpa.example', fullName: 'Dana Books', role: 'collaborator_accountant' },
  { userId: 'u3', email: null, fullName: 'No Email', role: 'staff' },
];

describe('findMemberByEmail', () => {
  it('matches case-insensitively — profiles.email is TEXT, not CITEXT', () => {
    expect(findMemberByEmail(members, 'alexis@rushbowls.com')?.userId).toBe('u1');
    expect(findMemberByEmail(members, 'ALEXIS@RUSHBOWLS.COM')?.userId).toBe('u1');
  });

  it('trims surrounding whitespace', () => {
    expect(findMemberByEmail(members, '  book@cpa.example  ')?.userId).toBe('u2');
  });

  it('returns null for a non-member', () => {
    expect(findMemberByEmail(members, 'stranger@example.com')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(findMemberByEmail(members, '')).toBeNull();
    expect(findMemberByEmail(members, '   ')).toBeNull();
  });

  it('fails open while the roster is loading or errored', () => {
    // undefined members must never read as "match found" — the callers use a
    // null result to mean "proceed normally".
    expect(findMemberByEmail(undefined, 'alexis@rushbowls.com')).toBeNull();
  });

  it('ignores members with no email rather than matching them', () => {
    expect(findMemberByEmail(members, '')).toBeNull();
    expect(members.some((m) => m.email === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -- tests/unit/useRestaurantMembers.test.ts`
Expected: FAIL — cannot resolve `@/hooks/useRestaurantMembers`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useRestaurantMembers.ts`. Note this uses React Query — do **not** copy the `useEffect` + `useState` fetch in `TeamMembers.tsx:70-110`, which predates the convention.

```ts
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { Role } from '@/lib/permissions/types';

export interface RestaurantMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: Role;
}

/**
 * Everyone who already holds a user_restaurants row for this restaurant.
 *
 * Deliberately restaurant-scoped: a global "does this email have an account"
 * lookup would be an account-enumeration oracle. This returns exactly what the
 * caller can already read on the Team page, so it leaks nothing new. RLS on
 * user_restaurants and profiles enforces the same boundary server-side.
 */
export function useRestaurantMembers(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['restaurant-members', restaurantId],
    enabled: !!restaurantId,
    staleTime: 30000,
    queryFn: async (): Promise<RestaurantMember[]> => {
      const { data: memberships, error: membershipError } = await supabase
        .from('user_restaurants')
        .select('user_id, role')
        .eq('restaurant_id', restaurantId);

      if (membershipError) throw membershipError;
      if (!memberships?.length) return [];

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', memberships.map((m) => m.user_id));

      if (profileError) throw profileError;

      const byUserId = new Map(profiles?.map((p) => [p.user_id, p]) ?? []);
      return memberships.map((m) => {
        const profile = byUserId.get(m.user_id);
        return {
          userId: m.user_id,
          email: profile?.email ?? null,
          fullName: profile?.full_name ?? null,
          role: m.role as Role,
        };
      });
    },
  });
}

/**
 * Case-insensitive lookup of an email against the roster.
 *
 * `profiles.email` is plain TEXT (not CITEXT), so a mixed-case address would
 * false-negative on a strict comparison.
 *
 * Returns null when `members` is undefined — the roster is still loading or
 * the query failed. Callers treat null as "proceed normally", which makes the
 * whole feature fail open rather than stranding an owner behind a guard that
 * could not load.
 */
export function findMemberByEmail(
  members: RestaurantMember[] | undefined,
  email: string
): RestaurantMember | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !members) return null;
  return members.find((m) => m.email?.trim().toLowerCase() === normalized) ?? null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/unit/useRestaurantMembers.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/hooks/useRestaurantMembers.ts tests/unit/useRestaurantMembers.test.ts
git commit -m "feat(team): add restaurant-scoped member lookup hook

Shared by the two invite dialogs and EmployeeDialog to detect an email that
already belongs to a team member. Restaurant-scoped on purpose — a global
account check would be an enumeration oracle.

findMemberByEmail is case-insensitive (profiles.email is TEXT, not CITEXT)
and returns null when the roster is undefined, so callers fail open while
loading or on error."
```

---

### Task 4: Group the `TeamInvitations` role dropdown

**Files:**
- Modify: `src/components/TeamInvitations.tsx:278-292`
- Modify: `tests/unit/TeamInvitations.test.tsx`

**Interfaces:**
- Consumes: `groupRolesForInvite`, `ACCESS_GROUP_LABELS`, `ROLE_METADATA` (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/TeamInvitations.test.tsx` (follow the existing supabase-mock and render setup at the top of that file; open the dialog with `userEvent` the way the existing role-dropdown tests do):

```ts
  it('groups roles by access type so platform access reads differently from self-service', async () => {
    // ...render as an owner and open the invite dialog + role select...
    expect(await screen.findByText('Platform access (EasyShiftHQ)')).toBeInTheDocument();
    expect(screen.getByText('Employee self-service')).toBeInTheDocument();
    expect(screen.getByText('External collaborators')).toBeInTheDocument();
  });

  it('shows what each role can actually do next to its name', async () => {
    // ...open the role select...
    expect(
      await screen.findByText('Clock in/out, view their own schedule, request time off')
    ).toBeInTheDocument();
  });

  it('shows only the role label in the closed trigger, not its description', async () => {
    // Regression guard: ui/select.tsx wraps a SelectItem's whole children in
    // ItemText, so a childless <SelectValue /> portals label AND description
    // into the line-clamped trigger.
    // ...open the select, choose "Employee (self-service)", close it...
    const trigger = screen.getByRole('combobox', { name: /role/i });
    expect(trigger).toHaveTextContent('Employee (self-service)');
    expect(trigger).not.toHaveTextContent('Clock in/out');
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -- tests/unit/TeamInvitations.test.tsx`
Expected: FAIL — group headings not found.

- [ ] **Step 3: Add `SelectGroup`/`SelectLabel` to the imports**

In `src/components/TeamInvitations.tsx`, extend the existing `@/components/ui/select` import with `SelectGroup` and `SelectLabel`, and extend the `@/lib/permissions/definitions` import with `groupRolesForInvite`.

- [ ] **Step 4: Rewrite the Select body**

Replace lines 282-292 (the `<Select>` element):

```tsx
                    <Select
                      value={inviteForm.role}
                      onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
                    >
                      <SelectTrigger id="role" className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                        {/*
                          SelectValue MUST have children. ui/select.tsx wraps a
                          SelectItem's entire children in ItemText, and a childless
                          SelectValue makes Radix portal that whole subtree into the
                          trigger — which would render the label and the description
                          mashed into one line-clamped row.
                        */}
                        <SelectValue>
                          {ROLE_METADATA[inviteForm.role as Role]?.label ?? 'Select a role'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {roleGroups.map(({ group, label, roles }) => (
                          <SelectGroup key={group}>
                            {showGroupLabels && (
                              <SelectLabel className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                                {label}
                              </SelectLabel>
                            )}
                            {roles.map((r) => (
                              <SelectItem key={r} value={r}>
                                <span className="text-[14px] text-foreground">{ROLE_METADATA[r].label}</span>
                                <span className="block text-[12px] text-muted-foreground">
                                  {ROLE_METADATA[r].description}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
```

Immediately above the `return` (next to the existing `invitableRoles` derivation), add:

```tsx
  const roleGroups = groupRolesForInvite(invitableRoles);
  // A lone heading over a one-item list is noise — operations_manager can
  // invite only 'staff'.
  const showGroupLabels = roleGroups.length > 1;
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- tests/unit/TeamInvitations.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/components/TeamInvitations.tsx tests/unit/TeamInvitations.test.tsx
git commit -m "feat(team): group the invite role dropdown by access type

Platform access, employee self-service and external collaborators were one
flat list of nine labels, which is where the accountant-as-staff mistake
starts. Each option now carries its capability description.

SelectValue gets explicit children: ui/select.tsx wraps a SelectItem's whole
children in ItemText, so two-line items with a childless SelectValue would
portal label + description into the line-clamped trigger."
```

---

### Task 5: Block a provably-no-op invite in `TeamInvitations`

`accept-invitation/index.ts:109-131` skips the `user_restaurants` insert when the invitee is already a member, so re-inviting an existing member with a corrected role silently changes nothing.

**Files:**
- Modify: `src/components/TeamInvitations.tsx`
- Modify: `tests/unit/TeamInvitations.test.tsx`

**Interfaces:**
- Consumes: `useRestaurantMembers`, `findMemberByEmail` (Task 3); `ROLE_METADATA` (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

```ts
  it('blocks and explains when the email already belongs to a team member', async () => {
    // ...mock useRestaurantMembers to return a manager with email alexis@rushbowls.com...
    // ...open the dialog, type that email...
    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/already on your team as Manager/i);

    const send = screen.getByRole('button', { name: /send invitation/i });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    // Must stay focusable — a natively disabled button leaves the tab order
    // and announces nothing, stranding keyboard users.
    expect(send).not.toHaveAttribute('disabled');

    await userEvent.click(send);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('describes the blocked button with the explanation panel', async () => {
    // ...same setup...
    const send = screen.getByRole('button', { name: /send invitation/i });
    const panel = screen.getByRole('status');
    expect(send.getAttribute('aria-describedby')).toBe(panel.id);
  });

  it('sends normally for an email that is not already a member', async () => {
    // ...roster returns someone else; type a fresh address, click send...
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'send-team-invitation',
      expect.objectContaining({ body: expect.objectContaining({ email: 'new@example.com' }) })
    );
  });

  it('fails open when the roster lookup errors', async () => {
    // ...mock useRestaurantMembers to return { data: undefined, isError: true }...
    const send = screen.getByRole('button', { name: /send invitation/i });
    expect(send).not.toHaveAttribute('aria-disabled', 'true');
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -- tests/unit/TeamInvitations.test.tsx`
Expected: FAIL — no element with role `status`.

- [ ] **Step 3: Wire the lookup**

Add imports for `useRestaurantMembers` / `findMemberByEmail`, then next to the other derivations:

```tsx
  const { data: members } = useRestaurantMembers(restaurantId);
  // null while loading, on error, or for a non-member — all "proceed normally".
  const existingMember = findMemberByEmail(members, inviteForm.email);
  const blockedPanelId = 'invite-existing-member-warning';
```

- [ ] **Step 4: Render the panel**

Directly after the existing `pendingConflict` panel (`TeamInvitations.tsx:295-302`):

```tsx
                  {existingMember && (
                    <div
                      id={blockedPanelId}
                      role="status"
                      aria-live="polite"
                      className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[13px]"
                    >
                      <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <p className="text-foreground">
                        <strong>{existingMember.fullName ?? existingMember.email}</strong> is already
                        on your team as {ROLE_METADATA[existingMember.role]?.label ?? existingMember.role}.
                        Sending another invitation will not change their access — accepting it does
                        nothing. To change what they can see, use the role dropdown in{' '}
                        <strong>Team Members</strong>.
                      </p>
                    </div>
                  )}
```

Import `AlertTriangle` from `lucide-react` if not already imported.

- [ ] **Step 5: Guard the Send button without removing it from the tab order**

Replace the Send `<Button>` (line ~309):

```tsx
                  <Button
                    onClick={sendInvitation}
                    disabled={sending}
                    aria-disabled={existingMember ? true : undefined}
                    aria-describedby={existingMember ? blockedPanelId : undefined}
                    className="h-9 px-4 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                  >
                    {sending ? 'Sending...' : pendingConflict ? 'Yes, resend anyway' : 'Send Invitation'}
                  </Button>
```

And at the very top of `sendInvitation`, before any await:

```tsx
    // aria-disabled keeps the button focusable, so the handler owns the block.
    if (findMemberByEmail(members, inviteForm.email)) return;
```

- [ ] **Step 6: Run tests**

Run: `npm run test -- tests/unit/TeamInvitations.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/components/TeamInvitations.tsx tests/unit/TeamInvitations.test.tsx
git commit -m "fix(team): block inviting someone who is already a member

accept-invitation skips the user_restaurants insert when the invitee is
already a member, so re-inviting them with a corrected role sends an email,
reports success, and changes nothing. Blocking is more honest than offering
a 'send anyway' for an action that provably does nothing; the panel points
at Team Members, which actually writes the role.

Uses aria-disabled + a handler guard rather than native disabled so the
button stays focusable, with the panel wired via aria-describedby and
announced via role=status."
```

---

### Task 6: Same guard on `CollaboratorInvitations`

This is the door the RushBowls owner should have used, and the one they will reach for to *correct* the mistake. It has no existing-member check at all today.

**Files:**
- Modify: `src/components/CollaboratorInvitations.tsx:50-65,200-212`
- Create: `tests/unit/CollaboratorInvitations.test.tsx`

**Interfaces:**
- Consumes: `useRestaurantMembers`, `findMemberByEmail` (Task 3); `ROLE_METADATA` (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/CollaboratorInvitations.test.tsx`, mirroring the supabase/React Query mock setup at the top of `tests/unit/TeamInvitations.test.tsx`. Mock `@/hooks/useCollaborators` so `useSendCollaboratorInvitation` exposes a spy `mutate`.

```ts
  it('blocks a collaborator invite for an email that is already a member', async () => {
    // ...roster returns { email: 'book@cpa.example', role: 'staff', fullName: 'Dana Books' }...
    // ...pick the Accountant preset, type book@cpa.example...
    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/already on your team/i);

    const send = screen.getByRole('button', { name: /send invite/i });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(send);
    expect(mockSendMutate).not.toHaveBeenCalled();
  });

  it('sends normally for a non-member email', async () => {
    // ...type stranger@example.com, click send...
    expect(mockSendMutate).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -- tests/unit/CollaboratorInvitations.test.tsx`
Expected: FAIL — no `status` role.

- [ ] **Step 3: Wire the lookup and guard**

Add the same imports and derivations used in Task 5 (`members`, `existingMember`, `blockedPanelId = 'collab-existing-member-warning'`). At the top of `handleSendInvitation`, before the existing `!email || !selectedRole` check:

```tsx
    if (findMemberByEmail(members, email)) return;
```

- [ ] **Step 4: Render the panel and guard the button**

Inside `renderEmailInput()`, directly above the email/button row (`CollaboratorInvitations.tsx:200`), add the same amber `role="status"` panel from Task 5 Step 4 (with `blockedPanelId` and copy adjusted to end with: *"To change what they can see, use the role dropdown in **Team Members**."*).

Then extend the Send button (line 206-211):

```tsx
            <Button
              onClick={handleSendInvitation}
              disabled={sendInvitationMutation.isPending || !email}
              aria-disabled={existingMember ? true : undefined}
              aria-describedby={existingMember ? blockedPanelId : undefined}
              className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
            >
              {sendInvitationMutation.isPending ? 'Sending...' : 'Send Invite'}
            </Button>
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- tests/unit/CollaboratorInvitations.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/components/CollaboratorInvitations.tsx tests/unit/CollaboratorInvitations.test.tsx
git commit -m "fix(team): guard the collaborator invite against existing members

The collaborator door had no existing-member check at all. It is both the
door the owner should have used originally and the one they reach for to fix
a bad invite — and re-inviting an existing member hits the same silent
accept-invitation no-op. Same guard, same aria treatment as TeamInvitations."
```

---

### Task 7: Repair `link_employee_to_user` before routing UI traffic to it

Task 9 makes this RPC a real user-facing path for the first time. Three defects make it unfit as-is.

**Files:**
- Create: `supabase/migrations/20260722120000_link_employee_to_user_hardening.sql`
- Create: `supabase/tests/link_employee_to_user.sql`

**Interfaces:**
- Consumes: the existing function from `20251115100200_link_employee_to_user_helper.sql`.
- Produces: `link_employee_to_user(p_employee_id UUID, p_user_id UUID)` keeps its exact signature and `RETURNS TABLE (success BOOLEAN, message TEXT, employee_name TEXT, employee_email TEXT)` shape. Behaviour changes: `operations_manager` is now authorized; unauthorized callers get a single non-committal message.

- [ ] **Step 1: Confirm the migration version is unique**

Run: `ls supabase/migrations/ | grep 20260722`
Expected: no output. (A duplicate migration version has bitten this repo before — see commit 0a9c62d7.) If anything prints, bump to `20260722120100`.

- [ ] **Step 2: Write the failing pgTAP test**

Create `supabase/tests/link_employee_to_user.sql`. Follow the fixture style of the existing files in `supabase/tests/`.

```sql
BEGIN;
SELECT plan(6);

-- Fixtures: one restaurant, one unlinked employee, and callers at each role.
-- (Create auth.users + profiles + user_restaurants rows for owner, manager,
--  operations_manager, chef, and an outsider in another restaurant.)

-- 1. operations_manager may link — they hold manage:employees
SELECT ok(
  (SELECT success FROM link_employee_to_user(:'employee_id', :'target_user')),
  'operations_manager can link an employee to an existing account'
);

-- 2. chef may not
SELECT ok(
  NOT (SELECT success FROM link_employee_to_user(:'employee2_id', :'target_user')),
  'chef cannot link'
);

-- 3. a caller from another restaurant may not
SELECT ok(
  NOT (SELECT success FROM link_employee_to_user(:'employee2_id', :'target_user')),
  'cross-restaurant caller cannot link'
);

-- 4. unauthorized callers get one non-committal message for both
--    "no such employee" and "exists but not yours"
SELECT is(
  (SELECT message FROM link_employee_to_user(gen_random_uuid(), :'target_user')),
  (SELECT message FROM link_employee_to_user(:'employee2_id', :'target_user')),
  'existence is not distinguishable from lack of authorization'
);

-- 5. relinking an already-linked employee reports the already-linked state
SELECT matches(
  (SELECT message FROM link_employee_to_user(:'employee_id', :'target_user')),
  'already linked',
  'second call reports already-linked rather than a generic failure'
);

-- 6. owner may still link (no regression)
SELECT ok(
  (SELECT success FROM link_employee_to_user(:'employee3_id', :'target_user')),
  'owner can still link'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm run db:reset && npm run test:db`
Expected: FAIL on the operations_manager and existence-leak assertions.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260722120000_link_employee_to_user_hardening.sql`. Replace the function whole (`CREATE OR REPLACE`), keeping the signature and return shape, with three changes: `operations_manager` added to the allowlist; the authorization check moved ahead of the target-user lookup with a single non-committal message for both employee-miss and not-authorized; and the inaccurate grant comment corrected.

```sql
-- Hardening for link_employee_to_user ahead of routing real UI traffic to it
-- from EmployeeDialog's "link to existing account" flow.
--
-- 1. operations_manager holds manage:employees (see ROLE_CAPABILITIES) and can
--    invite staff, but was absent from this allowlist — clicking "link" would
--    fail and leave an employees row with user_id = NULL beside an existing
--    membership, i.e. the double-provisioning this feature exists to prevent.
--    Precedent for widening a gate to this role: 20260702170000.
-- 2. The employee and auth.users lookups ran BEFORE the caller was authorized,
--    with distinct "Employee not found" / "User not found" messages, letting
--    any authenticated user distinguish "does not exist" from "not yours".
-- 3. The old comment claimed the PUBLIC grant had been removed. No REVOKE was
--    ever issued; Postgres grants EXECUTE to PUBLIC by default and Supabase
--    grants it to anon/authenticated. That is what makes the client rpc() call
--    work — but the in-function check is the ONLY boundary. Comment corrected
--    so nobody reads a protection layer that is not there.

CREATE OR REPLACE FUNCTION link_employee_to_user(
  p_employee_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  employee_name TEXT,
  employee_email TEXT
) AS $$
DECLARE
  v_employee RECORD;
  v_user RECORD;
  v_caller_id UUID;
  v_is_authorized BOOLEAN;
  v_rows_updated INTEGER;
  -- One message for "no such employee" and "exists but not yours", so the
  -- function cannot be used to probe for employee ids.
  c_denied CONSTANT TEXT := 'Employee not found, or you are not authorized to manage it';
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Unauthorized: Authentication required'::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_employee FROM public.employees WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, c_denied, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Authorize BEFORE revealing anything further, including whether p_user_id exists.
  SELECT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = v_caller_id
      AND restaurant_id = v_employee.restaurant_id
      AND role IN ('owner', 'manager', 'operations_manager')
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RETURN QUERY SELECT FALSE, c_denied, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT email INTO v_user FROM auth.users WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'User not found'::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_employee.user_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE,
      format('Employee already linked to user %s', v_employee.user_id)::TEXT,
      v_employee.name::TEXT,
      v_employee.email::TEXT;
    RETURN;
  END IF;

  UPDATE public.employees
  SET user_id = p_user_id, updated_at = NOW()
  WHERE id = p_employee_id
    AND user_id IS NULL; -- guard against a concurrent link

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RETURN QUERY SELECT FALSE,
      'Failed to link employee: Already linked by another process'::TEXT,
      v_employee.name::TEXT,
      v_employee.email::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE,
    format('Successfully linked %s to user %s', v_employee.name, v_user.email)::TEXT,
    v_employee.name::TEXT,
    v_employee.email::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

COMMENT ON FUNCTION link_employee_to_user IS
  'Links an employee record to an existing user account. Callable by owner, '
  'manager, and operations_manager of the employee''s restaurant. EXECUTE is '
  'granted to authenticated by Supabase default; the in-function authorization '
  'check is the only access boundary.';
```

- [ ] **Step 5: Run the database tests**

Run: `npm run db:reset && npm run test:db`
Expected: PASS, 6 assertions.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260722120000_link_employee_to_user_hardening.sql supabase/tests/link_employee_to_user.sql
git commit -m "fix(db): harden link_employee_to_user before UI traffic reaches it

- operations_manager holds manage:employees but was absent from the
  allowlist; clicking 'link' would fail and orphan an employees row
- the employee and auth.users lookups ran before the authorization check
  with distinct messages, leaking existence to any authenticated user
- corrected a comment claiming a REVOKE that was never issued"
```

---

### Task 8: `EmployeeDialog` — explicit opt-in instead of a load-bearing Email field

Today a non-empty email on create silently fires `send-team-invitation` with a hardcoded `role: 'staff'`. This is the mechanism of the original failure.

**Files:**
- Modify: `src/components/EmployeeDialog.tsx:54-56,196,358-388,1015-1041`
- Create: `tests/unit/EmployeeDialog.appAccess.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports. New local state `grantAppAccess: boolean`, default `false`, reset in `resetForm`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/EmployeeDialog.appAccess.test.tsx`. Mirror the mock setup in the existing `tests/unit/EmployeeDialog.availabilitySection.test.tsx`.

```ts
  it('does not invite anyone when the access switch is off, even with an email', async () => {
    // ...open in create mode, fill name + email, save...
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith(
      'send-team-invitation',
      expect.anything()
    );
  });

  it('invites only when the switch is deliberately turned on', async () => {
    // ...fill name + email, toggle the switch, save...
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'send-team-invitation',
      expect.objectContaining({ body: expect.objectContaining({ role: 'staff' }) })
    );
  });

  it('defaults the access switch to off', async () => {
    const toggle = await screen.findByRole('switch', { name: /invite to the employee app/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the switch focusable and explained while the email is empty', async () => {
    const toggle = await screen.findByRole('switch', { name: /invite to the employee app/i });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).not.toHaveAttribute('disabled');   // must stay in the tab order
    expect(toggle).toHaveAccessibleDescription(/add an email address/i);

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');  // guard holds
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -- tests/unit/EmployeeDialog.appAccess.test.tsx`
Expected: FAIL — no switch named "Invite to the employee app".

- [ ] **Step 3: Add state**

After the `email` state (`EmployeeDialog.tsx:55`):

```tsx
  // Access is opt-in and separate from the email field. Typing an email used to
  // silently provision a staff login — that unlabelled side effect is the bug
  // this switch exists to remove.
  const [grantAppAccess, setGrantAppAccess] = useState(false);
```

Add `setGrantAppAccess(false);` to `resetForm` (near line 196).

- [ ] **Step 4: Gate the invite**

At `EmployeeDialog.tsx:358`, change the condition:

```tsx
      if (grantAppAccess && email?.trim()) {
```

Leave the body — including the existing `.then` / `.catch` toasts — unchanged.

- [ ] **Step 5: Render the section immediately after the Email/Phone grid**

Insert directly after the grid closes (`EmployeeDialog.tsx:1041`), wrapped so it only renders when creating:

```tsx
                {isCreateMode && (
                  <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/30 p-3">
                    <div className="space-y-0.5 pr-4">
                      <Label htmlFor="grantAppAccess" className="text-[14px] font-medium text-foreground cursor-pointer">
                        Invite to the employee app
                      </Label>
                      <p id="grantAppAccessHint" className="text-[13px] text-muted-foreground">
                        {email.trim()
                          ? 'Lets them clock in, view their own schedule, and request time off from their phone. They will not see sales, costs, payroll, or other employees.'
                          : 'Add an email address to enable.'}
                      </p>
                    </div>
                    <Switch
                      id="grantAppAccess"
                      checked={grantAppAccess}
                      // aria-disabled rather than disabled: a disabled Switch leaves
                      // the tab order, so a keyboard user never hears why it is off.
                      aria-disabled={!email.trim() ? true : undefined}
                      aria-describedby="grantAppAccessHint"
                      onCheckedChange={(checked) => {
                        if (!email.trim()) return;
                        setGrantAppAccess(checked);
                      }}
                      className="data-[state=checked]:bg-foreground aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                      aria-label="Invite to the employee app"
                    />
                  </div>
                )}
```

If the component has no `isCreateMode` variable in scope at that point, use the same expression the create path already uses (`!employee`).

- [ ] **Step 6: Run tests**

Run: `npm run test -- tests/unit/EmployeeDialog.appAccess.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/components/EmployeeDialog.tsx tests/unit/EmployeeDialog.appAccess.test.tsx
git commit -m "fix(employees): make app access an explicit opt-in

Typing into the Email field — a bare label beside Phone in a compensation
form — silently fired send-team-invitation with a hardcoded role:'staff'.
That is how an accountant ended up provisioned as payroll staff.

Access is now a default-off switch placed immediately after the Email field
so the coupling is visible, using aria-disabled rather than disabled so it
stays focusable and explains itself while the email is blank."
```

---

### Task 9: `EmployeeDialog` — offer to link an existing account

The manager who is also on payroll, and the accountant who was almost double-provisioned, are the same case: the email already belongs to a member.

**Files:**
- Modify: `src/components/EmployeeDialog.tsx`
- Modify: `tests/unit/EmployeeDialog.appAccess.test.tsx`

**Interfaces:**
- Consumes: `useRestaurantMembers`, `findMemberByEmail` (Task 3); `link_employee_to_user` (Task 7); `ROLE_METADATA` (Task 2).
- Produces: no new exports. New local state `linkToExisting: boolean`, default `false`, reset in `resetForm`.

- [ ] **Step 1: Write the failing tests**

```ts
  it('offers linking instead of inviting when the email is already a member', async () => {
    // ...roster returns Alexis (manager, alexis@rushbowls.com); type that email...
    expect(await screen.findByRole('switch', { name: /link this employee record/i })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /invite to the employee app/i })).not.toBeInTheDocument();
  });

  it('links rather than inviting when the link switch is on', async () => {
    // ...toggle the link switch, save...
    expect(supabase.rpc).toHaveBeenCalledWith('link_employee_to_user', {
      p_employee_id: expect.any(String),
      p_user_id: 'u1',
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith('send-team-invitation', expect.anything());
  });

  it('still creates the employee when the link switch is left off', async () => {
    // Declining to link is a first-class outcome — no second account, no invite.
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith('send-team-invitation', expect.anything());
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Employee created' }));
  });

  it('treats "already linked" as a success, not a failure toast', async () => {
    // A double-click or retry must not report failure for work that landed.
    // ...mock rpc -> { data: [{ success: false, message: 'Employee already linked to user u1' }] }...
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('surfaces a real link failure without losing the employee record', async () => {
    // ...mock rpc -> { data: [{ success: false, message: 'Employee not found, or you are not authorized to manage it' }] }...
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test -- tests/unit/EmployeeDialog.appAccess.test.tsx`
Expected: FAIL — no "link this employee record" switch.

- [ ] **Step 3: Add state and the lookup**

```tsx
  const [linkToExisting, setLinkToExisting] = useState(false);
  const { data: restaurantMembers } = useRestaurantMembers(restaurantId);
  // null while loading, on error, and for non-members — all mean "behave normally".
  const existingMember = findMemberByEmail(restaurantMembers, email);
```

Add `setLinkToExisting(false);` to `resetForm`.

- [ ] **Step 4: Swap the section body when a member matches**

Wrap the Task 8 block in `{isCreateMode && (existingMember ? <linkPanel/> : <invitePanel/>)}`, where the link panel is:

```tsx
                    <div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-2">
                      <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5">
                        <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <p className="text-[13px] text-foreground">
                          <strong>{existingMember.fullName ?? existingMember.email}</strong> already has an
                          EasyShiftHQ account ({ROLE_METADATA[existingMember.role]?.label ?? existingMember.role}).
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5 pr-4">
                          <Label htmlFor="linkToExisting" className="text-[14px] font-medium text-foreground cursor-pointer">
                            Link this employee record to their account
                          </Label>
                          <p id="linkToExistingHint" className="text-[13px] text-muted-foreground">
                            They keep their current access and can also clock in. No second account is
                            created. Not them? Leave this off — the employee record is still created,
                            without linking or inviting.
                          </p>
                        </div>
                        <Switch
                          id="linkToExisting"
                          checked={linkToExisting}
                          onCheckedChange={setLinkToExisting}
                          aria-describedby="linkToExistingHint"
                          className="data-[state=checked]:bg-foreground"
                          aria-label="Link this employee record to their existing account"
                        />
                      </div>
                    </div>
```

- [ ] **Step 5: Branch the save path**

Replace the Task 8 gate at `EmployeeDialog.tsx:358` with:

```tsx
      if (existingMember) {
        if (linkToExisting) {
          const { data: linkRows, error: linkError } = await supabase.rpc('link_employee_to_user', {
            p_employee_id: newEmployee.id,
            p_user_id: existingMember.userId,
          });
          const result = Array.isArray(linkRows) ? linkRows[0] : linkRows;
          // 'already linked' means a retry or double-submit landed the work
          // already — reporting failure for it would be a lie.
          const alreadyLinked = !result?.success && /already linked/i.test(result?.message ?? '');

          if (linkError || (!result?.success && !alreadyLinked)) {
            toast({
              title: 'Employee created, but not linked',
              description: result?.message ?? 'Could not link this employee to the existing account.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Employee created and linked',
              description: `${name} can now clock in with their existing account.`,
            });
          }
        } else {
          toast({ title: 'Employee created', description: `${name} was added.` });
        }
      } else if (grantAppAccess && email?.trim()) {
        // ...existing send-team-invitation block, unchanged...
      }
```

- [ ] **Step 6: Run tests**

Run: `npm run test -- tests/unit/EmployeeDialog.appAccess.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/components/EmployeeDialog.tsx tests/unit/EmployeeDialog.appAccess.test.tsx
git commit -m "feat(employees): link to an existing account instead of double-provisioning

When the entered email already belongs to a team member, offer to link the
employee record to that account rather than inviting a second one. This is
the manager-who-must-also-punch-in case that drove the two-account workaround.

Linking is an explicit default-off switch, not an automatic consequence of a
matching email — household addresses collide and owners mistype. Declining
still creates the employee record. 'Already linked' is treated as success so
a retry cannot produce a false-failure toast."
```

---

### Task 10: Verify the longer role badge at mobile width

`ROLE_METADATA.staff.label` grew from "Staff" to "Employee (self-service)" and renders as a `Badge` in a flex row whose sides have no `min-w-0`.

**Files:**
- Modify: `src/components/TeamMembers.tsx:200-218` (only if the check fails)

- [ ] **Step 1: Inspect the row at 375px**

Start the dev server via `preview_start`, open the Team page, `resize_window` to the `mobile` preset (375×812), and read the member row.

- [ ] **Step 2: Fix only if it overflows**

If the name column or badge wraps or forces horizontal overflow, add `min-w-0` to the row's left child and `truncate` to the name element (`TeamMembers.tsx:211-213`), plus `shrink-0` on the badge/dropdown container. Do not restructure the row otherwise.

- [ ] **Step 3: Confirm and commit**

Re-screenshot at 375px to confirm no horizontal overflow. If no change was needed, record that in `progress.md` and skip the commit.

```bash
git add src/components/TeamMembers.tsx
git commit -m "fix(team): keep the member row from overflowing with the longer role label"
```

---

### Task 11: Full-suite verification

- [ ] **Step 1: Run everything**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS. Baseline before this work was 7133 passing / 0 failing; the count should only have grown.

- [ ] **Step 2: Confirm no stray direct colors or native `disabled` regressions**

Run: `git diff origin/main --unified=0 -- src/ | grep -nE '^\+' | grep -E 'bg-white|text-black|bg-gray-|text-gray-'`
Expected: no output (the amber panel classes are the sanctioned exception and will not match).

- [ ] **Step 3: Confirm both invite matrices still agree**

Run: `npm run test -- tests/unit/inviteMatrixMirror.test.ts`
Expected: PASS.
