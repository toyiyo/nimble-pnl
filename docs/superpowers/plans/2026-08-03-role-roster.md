# Role Roster (Move 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a role card's member count into a door — face pile → "Who's in this role" roster, "Assign people" at zero — and give the role editor `Areas | People` tabs.

**Architecture:** Frontend only. Membership is resolved client-side through `roles.legacy_role`, which mirrors `role_member_counts`' `COALESCE(role_id, builtin_role_id_for(role))` without copying the mapping. Every write goes through Move 1's `assign_membership_role` RPC via the existing `useAssignRole` and `RolePicker`.

**Tech Stack:** React 18 + TypeScript, React Query, shadcn/ui (Tabs, Dialog, Checkbox, Skeleton), Tailwind semantic tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-role-roster-design.md`

## Global Constraints

- No migration, no pgTAP, no edge function — this PR contains zero SQL.
- Semantic color tokens only. No `bg-white` / `text-black` / raw hex.
- React Query only for server state; `staleTime: 30000`. No `localStorage`.
- Every data surface handles loading / error / empty explicitly.
- Buttons without visible text need `aria-label`. Interactive elements keyboard-reachable.
- Reuse `RolePicker` and `useAssignRole`. Do not create a second assignment path.
- Apple/Notion type scale from CLAUDE.md: `text-[14px] font-medium` body, `text-[13px] text-muted-foreground` secondary, `text-[12px] … uppercase tracking-wider` labels, `border-border/40`, `bg-muted/30`, `rounded-lg` controls / `rounded-xl` cards.
- Card count on a role card is always `role.memberCount` (server), never the roster's length.

---

### Task 1: `roleMembership.ts` — resolution mirroring `role_member_counts`

**Files:**
- Create: `src/lib/permissions/roleMembership.ts`
- Test: `tests/unit/roleMembership.test.ts`

**Interfaces:**
- Consumes: `RestaurantMember` (`src/hooks/useRestaurantMembers.ts`), `RoleWithGrants` (`src/hooks/useRoles.ts`).
- Produces: `legacyRoleIndex(roles): Map<string,string>`, `resolveMembershipRoleId(member, byLegacy): string | null`, `membersInRole(members, roleId, byLegacy): RestaurantMember[]`, `groupMembersByRole(members, byLegacy): Map<string, RestaurantMember[]>`.

- [ ] **Step 1: Write the failing test** — `tests/unit/roleMembership.test.ts` covering: `roleId` wins over the legacy string; null `roleId` resolves through `legacy_role`; `collaborator_custom` + null `roleId` → `null`; unknown role string → `null`; `groupMembersByRole` totals match per-role counts on a mixed fixture.
- [ ] **Step 2: Run `npx vitest run tests/unit/roleMembership.test.ts`** — expect FAIL (module not found).
- [ ] **Step 3: Implement** the four functions. `resolveMembershipRoleId` is exactly `member.roleId ?? byLegacy.get(member.role) ?? null`, with a header comment citing `20260730200000_role_member_counts.sql:38`.
- [ ] **Step 4: Run the test** — expect PASS.
- [ ] **Step 5: Commit.**

---

### Task 2: `canAssignAnyRole` — derive the gate instead of copying it

**Files:**
- Modify: `src/lib/permissions/invitations.ts` (after `canInviteCustomRole`, line 92)
- Modify: `src/lib/permissions/index.ts` (export it)
- Modify: `src/components/TeamMembers.tsx:38-39`
- Test: `tests/unit/invitationMatrix.test.ts`

**Interfaces:**
- Produces: `canAssignAnyRole(inviter: Role): boolean`.

```ts
/**
 * Whether this role can change anyone's role at all — the gate that decides
 * if a role-assignment control is offered. Derived from INVITABLE_ROLES
 * rather than re-listing owner/manager/operations_manager, so it cannot
 * disagree with the matrix the RPC enforces.
 */
