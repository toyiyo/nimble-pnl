# Move 2 — the member count becomes a door

**Date:** 2026-08-03
**Branch:** `feature/role-roster`
**Builds on:** `docs/superpowers/specs/2026-08-02-role-assignment-design.md` (Move 1, shipped in #688 / `713a41cc`)
**Prototype:** `docs/design-reference/role-assignment.html`

---

## Problem

Move 1 made it possible to change an existing member's role, from the two
screens that list *people*: Team Members and Collaborators. The screen that
lists *roles* still cannot reach a person.

Two dead ends survive on `Roles & areas`:

1. **The member count is a label, not a link.** `RolesList.tsx:99` renders
   `{memberCountLabel(role.memberCount)}` as a bare `<span>`. An owner who
   wants to know *who* holds "Bartender" cannot find out from the role. They
   have to go to Team Members and read every row.

2. **A brand-new custom role reads "0 people" and offers nothing.** That is
   the exact state a role is in one second after it is created — the moment
   the owner most wants to put someone in it. The card says the role is empty
   and then stops talking.

The role editor has the same shape of gap: it warns *"N people have this role.
Saving changes what they can reach the next time they load a page."*
(`RoleEditor.tsx:591`) without ever naming those N people.

## What this ships

- A role card's member count becomes a **door**: a face pile plus the count,
  which opens the role on a **Who's in this role** roster. At zero members the
  same slot becomes an **Assign people** action instead of a dead label.
- The role editor gains **Areas | People** tabs. Areas is everything the editor
  does today, unchanged. People is the roster.
- The roster's per-person control is the **existing `RolePicker`**, and bulk
  assignment goes through the **existing `useAssignRole`**. No second
  assignment path, no new SQL.

**Out of scope:** Move 3 (`EmployeeDialog` gains an "App access" row, replacing
the hardcoded `role: 'staff'` at `EmployeeDialog.tsx:412`). Separate PR.

---

## Why this needs no migration

This is the load-bearing finding, so it is argued rather than asserted.

The role card's count comes from `role_member_counts`
(`supabase/migrations/20260730200000_role_member_counts.sql:36-46`), which
resolves membership as:

```sql
COALESCE(ur.role_id, public.builtin_role_id_for(ur.role))
```

…and drops rows where that is NULL (line 45). A roster that resolves
membership *differently* would show a list whose length disagrees with the
count printed on the card that opened it. So the roster must mirror that
expression exactly.

The same migration warns, at lines 18-21, that resolving the legacy string
client-side would be "a third copy in TypeScript… the copy that drifts."

That warning is already answered. `roles.legacy_role`
(`supabase/migrations/20260802100000_roles_legacy_role.sql`) is that mapping
*exposed as data*, and it cannot disagree with the function because the
backfill runs **through** it — `WHERE r.id = public.builtin_role_id_for(m.legacy_role)`
(line 44) — under a unique partial index (line 51) and a builtin-only CHECK
(lines 54-55). `RolePicker.tsx:113` already reads it this way:

```tsx
const isCurrent = (r: RoleWithGrants) =>
  currentRoleId ? r.id === currentRoleId : r.legacy_role === currentRole;
```

So the client predicate

```ts
member.roleId ?? rolesByLegacy.get(member.role)?.id ?? null
```

is a *read of the mapping*, not a copy of it. `collaborator_custom` has no
`legacy_role` row (it is absent from the backfill list at lines 39-43), so a
membership carrying `role = 'collaborator_custom'` with `role_id IS NULL`
resolves to `null` and is dropped — matching `builtin_role_id_for` returning
NULL for that same string, which the migration comment at lines 42-44 calls
out explicitly.

**Consequence:** this PR is frontend-only. No migration, no pgTAP, no RLS
change, no edge function. The permission model is entirely Move 1's
`assign_membership_role`
(`supabase/migrations/20260802110000_assign_membership_role.sql`), which is
already SECURITY DEFINER and already raises 42501 on every denial rather than
filtering.

### The two queries see the same rows

The card count comes from `role_member_counts`, which is `SECURITY INVOKER`
(migration line 33) over `user_restaurants`. The roster comes from
`useRestaurantMembers`, which SELECTs `user_restaurants` directly
(`useRestaurantMembers.ts:38-41`) under the same RLS. Same rows, same
predicate, same total.

`useRestaurantMembers` maps over `memberships`, not over `profiles`
(`useRestaurantMembers.ts:54`), so a member whose `profiles` row is unreadable
still appears — with `fullName` and `email` null. It does not silently shrink
the roster below the count. Such a row renders as "Unnamed member".

---

## Architecture

### New

| File | Responsibility |
|---|---|
| `src/lib/permissions/roleMembership.ts` | Pure resolution: `legacyRoleIndex`, `resolveMembershipRoleId`, `membersInRole`, `groupMembersByRole`. Mirrors `role_member_counts`. Unit-tested. |
| — | `canAssignAnyRole(role)` is added to the existing `src/lib/permissions/invitations.ts`, not to a new file (see "Who may assign" below). |
| `src/components/roles/memberDisplay.ts` | `memberDisplayName(member)`, `memberInitials(member)`. |
| `src/components/roles/RoleFacePile.tsx` | Up to three stacked initial avatars. Decorative (`aria-hidden`). |
| `src/components/roles/RoleRoster.tsx` | The "Who's in this role" panel: rows, empty state, "Assign people" trigger. |
| `src/components/roles/AssignPeopleDialog.tsx` | Multi-select over candidates → sequential `useAssignRole` calls → per-person result report. |
| `tests/unit/roleMembership.test.ts` | Resolution + grouping tests. |

### Modified

| File | Change |
|---|---|
| `src/lib/permissions/invitations.ts:79-94` | Add `canAssignAnyRole(role)`, derived from the matrix. |
| `src/components/TeamMembers.tsx:38-39` | Replace the hardcoded `canManageMembers` list with `canAssignAnyRole(userRole)`. |
| `src/hooks/useRestaurantMembers.ts:40,54-62` | Select `id` too; add `membershipId` to `RestaurantMember`. |
| `src/hooks/useAssignRole.ts:59-65` | Also invalidate `['restaurant-members', restaurantId]`. |
| `src/components/roles/RolesList.tsx:72-106` | `<button>` card → `<article>` + hit button + footer people button. |
| `src/components/roles/RoleEditor.tsx:386,538-541` | Areas \| People tabs; `callerRole` prop; controlled initial tab. |
| `src/components/roles/RolesTab.tsx:27-33` | Gains `userRole`; owns which tab the editor opens on. |
| `src/pages/Team.tsx:172` | Pass `userRole={selectedRestaurant.role}`. |

`Team.tsx:172` is currently the only tab on that page not receiving
`userRole` — the other three do (lines 167, 178, 185).

### `roleMembership.ts`

```ts
/** Mirrors COALESCE(ur.role_id, builtin_role_id_for(ur.role)) — see
 *  20260730200000_role_member_counts.sql:38. */
export function resolveMembershipRoleId(
  member: Pick<RestaurantMember, 'role' | 'roleId'>,
  rolesByLegacy: ReadonlyMap<string, string>
): string | null;

/** The legacy-role → role-id map both functions below resolve through. */
export function legacyRoleIndex(
  roles: readonly RoleWithGrants[]
): Map<string, string>;

/** Everyone in `members` whose membership resolves to `roleId`. */
export function membersInRole(
  members: readonly RestaurantMember[],
  roleId: string,
  byLegacy: ReadonlyMap<string, string>
): RestaurantMember[];

/** Every member bucketed by resolved role id, for the whole grid at once. */
export function groupMembersByRole(
  members: readonly RestaurantMember[],
  byLegacy: ReadonlyMap<string, string>
): Map<string, RestaurantMember[]>;
```

Every function takes the map rather than building it — the grid builds it once
via `legacyRoleIndex` and buckets all cards in a single `groupMembersByRole`
pass, instead of re-deriving it per card.

---

## The role card

`RolesList.tsx:72-106` is today a single `<button>` wrapping icon, name,
description, `RoleAreaChips`, and the footer. A people button cannot go inside
it — nested `<button>` is invalid HTML. The approved prototype already solves
this, so the change is transcription, not invention:

```html
<article class="rolecard">
  <button class="rolecard__hit" data-role-open="…">glyph · name · description</button>
  <div class="rolecard__chips">…</div>
  <div class="rolecard__foot">
    <button class="peoplelink" data-people="…">…</button>
    <span class="chip chip--stamp">Built-in | Custom</span>
  </div>
</article>
```

Ours becomes:

```tsx
<article className={CARD_CHROME}>              {/* border, bg-card, hover, shadow */}
  <button type="button" onClick={onOpen} className={HIT}>
    <span className={GLYPH}><Icon aria-hidden="true" /></span>
    <span className="min-w-0">
      <span className="block text-[14px] font-semibold text-foreground">{role.name}</span>
      {role.description && <span className="block text-[13px] text-muted-foreground mt-0.5">…</span>}
    </span>
  </button>

  <RoleAreaChips areas={role.role_areas} />

  <div className={FOOT}>
    {role.memberCount > 0 ? <PeopleButton … /> : <AssignPeopleButton … />}
    <span className={STAMP}>{role.builtin ? 'Built-in' : 'Custom'}</span>
  </div>
</article>
```

**`CARD_CHROME` must carry `flex flex-col`.** Today the footer pins to the
bottom of a short card because `mt-auto` (`RolesList.tsx:98`) sits on a direct
child of the single flex-column button, which stretches to the grid row height.
Once the card is an `<article>` with three children, that column context has to
move to the `<article>` or every card's footer floats up to hug its
description and the grid stops looking like a grid. The prototype's CSS says
the same thing (`display:flex; flex-direction:column` on `.rolecard`,
`margin-top:auto` on `.rolecard__foot`). Concretely: `CARD_CHROME` =
`group flex flex-col gap-3 p-[18px] rounded-xl border border-border/40 bg-card shadow-sm hover:border-border transition-colors`,
`FOOT` keeps `mt-auto pt-[11px] border-t border-border/40`, and `HIT` drops the
card chrome it no longer owns, keeping `flex items-start gap-[11px] text-left
rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`.

`RoleCardSkeleton` (`RolesList.tsx:50-70`) already mirrors this shape as a
plain `<div>` with the same padding, gap, border and footer rule, so it needs
no structural change — but its values must keep matching `CARD_CHROME`, which
is the reason the two are worth reading side by side when this lands.

Moving `RoleAreaChips` out of the hit button is not cosmetic: it renders a
`<div>` (`RoleAreaChips.tsx:27`), and `<div>` inside `<button>` violates the
button content model. The prototype's structure fixes an existing validity bug
as a side effect.

Focus is per-button, not per-card: the hit button and the people button each
carry `focus-visible:ring-2 focus-visible:ring-ring`, so tabbing through the
grid stops at both doors. The card's `hover:border-border` moves to the
`<article>` via `group-hover`, so hovering either child still lights the whole
card as it does today.

### The two footer states

| `memberCount` | Renders | Accessible name |
|---|---|---|
| `> 0` | face pile (≤3) + `memberCountLabel(n)` + chevron | `3 people in Bartender. Manage who's in this role` |
| `0` | user-plus icon + `Assign people` | `Nobody is in Bartender yet. Assign people` |

Both are the same destination: the role editor's People tab.

**The count stays `role.memberCount`.** The roster query supplies *faces only*.
Two reasons: `role.memberCount` is the server's answer and the same number the
editor's save warning uses (`RoleEditor.tsx:591`), so card and banner cannot
disagree; and if the members query is slow or fails, the grid still renders
correct counts with no avatars rather than flashing wrong numbers. The face
pile degrades to nothing; the door still works.

The grid runs **one** `useRestaurantMembers` query for all cards and groups
once with `groupMembersByRole` — not one query, or one filter pass, per card.

---

## The role editor

Under the existing "← All roles" back link (`RoleEditor.tsx:538`):

```
← All roles
┌──────────────────────────────
│ Areas   People
│ ───────
└──────────────────────────────
```

- **Areas** — the existing `grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]`
  (`RoleEditor.tsx:541`) verbatim: identity card, member-count banner, the
  three bands, sensitive flags, copy-to-restaurants, save row, and the sticky
  `RolePreviewPanel`. Nothing inside it changes.
- **People** — `<RoleRoster role={role} restaurantId={…} callerRole={…} />`,
  full width.

Implemented with shadcn `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` styled to
the Apple underline look from CLAUDE.md, rather than hand-rolled buttons —
Radix supplies `role="tablist"`, roving tabindex and arrow-key navigation, and
`Team.tsx:118` already uses shadcn `Tabs` on this same page.

`value` is controlled so `RolesTab` can open the editor directly on People when
the card's people button was the door.

**Tabs are omitted entirely when `role === null`.** That is the new-role draft
(`RolesTab.tsx:15-19`); an unsaved role has no members and no id to assign
against. The draft renders exactly what it renders today.

### Wiring

`RolesList` gains two callbacks rather than one overloaded one:

```ts
onSelectRole: (role: RoleWithGrants) => void;   // hit button  → Areas
onOpenPeople: (role: RoleWithGrants) => void;   // people button → People
```

`RolesTab` holds `initialTab: 'areas' | 'people'` alongside its existing
`isEditing` / `selectedRole`, and takes `userRole: Role` to pass down as
`callerRole`.

---

## The roster

```
Who's in this role                                    [ Assign people ]

 ( JD )  Jose Delgado                         [ Bartender ▾ ]
         jose@example.com

 ( MR )  Maria Reyes                          [ Bartender ▾ ]
         maria@example.com
```

Each row's role control **is `RolePicker`** — the same component Move 1 put on
Team Members (`TeamMembers.tsx:184-193`) and Collaborators. Changing the value
moves that person out of this role and into another, which is the roster's only
mutation. Props mirror the Team Members wiring:

```tsx
<RolePicker
  membershipId={member.membershipId}
  restaurantId={restaurantId}
  personName={memberDisplayName(member)}
  currentRole={member.role}
  currentRoleId={member.roleId}
  callerRole={callerRole}
  disabled={
    !canAssign ||
    isSelf ||
    member.role === 'kiosk' ||
    (member.role === 'owner' && callerRole !== 'owner')
  }
/>
```

`isSelf` comes from `useAuth()`, as at `TeamMembers.tsx:152`. No `onAssigned`
callback is needed here: unlike `TeamMembers`, this surface is React Query, and
`useAssignRole` already invalidates `['roles']` (line 59) — plus
`['restaurant-members']`, which this PR adds.

`RolePicker` calls `useInsideScrollLock()` (`RolePicker.tsx:77`), which reads a
context provided by `DialogContent`/`SheetContent`. In the roster it is on a
plain page, outside any dialog, so the hook returns its default `false` and the
popover is non-modal — correct for a page. The constraint only bites inside
`AssignPeopleDialog`, which does not render a `RolePicker`.

### Who may assign

`chef` is not blocked from `/team` — `App.tsx`'s `StaffRoleChecker` (lines
237-295) turns away only `staff`, `kiosk` and the `collaborator_*` roles — and
`RolesTab` applies no gate of its own. So the roster must carry the same
permission gate the Team Members list does, or a chef would see pickers that
look live and fail with a 42501 from `invitable_roles()`, which has no `chef`
row (`assign_membership_role.sql:32-48`).

`TeamMembers.tsx:39` spells that gate out as a literal list:

```ts
const canManageMembers = userRole === 'owner' || userRole === 'manager' || userRole === 'operations_manager';
```

Copying that list into the roster would make three copies of the same fact
(here, `TeamMembers`, and the SQL matrix). Instead it is **derived** from the
matrix that already exists, in `src/lib/permissions/invitations.ts` beside
`getInvitableRoles` (line 79) and `canInviteCustomRole` (line 92):

```ts
/** Whether this role can change anyone's role at all. Derived from
 *  INVITABLE_ROLES rather than re-listed, so it cannot disagree with it. */
export function canAssignAnyRole(inviter: Role): boolean {
  return getInvitableRoles(inviter).length > 0 || canInviteCustomRole(inviter);
}
```

`INVITABLE_ROLES` (`invitations.ts:10`) has rows only for `owner`, `manager`
and `operations_manager`, so this returns exactly the set `canManageMembers`
hardcodes today — and `TeamMembers.tsx:38-39` is switched to it in this PR,
deleting the literal list rather than adding a second one.

When `canAssignAnyRole(callerRole)` is false the roster still renders — reading
who holds a role is not a privileged act, and these users can already read the
same memberships on Team Members — but every `RolePicker` is disabled and the
"Assign people" action is not rendered at all. The final authority remains the
RPC.