export function canAssignAnyRole(inviter: Role): boolean {
  return getInvitableRoles(inviter).length > 0 || canInviteCustomRole(inviter);
}
```

- [ ] **Step 1: Add the failing test** to `tests/unit/invitationMatrix.test.ts`: true for exactly `owner`/`manager`/`operations_manager`, false for every other `Role`.
- [ ] **Step 2: Run it** — expect FAIL.
- [ ] **Step 3: Implement** and export from `index.ts`.
- [ ] **Step 4: Run it** — expect PASS.
- [ ] **Step 5: Swap `TeamMembers.tsx:38-39`** to `const canManageMembers = canAssignAnyRole(userRole);` and delete the literal list + its stale comment.
- [ ] **Step 6: `npm run typecheck`, commit.**

---

### Task 3: hook plumbing — `membershipId` and the missing invalidation

**Files:**
- Modify: `src/hooks/useRestaurantMembers.ts:6-22,38-63`
- Modify: `src/hooks/useAssignRole.ts:57-66`

**Interfaces:**
- Produces: `RestaurantMember.membershipId: string` (the `user_restaurants.id` the RPC takes).

- [ ] **Step 1:** Add `membershipId: string` to `RestaurantMember` with a doc comment saying it is `user_restaurants.id`, the `p_membership_id` argument of `assign_membership_role`.
- [ ] **Step 2:** Change the select at line 40 to `'id, user_id, role, role_id'` and map `membershipId: m.id`.
- [ ] **Step 3:** In `useAssignRole`'s `onSuccess`, add `queryClient.invalidateQueries({ queryKey: ['restaurant-members', restaurantId] })` with a comment: the roster and the assign dialog's candidate list both read this key, and both go stale the moment an assignment lands.
- [ ] **Step 4:** `npm run typecheck` — the three existing consumers (`EmployeeDialog.tsx:65`, `TeamInvitations.tsx:55`, `CollaboratorInvitations.tsx:192`) must still compile; an added field breaks nothing.
- [ ] **Step 5: Commit.**

---

### Task 4: member display helpers + face pile

**Files:**
- Create: `src/components/roles/memberDisplay.ts`
- Create: `src/components/roles/RoleFacePile.tsx`

**Interfaces:**
- Produces: `memberDisplayName(member): string` (full name → email → `'Unnamed member'`), `memberInitials(member): string` (up to 2 chars, falls back to the email's first letter, then `'?'`), `<RoleFacePile members max={3} />`.

- [ ] **Step 1:** Write `memberDisplay.ts`. A comment records why this is not reusing `getInitials` in `src/utils/tipDistribution.ts:169` — those take a name string and have no email fallback, and a member with an unreadable `profiles` row has only an email or nothing.
- [ ] **Step 2:** Write `RoleFacePile.tsx`: `aria-hidden="true"` wrapper, overlapping `-space-x-1.5` circles, `h-[22px] w-[22px] rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-card`. Renders nothing when `members` is empty.
- [ ] **Step 3:** `npm run typecheck`, commit.

---

### Task 5: the role card becomes two doors

**Files:**
- Modify: `src/components/roles/RolesList.tsx:31-37,72-106,127-163`

**Interfaces:**
- Consumes: Task 1 (`legacyRoleIndex`, `groupMembersByRole`), Task 4 (`RoleFacePile`), Task 3 (`useRestaurantMembers`).
- Produces: `RolesListProps` gains `onOpenPeople: (role: RoleWithGrants) => void`.

- [ ] **Step 1:** Restructure `RoleCard`. `<article>` carries the chrome and the flex column — `group flex flex-col gap-3 p-[18px] rounded-xl border border-border/40 bg-card shadow-sm hover:border-border transition-colors`. Hit button: `flex items-start gap-[11px] text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`. `RoleAreaChips` becomes a sibling (fixes the `<div>`-inside-`<button>` validity bug). Footer keeps `mt-auto pt-[11px] border-t border-border/40`.
- [ ] **Step 2:** Footer left slot:
  - `memberCount > 0` → button with `<RoleFacePile members={roster.slice(0,3)} />`, `memberCountLabel(n)`, `<ChevronRight className="h-3 w-3" aria-hidden="true" />`, `aria-label={`${memberCountLabel(n)} in ${role.name}. Manage who's in this role`}`.
  - `memberCount === 0` → button with `<UserPlus className="h-3.5 w-3.5" aria-hidden="true" />` + `Assign people`, `aria-label={`Nobody is in ${role.name} yet. Assign people`}`, `text-foreground font-medium` so it reads as an action.
- [ ] **Step 3:** In `RolesList`, call `useRestaurantMembers(restaurantId)` **once** and build `groupMembersByRole` in a `useMemo`. Pass each card `roster={byRole.get(role.id) ?? []}`. A members error or pending state yields an empty roster — faces vanish, counts and doors keep working.
- [ ] **Step 4:** Verify `RoleCardSkeleton` (lines 50-70) still matches the loaded card's padding, gap, border and footer rule.
- [ ] **Step 5:** `npm run typecheck && npm run lint`, commit.

---

### Task 6: `AssignPeopleDialog`

**Files:**
- Create: `src/components/roles/AssignPeopleDialog.tsx`

**Interfaces:**
- Consumes: `useRestaurantMembers`, `useAssignRole`, `assignRoleErrorMessage`, `CUSTOM_ROLE`, Task 1.
- Produces: `<AssignPeopleDialog role restaurantId callerRole open onOpenChange />`.

- [ ] **Step 1:** Candidate filter — exclude anyone already resolving to `role.id`, self (`useAuth`), `role === 'kiosk'`, and `role === 'owner'` when `callerRole !== 'owner'`. Each exclusion carries a comment naming the RPC rule it mirrors (rules 2, 4, 5a).
- [ ] **Step 2:** Dialog per CLAUDE.md structure — `DialogTitle` `Assign to {name}`, `DialogDescription` *"Everyone you pick leaves the role they're in now."* Rows are `<label>` + shadcn `Checkbox` + name/email. Empty: *"Everyone already holds this role."*
- [ ] **Step 3:** Footer — `Nobody selected` / `1 person selected` / `N people selected`; button `Assign` → `Assign N`, disabled at zero and while submitting.
- [ ] **Step 4:** Submit sequentially in a `for…of` loop (comment: rule 5b takes `FOR UPDATE` on owner rows before counting, so parallel calls contend; and one-at-a-time keeps each failure attributable). Payload: `role.legacy_role ? { role: role.legacy_role, roleId: null } : { role: CUSTOM_ROLE, roleId: role.id }`, mirroring `RolePicker.tsx:133-141`.
- [ ] **Step 5:** On full success — toast + close. On partial failure — keep the dialog open with failed rows still selected, toast naming each failure via `assignRoleErrorMessage`.
- [ ] **Step 6:** `npm run typecheck && npm run lint`, commit.

---

### Task 7: `RoleRoster`

**Files:**
- Create: `src/components/roles/RoleRoster.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 6; `RolePicker`, `useRoles`, `useRestaurantMembers`, `useAuth`.
- Produces: `<RoleRoster role restaurantId callerRole />`.