### States

- **Loading** — three skeleton rows.
- **Error** — `role="alert"` with the message; the "Assign people" button stays
  usable, since assignment does not depend on reading the roster.
- **Empty** — the prototype's copy, verbatim:

  > **Nobody is in {name} yet**
  > A role does nothing until someone holds it. Assign the people who do this
  > job — they'll see the areas above the next time they load a page.

  with **Assign people** as the primary action.

---

## Assigning people

Trigger: "Assign people" from the empty state, the roster header, or the card's
zero-member button (which routes here via the People tab).

A shadcn `Dialog` titled **Assign to {name}**, subtitled *"Everyone you pick
leaves the role they're in now."* — the prototype's copy.

**Candidates** = every restaurant member, minus:

| Excluded | Why |
|---|---|
| already resolves to this role | nothing to do |
| self | `assign_membership_role` rule 2 (migration lines 99-104) |
| `role === 'kiosk'` | rule 4 (lines 120-126) — a shared device credential |
| `role === 'owner'` when caller is not an owner | rule 5a (lines 128-134) |

These mirror server rules that would raise 42501 anyway. The dialog hides what
the server would reject rather than offering it and reporting failure; the
server remains the authority.

Rows are shadcn `Checkbox` inside a `<label>` — a real labelled checkbox rather
than the prototype's `role="checkbox" tabindex="0"` div, because we have the
primitive and it gets keyboard and screen-reader behaviour right for free.
Footer reads `Nobody selected` / `1 person selected` / `N people selected`,
with the button label `Assign` → `Assign N`. When there are no candidates:
*"Everyone already holds this role."*