- [ ] **Step 1:** Header — `Who's in this role` (`text-[15px] font-semibold`) and, when `canAssignAnyRole(callerRole)`, an `Assign people` button.
- [ ] **Step 2:** States — loading: three skeleton rows; error: `role="alert"` with the message, "Assign people" still usable; empty: the spec's verbatim copy (*"Nobody is in {name} yet"* / *"A role does nothing until someone holds it…"*) with `Assign people` as the primary action.
- [ ] **Step 3:** Rows — initials avatar (`aria-hidden`), `memberDisplayName`, email, and `RolePicker` with `disabled={!canAssign || isSelf || member.role === 'kiosk' || (member.role === 'owner' && callerRole !== 'owner')}`. No `onAssigned`: this surface is React Query and Task 3 added the invalidation.
- [ ] **Step 4:** `npm run typecheck && npm run lint`, commit.

---

### Task 8: editor tabs and the wiring above them

**Files:**
- Modify: `src/components/roles/RoleEditor.tsx:105-110,386,530-541`
- Modify: `src/components/roles/RolesTab.tsx:27-33`
- Modify: `src/pages/Team.tsx:172`

**Interfaces:**
- `RoleEditorProps` gains `callerRole: Role`, `activeTab: 'areas' | 'people'`, `onTabChange: (t) => void`.
- `RolesTabProps` gains `userRole: Role`.

- [ ] **Step 1:** In `RoleEditor`, wrap the body below the back link in shadcn `Tabs` (controlled). `TabsList` styled to the Apple underline look. Areas panel = the existing `grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]` block moved verbatim. People panel = `<RoleRoster …/>`.
- [ ] **Step 2:** When `role === null` (`isNewDraft`, line 390) render the Areas content with **no** tablist — an unsaved role has no members and no id.
- [ ] **Step 3:** `RolesTab` gains `userRole` and `initialTab` state; `RolesList` gets both `onSelectRole` (→ `'areas'`) and `onOpenPeople` (→ `'people'`).
- [ ] **Step 4:** `Team.tsx:172` → `<RolesTab restaurantId={…} userRole={selectedRestaurant.role} />`.
- [ ] **Step 5:** `npm run typecheck && npm run lint`, commit.

---

### Task 9: verify

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] Browser pass on `/team` → Roles & areas: card face pile, zero-member "Assign people", both doors, tab switch, roster picker, assign dialog, dark mode.
- [ ] Commit any fixes, open the PR.