### Submission

`assign_membership_role` takes one membership per call. Rather than add a bulk
RPC — which would pull SQL, RLS review and pgTAP into a frontend PR — the
dialog issues the calls **sequentially** through `useAssignRole`:

```ts
const payload = role.legacy_role
  ? { role: role.legacy_role as Role, roleId: null }
  : { role: CUSTOM_ROLE, roleId: role.id };
```

mirroring `RolePicker.tsx:133-141`.

Sequential, not `Promise.all`: rule 5b takes `FOR UPDATE` on the restaurant's
owner rows before counting (migration lines 143-150), so concurrent calls
touching an owner contend on that lock; and one-at-a-time keeps each failure
attributable to a named person.

Partial failure is reported, not swallowed: successes are counted, and each
failure is named with `assignRoleErrorMessage(error)`
(`useAssignRole.ts:36`) — which checks `'message' in error` before
`instanceof Error`, because PostgREST rejections are plain objects. The dialog
stays open when anything failed, with the failed rows still selected.

---

## Deliberate deviations from the prototype

1. **Roster rows use `RolePicker`, not a "Move out" button.** The prototype's
   `data-remove` handler reassigns to a fixed fallback role ("falls back to
   Employee, never to nothing"). A silent demotion to Employee is a worse
   outcome than an explicit choice, and a second write path would need its own
   copy of the permission gating that `RolePicker` already has. Standing
   instruction from Move 1: reuse `RolePicker`/`useAssignRole`.

2. **No read-only display header above the tabs.** The prototype shows the
   role's name and description as static text above `Areas | People`. Ours is a
   live editable `<Input>` inside the Areas panel, so a second rendering of the
   same name would either duplicate it or go stale mid-edit.

3. **"Assign people" appears on any zero-member role, not only custom ones.**
   A built-in role with nobody in it is the same dead end. The card is pure
   navigation; whether the viewer *may* assign is decided in the People panel
   and, finally, by the RPC.

4. **The card's count is the server's, not the roster's length.** Argued above.

---

## Testing

**Unit** — `tests/unit/roleMembership.test.ts`:

- `role_id` wins over the legacy string when both are set (mirrors `COALESCE`).
- A membership with `role_id IS NULL` resolves through `legacy_role`.
- `role = 'collaborator_custom'`, `role_id IS NULL` → dropped.
- An unrecognised role string → dropped.
- Grouping totals equal the per-role counts for a mixed fixture.

Plus, in `tests/unit/invitationMatrix.test.ts`:
`canAssignAnyRole` is true for exactly `owner`, `manager`,
`operations_manager` and false for every other `Role` — the assertion that
catches it silently widening if a future matrix row is added.

**Not added, and why:** no pgTAP — this PR contains no SQL. No new Playwright
spec — the flow needs two seeded members holding different roles in one
restaurant, which `tests/helpers/e2e-supabase` does not currently provide;
building that seeding is its own change and would dominate the PR.

**Existing gates:** `npm run typecheck`, `npm run lint`, `npm run test`,
`npm run build`, plus the existing roles-and-areas E2E spec, which selects the
roles tab by its visible text (`Team.tsx:136-143`, deliberately unlabelled —
see the comment at lines 129-135) and must keep passing
through the card restructure.

## Accessibility

- Both card doors are `<button type="button">` with explicit `aria-label`s
  naming the role.
- The face pile is `aria-hidden="true"`; the count text carries the meaning.
- Tabs come from Radix: real `tablist`/`tab`/`tabpanel`, arrow-key navigation.
- Roster avatars are `aria-hidden`; the visible name is the row's label.
- Dialog checkboxes are wrapped in `<label>`; the dialog uses
  `DialogDescription` so Radix wires `aria-describedby` (CLAUDE.md).
- Loading uses `Skeleton`; errors use `role="alert"`; the empty state is real
  text, not an icon.

All colour via semantic tokens; no `localStorage`; every query is React Query
with `staleTime: 30000`.
