# App Access on the Employee Dialog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The employee dialog names where app access actually lives — the account, not the employee row — and the invite it sends stops hard-coding `staff`.

**Architecture:** `RolePicker` splits into a controlled `RoleSelect` (option list) and the existing assignment shell that wraps it. A new `EmployeeAppAccessRow` renders in both dialog modes, resolving three states from `employee.user_id`, the restaurant roster, and the typed email. `EmployeeDialog` keeps every Supabase call; the row is presentational plus a self-contained `RolePicker`.

**Tech Stack:** React 18 + TypeScript, React Query, shadcn/ui (Popover + cmdk `Command`), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-04-employee-app-access-design.md`

## Global Constraints

- Semantic tokens only. Never `bg-white`, `text-black`, or any literal color. `--success` / `--destructive` for the gains/loses lines.
- Apple/Notion type scale per CLAUDE.md: `text-[14px] font-medium` body, `text-[13px] text-muted-foreground` secondary, `border-border/40`, `bg-muted/30`, `rounded-lg` controls / `rounded-xl` cards.
- Every async surface handles loading, error, and empty explicitly.
- No `localStorage` caching. React Query only, `staleTime` ≤ 60s.
- Buttons without visible text need `aria-label`. A trigger's accessible name must *contain* its visible text (WCAG 2.5.3).
- `RolePickerProps` is public API — `TeamMembers.tsx:187`, `RoleRoster.tsx:109`, `RolesList.tsx:235`/`:314`, `CollaboratorInvitations.tsx:538` must compile and pass unchanged.
- No migrations. No edge-function changes.
- Never `git add -A` / `git add .` / `git commit -a`. Stage explicit paths.
- Run `npm run typecheck` before every commit. It uses `tsconfig.app.json`, whose `include` is `["src"]` — it does **not** typecheck `tests/`. Run `npx vitest run <file>` to catch test-file type errors.

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `src/lib/permissions/roleMembership.ts` | + `INTERNAL_TEAM_ROLES`, `isInternalTeamRole` — TS mirror of the SQL visibility predicate |
| `src/components/roles/RoleSelect.tsx` | **new** — controlled role option list in a Popover. No writes, no delta. |
| `src/components/roles/RolePicker.tsx` | `RoleSelect` + delta panel + commit button. Public props unchanged. |
| `src/components/employees/EmployeeAppAccessRow.tsx` | **new** — the three states. Presentational; all Supabase calls stay in the dialog. |
| `src/components/EmployeeDialog.tsx` | Renders the row in both modes; invite payload takes the chosen role; new edit-mode invite call |

---

### Task 1: Mirror the internal-team predicate

The roster query is visibility-gated by RLS, not just permission-gated. `EmployeeAppAccessRow` must not render for a caller who cannot see the roster, or it will print "No access" about people who have access. That needs a client-side copy of a SQL rule, which needs a drift test.

**Files:**
- Modify: `src/lib/permissions/roleMembership.ts`
- Test: `tests/unit/internalTeamMirror.test.ts` (create)

**Interfaces:**
- Produces: `INTERNAL_TEAM_ROLES: readonly Role[]`, `isInternalTeamRole(role: Role | null | undefined): boolean`

- [ ] **Step 1: Write the failing mirror test**

Create `tests/unit/internalTeamMirror.test.ts`:

```ts
/**
 * `user_is_internal_team` decides who can SELECT every row of
 * user_restaurants (20260120100000_add_collaborator_roles.sql:201-212).
 * EmployeeAppAccessRow needs the same answer client-side to know whether a
 * miss in the roster means "no account" or "you just can't see it".
 *
 * That makes INTERNAL_TEAM_ROLES a second copy of a database rule, and
 * roleMembership.ts's own header warns about exactly that. This test is the
 * pin: add a sixth internal role in SQL without updating the constant and it
 * fails here rather than silently blanking the row in production.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INTERNAL_TEAM_ROLES } from '@/lib/permissions/roleMembership';

const MIGRATION = 'supabase/migrations/20260702170000_add_operations_manager_role.sql';

describe('INTERNAL_TEAM_ROLES mirrors user_is_internal_team', () => {
  it('lists exactly the roles the SQL function accepts', () => {
    const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');

    const fnStart = sql.indexOf('FUNCTION public.user_is_internal_team');
    expect(fnStart, `user_is_internal_team not found in ${MIGRATION}`).toBeGreaterThan(-1);

    // `AND ur.role IN ('owner', 'manager', ...)` — first IN list after the signature.
    const inList = /ur\.role\s+IN\s*\(([^)]*)\)/.exec(sql.slice(fnStart));
    expect(inList, 'role IN (...) list not found').not.toBeNull();

    const fromSql = [...inList![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(fromSql.length).toBeGreaterThan(0);
    expect([...INTERNAL_TEAM_ROLES].sort()).toEqual([...fromSql].sort());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/unit/internalTeamMirror.test.ts
```

Expected: FAIL — `INTERNAL_TEAM_ROLES` is not exported from `roleMembership.ts`.

- [ ] **Step 3: Add the constant**

Append to `src/lib/permissions/roleMembership.ts` (it already imports nothing from `types`, so add the type import at the top):

```ts
import type { Role } from '@/lib/permissions/types';

/**
 * The roles that `user_is_internal_team` accepts
 * (20260702170000_add_operations_manager_role.sql:27-43).
 *
 * A second copy of a database rule, which the header above warns against —
 * but this one is unavoidable: RLS decides what `useRestaurantMembers`
 * returns, and the UI has to distinguish "this employee has no account" from
 * "you cannot see whether they do". Getting that backwards tells a
 * collaborator_accountant that a fully-provisioned employee cannot sign in.
 * `tests/unit/internalTeamMirror.test.ts` pins the two together.
 */
export const INTERNAL_TEAM_ROLES = [
  'owner',
  'manager',
  'operations_manager',
  'chef',
  'staff',
] as const satisfies readonly Role[];

/** Whether this caller sees every `user_restaurants` row for the restaurant. */
export function isInternalTeamRole(role: Role | null | undefined): boolean {
  return !!role && (INTERNAL_TEAM_ROLES as readonly string[]).includes(role);
}
```

- [ ] **Step 4: Run the test and the typecheck**

```bash
npx vitest run tests/unit/internalTeamMirror.test.ts && npm run typecheck
```

Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions/roleMembership.ts tests/unit/internalTeamMirror.test.ts
git commit -m "feat(permissions): mirror user_is_internal_team for roster visibility"
```

---

### Task 2: Extract `RoleSelect` from `RolePicker`

A pure refactor. `RolePicker`'s public behaviour must not move — `tests/unit/RolePicker.test.tsx` is the gate. It does not currently assert that a successful commit closes the popover, which is the exact behaviour the split endangers, so that test gets written **first**, against the un-refactored component.

**Files:**
- Create: `src/components/roles/RoleSelect.tsx`
- Modify: `src/components/roles/RolePicker.tsx`
- Test: `tests/unit/RolePicker.test.tsx` (extend), `tests/unit/RoleSelect.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `RoleSelect`, `RoleSelectProps` (below). `RolePickerProps` unchanged.

```ts
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
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}
```

- [ ] **Step 1: Pin the behaviour the split endangers — before touching the component**

Add to `tests/unit/RolePicker.test.tsx`, inside the existing `describe`:

```tsx
  // RolePicker owns `open` precisely so commit's onSuccess can close it and
  // clear the candidate. When the option list moved into RoleSelect, an
  // uncontrolled popover would leave this dialog open on a stale candidate
  // after a successful assignment. Written before the extraction, on purpose.
  it('closes and clears the candidate once the assignment lands', async () => {
    mockUseRoles.mockReturnValue({
      roles: [roleRow({ id: 'c1', name: 'Operations Lead' })],
      isLoading: false, error: null,
    });
    render(<RolePicker {...base} />, { wrapper });

    await userEvent.click(screen.getByRole('combobox', { name: /Dana Reyes/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/ }));
    await userEvent.click(screen.getByRole('button', { name: /change role to/i }));

    const [, handlers] = mutate.mock.calls[0];
    handlers.onSuccess();

    // Popover gone, so the commit button and the option list are gone with it.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /change role to/i })).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('option', { name: /Operations Lead/ })).not.toBeInTheDocument();

    // Reopening starts clean — no candidate carried over, so no commit footer.
    await userEvent.click(screen.getByRole('combobox', { name: /Dana Reyes/i }));
    expect(screen.queryByRole('button', { name: /change role to/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it against the un-refactored component**

```bash
npx vitest run tests/unit/RolePicker.test.tsx
```

Expected: PASS (all 10). If it fails, stop — the baseline is not what the plan assumes; report before refactoring.

- [ ] **Step 3: Commit the pin on its own**

```bash
git add tests/unit/RolePicker.test.tsx
git commit -m "test(roles): pin RolePicker closing on a landed assignment"
```

- [ ] **Step 4: Create `RoleSelect`**

Move, verbatim, out of `RolePicker.tsx`: the `useRoles` call, `invitable`/`mayAssignCustom`, `searchQuery`/`matches`, `customRoles`/`builtinRoles`, `renderRow`, and the whole `Popover`/`PopoverTrigger`/`PopoverContent`/`Command` tree including the three list states and both `CommandGroup`s.

`src/components/roles/RoleSelect.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useInsideScrollLock } from '@/components/ui/scroll-lock-boundary';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useRoles, type RoleWithGrants } from '@/hooks/useRoles';
import { RoleAreaChips } from '@/components/roles/RoleAreaChips';
import { canInviteCustomRole, getInvitableRoles, isAssignableCustomRole } from '@/lib/permissions/invitations';
import type { Role } from '@/lib/permissions/types';
import { cn } from '@/lib/utils';

export interface RoleSelectProps { /* as declared above */ }

export function RoleSelect({
  restaurantId, callerRole, value, onSelect,
  triggerLabel, triggerText, disabled = false, footer,
  open: openProp, onOpenChange,
}: RoleSelectProps) {
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const open = openProp ?? openUncontrolled;
  const setOpen = (next: boolean) => {
    setOpenUncontrolled(next);
    onOpenChange?.(next);
  };

  const [search, setSearch] = useState('');
  const modal = useInsideScrollLock();

  // useRoles returns { roles, isLoading, error, ... } — NOT a raw React Query
  // result, so there is no `data` here.
  const { roles, isLoading, error } = useRoles(restaurantId);

  const invitable = getInvitableRoles(callerRole);
  const mayAssignCustom = canInviteCustomRole(callerRole);

  const searchQuery = search.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(searchQuery);

  const customRoles = roles.filter((r) => isAssignableCustomRole(r, restaurantId) && matches(r.name));
  const builtinRoles = roles.filter(
    (r) => r.legacy_role !== null && (invitable as readonly string[]).includes(r.legacy_role) && matches(r.name)
  );

  const renderRow = (r: RoleWithGrants) => (
    // value={r.name} is load-bearing: cmdk filters on the `value` prop, and with
    // chips and a description as children its default text extraction would
    // match the concatenated blob instead of the name.
    <CommandItem key={r.id} value={r.name} onSelect={() => onSelect(r)} className="flex flex-col items-start gap-1.5 py-2.5">
      <div className="flex w-full items-center gap-2">
        <Check className={cn('h-4 w-4 shrink-0', r.id === value ? 'opacity-100' : 'opacity-0')} />
        <span className="text-[14px] font-medium text-foreground">{r.name}</span>
      </div>
      {r.description && <p className="pl-6 text-[13px] text-muted-foreground">{r.description}</p>}
      <div className="pl-6"><RoleAreaChips areas={r.role_areas} /></div>
    </CommandItem>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setSearch(''); }}
      modal={modal}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline" role="combobox" aria-expanded={open}
          aria-label={triggerLabel} disabled={disabled}
          className="h-7 max-w-[220px] gap-1 rounded-full border-border/40 px-2.5 text-[13px] font-medium"
        >
          <span className="truncate">{triggerText}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[340px] p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search roles..." value={search} onValueChange={setSearch} />
          <CommandList>
            {/* Copy the three-state block from RolePicker.tsx:220-249 VERBATIM,
                including its comment. Direct children of CommandList, never
                routed through CommandEmpty. */}
          </CommandList>
          {/* footer is a SIBLING of CommandList, inside Command — exactly where
              the delta panel sits today. Inside CommandList it would register
              as a filterable cmdk item and steal the arrow keys. */}
          {footer}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

Copy the two `CommandGroup` blocks (`RolePicker.tsx:251-270`) into `CommandList` verbatim, comments included.

- [ ] **Step 5: Rewrite `RolePicker` on top of it**

`RolePicker` keeps: `open`/`candidateId` state, `useAssignRole`, `grantSetOf`, `renderDeltaLines`, `currentLabel`, `triggerLabel`, `commit`, and the delta JSX — now passed as `footer`. It **must** pass `open` and `onOpenChange` controlled:

```tsx
  return (
    <RoleSelect
      restaurantId={restaurantId}
      callerRole={callerRole}
      {/* The CURRENT role, not the candidate — `isCurrent` at RolePicker.tsx:105
          never moves when you click an option, and the footer is what shows
          the pending choice. Passing `candidateId` here would erase the only
          on-screen record of the role the person holds today. */}
      value={currentRow?.id ?? null}
      onSelect={(r) => setCandidateId(r.id)}
      triggerLabel={triggerLabel}
      triggerText={currentLabel}
      disabled={disabled}
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setCandidateId(null); }}
      footer={delta && candidateRow ? (
        <div className="space-y-2 border-t border-border/40 px-3 py-3">
          {/* delta JSX from RolePicker.tsx:275-298, unchanged */}
        </div>
      ) : null}
    />
  );
```

`RolePicker` still needs `roles` for `currentRow`/`candidateRow`/`currentLabel`, so it keeps its own `useRoles(restaurantId)` call. Both hooks hit the same React Query key — one fetch, two readers.

- [ ] **Step 6: Run the gate**

```bash
npx vitest run tests/unit/RolePicker.test.tsx && npm run typecheck
```

Expected: all 10 PASS, unmodified. Any failure is a real behaviour change — fix `RolePicker`, do not edit the test.

- [ ] **Step 7: Test `RoleSelect` directly**

Create `tests/unit/RoleSelect.test.tsx`, mocking `@/hooks/useRoles` the same way `RolePicker.test.tsx` does. Cases:

1. trigger's `aria-label` contains its visible text
2. `isLoading` → "Loading roles…" with `role="status"`
3. `error` → "Couldn't load roles" and **not** the empty-state copy
4. a manager sees no `owner` option; an owner does
5. a custom role from another restaurant never appears (`isAssignableCustomRole`)
6. `callerRole="chef"` → custom group renders with "Only an owner or manager can assign a custom role" instead of rows, not hidden
7. `onSelect` fires with the whole `RoleWithGrants`, and no write occurs — assert `@/hooks/useAssignRole` was never imported/called by mocking it and checking `mutate` is untouched
8. `footer` renders inside the popover and is **not** reachable as a `role="option"`

- [ ] **Step 8: Run and commit**

```bash
npx vitest run tests/unit/RoleSelect.test.tsx tests/unit/RolePicker.test.tsx && npm run typecheck && npm run lint
git add src/components/roles/RoleSelect.tsx src/components/roles/RolePicker.tsx tests/unit/RoleSelect.test.tsx
git commit -m "refactor(roles): split the role option list out of RolePicker"
```

---

### Task 3: `EmployeeAppAccessRow` — visibility gate and the linked-account state

**Files:**
- Create: `src/components/employees/EmployeeAppAccessRow.tsx`
- Modify: `src/components/EmployeeDialog.tsx`
- Test: `tests/unit/EmployeeDialog.appAccess.test.tsx` (extend)

**Interfaces:**
- Consumes: `isInternalTeamRole` (Task 1); `RolePicker` (unchanged public props).
- Produces:

```ts
export interface EmployeeAppAccessRowProps {
  restaurantId: string;
  /** Caller's role in THIS restaurant, or null when it can't be established. */
  callerRole: Role | null;
  /** Undefined in create mode. */
  employee?: Employee;
  /** Email currently typed in the dialog. */
  email: string;
  grantAppAccess: boolean;
  onGrantAppAccessChange: (next: boolean) => void;
  /** Chosen invite role. null means "unchosen" — the payload then defaults to staff. */
  inviteRole: RoleWithGrants | null;
  onInviteRoleChange: (role: RoleWithGrants) => void;
  /** Provided in edit mode only. Sends immediately. */
  onSendInvite?: () => void;
  sendingInvite?: boolean;
}
```

- [ ] **Step 1: Write the failing tests**

Extend `tests/unit/EmployeeDialog.appAccess.test.tsx`. It already mocks `useRestaurantMembers`; extend the `useRestaurantContext` mock to carry a role, since the row now reads it:

```tsx
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'r1', role: 'owner', restaurant: { id: 'r1', timezone: 'UTC' } },
  }),
}));
```

Cases to add:

```tsx
  it('shows the linked account and its role, not a role on the employee row', async () => {
    // employee.user_id matches a roster member -> membershipId resolves
    // expect: /signed in as/i with the email, and a combobox naming the role
  });

  it('says nothing at all to a caller who cannot see the roster', async () => {
    // callerRole 'collaborator_accountant': RLS returns only their own row, so a
    // roster miss means "can't see", not "no account". Claiming "No access"
    // would be a confident lie about someone with full access.
    // expect: queryByText(/app access/i) is null — the row is absent entirely.
  });

  it('offers the invite when the account is linked to no membership here', async () => {
    // employee.user_id set, roster has no matching userId -> state 3 folds into 2
    // expect: /no access/i and an "Invite to the app" control,
    //         and NO combobox (a RolePicker without a membershipId)
  });

  it('waits rather than guessing while the roster loads', async () => {
    // useRestaurantMembers isLoading -> skeleton, no invite control
    // expect: queryByRole('switch', {name: /invite/i}) is null
  });

  it('renders the role read-only when the caller role cannot be established', async () => {
    // selectedRestaurant.restaurant_id !== restaurantId prop
    // expect: role text present, but no combobox
  });
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run tests/unit/EmployeeDialog.appAccess.test.tsx
```

Expected: the five new cases FAIL; the existing cases still PASS.

- [ ] **Step 3: Build the row's gate and state 1**

```tsx
export function EmployeeAppAccessRow({ restaurantId, callerRole, employee, /* … */ }: EmployeeAppAccessRowProps) {
  const { data: members, isLoading, isError } = useRestaurantMembers(restaurantId);

  // RLS on user_restaurants returns every row only to internal team
  // (20260120100000:201-212). To a collaborator the roster is just their own
  // row, so a miss means "cannot see", not "no account" — and this row would
  // announce "No access" about someone fully provisioned. Say nothing instead.
  if (!isInternalTeamRole(callerRole)) return null;

  if (isLoading) return <AppAccessSkeleton />;
  if (isError) {
    return (
      <div role="alert" className="rounded-lg border border-border/40 bg-muted/30 p-3 text-[13px] text-muted-foreground">
        Couldn't load access details.
      </div>
    );
  }

  const member = employee?.user_id
    ? members?.find((m) => m.userId === employee.user_id) ?? null
    : null;

  if (member) return <LinkedAccountState member={member} … />;
  return <NoAccessState … />;
}
```

State 1 stacks unconditionally — `TeamMembers.tsx:178-186` shows a label plus this chip overflows a 375px row, and this dialog is capped tighter at `sm:max-w-[500px]` (`EmployeeDialog.tsx:647`):

```tsx
<div className="rounded-lg border border-border/40 bg-muted/30 p-3 space-y-2">
  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">App access</Label>
  <p className="text-[13px] text-muted-foreground truncate">
    Signed in as <span className="text-foreground">{member.email}</span>
  </p>
  <RolePicker
    membershipId={member.membershipId}
    restaurantId={restaurantId}
    personName={employee?.name ?? member.fullName ?? 'this member'}
    currentRole={member.role}
    currentRoleId={member.roleId}
    callerRole={callerRole}
  />
  <p className="text-[13px] text-muted-foreground">
    Roles belong to the EasyShiftHQ account, not the employee record — the same control appears on Team members.
  </p>
</div>
```

`RolePicker` needs a non-null `callerRole`; the `isInternalTeamRole` gate above already guarantees it. When `callerRole` is null the gate returns `null`, which also satisfies the read-only case — except where the restaurant mismatches, handled next.

- [ ] **Step 4: Wire it into `EmployeeDialog` in edit mode**

Derive `callerRole` without assuming the selected restaurant is the dialog's:

```tsx
// Both call sites pass the selected restaurant (Employees.tsx:137,
// Scheduling.tsx:1621), but a mismatch must not silently borrow another
// restaurant's role — that would gate this row on the wrong permissions.
const callerRole =
  selectedRestaurant?.restaurant_id === restaurantId ? selectedRestaurant.role : null;
```

Render the row unconditionally where the `isCreateMode &&` block sits today (`:1110`), leaving that block's create-mode contents alone for now.

- [ ] **Step 5: Run**

```bash
npx vitest run tests/unit/EmployeeDialog.appAccess.test.tsx && npm run typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/employees/EmployeeAppAccessRow.tsx src/components/EmployeeDialog.tsx tests/unit/EmployeeDialog.appAccess.test.tsx
git commit -m "feat(employees): show the linked account's role on the employee dialog"
```

---

### Task 4: Unhardcode the create-mode invite

**Files:**
- Modify: `src/components/employees/EmployeeAppAccessRow.tsx`, `src/components/EmployeeDialog.tsx`
- Test: `tests/unit/EmployeeDialog.appAccess.test.tsx` (extend)

**Interfaces:**
- Consumes: `RoleSelect` (Task 2), the row (Task 3).

- [ ] **Step 1: Write the failing tests**

```tsx
  it('still invites as staff when nobody touches the picker', async () => {
    // fill name + email, flip the switch, submit
    expect(invokeMock).toHaveBeenCalledWith('send-team-invitation', {
      body: expect.objectContaining({ role: 'staff', employeeId: 'new-emp' }),
    });
    expect(invokeMock.mock.calls[0][1].body).not.toHaveProperty('roleId');
  });

  it('invites as the chosen custom role, carrying its roleId', async () => {
    // pick "Operations Lead" (a custom role) then submit
    expect(invokeMock).toHaveBeenCalledWith('send-team-invitation', {
      body: expect.objectContaining({ role: 'collaborator_custom', roleId: 'c1' }),
    });
  });

  it('invites as a chosen built-in role without a roleId', async () => {
    // pick "Chef" then submit -> { role: 'chef' }, no roleId
  });

  it('describes the role it will actually grant, not always staff', async () => {
    // pick a custom role -> its own description shows, and the staff sentence
    // about "will not see sales, costs, payroll" is gone
    expect(screen.queryByText(/will not see sales, costs, payroll/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run tests/unit/EmployeeDialog.appAccess.test.tsx
```

Expected: the four new cases FAIL.

- [ ] **Step 3: Move the switch into the row and add the picker**

Move the existing switch block (`EmployeeDialog.tsx:1141-1166`) into `EmployeeAppAccessRow`'s no-access state **verbatim** — `aria-disabled` rather than `disabled` when the email is empty (a disabled Switch leaves the tab order and a keyboard user never hears why), the `onCheckedChange` early return, `aria-describedby="grantAppAccessHint"`, all of it.

Replace only the hint's body. When `grantAppAccess` is on, render the picker and let the chosen role describe itself:

```tsx
<p id="grantAppAccessHint" className="text-[13px] text-muted-foreground">
  {!email.trim()
    ? 'Add an email address to enable.'
    : inviteRole?.description ?? 'Lets them clock in, view their own schedule, and request time off from their phone.'}
</p>
{grantAppAccess && email.trim() && (
  <>
    <RoleSelect
      restaurantId={restaurantId}
      callerRole={callerRole}
      value={inviteRole?.id ?? null}
      onSelect={onInviteRoleChange}
      triggerText={inviteLabel}
      triggerLabel={`Invite as ${inviteLabel}. Change role`}
    />
    {inviteRole && <RoleAreaChips areas={inviteRole.role_areas} />}
  </>
)}
```

`inviteLabel` is `inviteRole?.name ?? 'Employee (self-service)'` — the staff role's display name from `ROLE_METADATA`. Leaving `inviteRole` null keeps today's payload byte-identical, so an untouched picker cannot change behaviour.

- [ ] **Step 4: Take the hardcode out**

`EmployeeDialog.tsx:429`:

```tsx
role: inviteRole && inviteRole.legacy_role === null ? CUSTOM_ROLE : (inviteRole?.legacy_role ?? 'staff'),
...(inviteRole && inviteRole.legacy_role === null ? { roleId: inviteRole.id } : {}),
```

`roleId` must be **absent**, not `undefined`, for a non-custom role: `send-team-invitation/index.ts:111` rejects the pairing when `role !== CUSTOM_ROLE && roleId`.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run tests/unit/EmployeeDialog.appAccess.test.tsx && npm run typecheck && npm run lint
git add src/components/employees/EmployeeAppAccessRow.tsx src/components/EmployeeDialog.tsx tests/unit/EmployeeDialog.appAccess.test.tsx
git commit -m "feat(employees): the invite asks which role instead of assuming staff"
```

---

### Task 5: The edit-mode invite

A genuinely new call path — `send-team-invitation` has exactly one call site today and it is create-only.

**Files:**
- Modify: `src/components/employees/EmployeeAppAccessRow.tsx`, `src/components/EmployeeDialog.tsx`
- Test: `tests/unit/EmployeeDialog.appAccess.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

```tsx
  it('sends the invite with the saved email and the chosen role', async () => {
    // edit mode, employee.email 'sam@x.com', no user_id
    // click "Invite to the app…", pick a custom role, click "Send invite"
    expect(invokeMock).toHaveBeenCalledWith('send-team-invitation', {
      body: { restaurantId: 'r1', email: 'sam@x.com', role: 'collaborator_custom', roleId: 'c1', employeeId: 'e1' },
    });
  });

  it('refuses to invite an address the user is still typing', async () => {
    // edit mode, saved email 'sam@x.com', user types 'other@x.com' in the field
    // expect: "Send invite" disabled, and no call fires on click
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('asks for an email first when the employee has none saved', async () => {
    // edit mode, employee.email undefined
    // expect: no "Send invite" button, prompt to add an address
  });
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run tests/unit/EmployeeDialog.appAccess.test.tsx
```

- [ ] **Step 3: Implement**

In the row's no-access state, when `onSendInvite` is provided (edit mode), replace the switch with a ghost button that expands to the picker plus a `Send invite` button:

```tsx
<Button
  variant="ghost"
  onClick={onSendInvite}
  disabled={sendingInvite || !savedEmail || typedEmailDiffers}
  className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
>
  {sendingInvite ? 'Sending…' : 'Send invite'}
</Button>
{typedEmailDiffers && (
  <p className="text-[13px] text-muted-foreground">Save the email change before inviting.</p>
)}
```

In `EmployeeDialog`, add the handler. It fires immediately — **not** on Save. The edit path has two exits (`:582` plain update, `:575-580` compensation detour through the effective-date modal); hanging an outward-facing email off either is three trigger sites and three ways to get it wrong.

```tsx
const handleSendInvite = async () => {
  if (!employee?.email) return;
  setSendingInvite(true);
  try {
    const { error } = await supabase.functions.invoke('send-team-invitation', {
      body: { restaurantId, email: employee.email, ...invitePayloadFor(inviteRole), employeeId: employee.id },
    });
    if (error) throw error;
    toast({ title: `Invitation sent to ${employee.email}` });
  } catch (e) {
    console.error('Error sending invitation:', e);
    toast({ title: "Couldn't send the invitation", description: 'Please try again.', variant: 'destructive' });
  } finally {
    setSendingInvite(false);
  }
};
```

Extract `invitePayloadFor(role)` and use it on the create path too, so the two call sites cannot build the payload differently.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run tests/unit/EmployeeDialog.appAccess.test.tsx && npm run typecheck && npm run lint
git add src/components/employees/EmployeeAppAccessRow.tsx src/components/EmployeeDialog.tsx tests/unit/EmployeeDialog.appAccess.test.tsx
git commit -m "feat(employees): invite an existing employee to the app"
```

---

### Task 6: End-to-end coverage

**Files:**
- Modify: `tests/e2e/accountless-employee-invite.spec.ts`, `tests/e2e/role-assignment.spec.ts`

- [ ] **Step 1: Custom-role invite from the employee dialog**

Extend `accountless-employee-invite.spec.ts`: create an employee with an email, flip the invite switch, pick a custom role, save, and assert the pending invitation carries that role. Use `page.getByRole()` / `getByLabel()`, and `generateTestUser()` for unique data.

- [ ] **Step 2: The two surfaces write the same row**

Extend `role-assignment.spec.ts`: change an employee's role from the employee dialog, then open Team members and assert the chip there shows the new role. This is the whole point of the design — the role lives on the account, and every surface reads the same source.

- [ ] **Step 3: Run**

```bash
npx playwright test tests/e2e/accountless-employee-invite.spec.ts tests/e2e/role-assignment.spec.ts --reporter=line
```

Run in the foreground and let the Bash tool's `timeout` bound it. No poll loops; `timeout`/`gtimeout` do not exist on this machine.

- [ ] **Step 4: Full suite, then commit**

```bash
npm run test && npm run typecheck && npm run lint
git add tests/e2e/accountless-employee-invite.spec.ts tests/e2e/role-assignment.spec.ts
git commit -m "test(e2e): custom-role invites and cross-surface role agreement"
```

---

## Self-Review

**Spec coverage.** State 1 → Task 3. States 2/3 create → Task 4. States 2/3 edit → Task 5. `RoleSelect` split, footer placement, controlled `open` → Task 2. Internal-team gate + mirror test → Task 1. Narrow-viewport stacking → Task 3 Step 3. Copy-that-stops-lying → Task 4 Step 3. Caller gating → Task 3 Step 4. E2E → Task 6. No spec section is unclaimed.

**Type consistency.** `RoleSelectProps` is declared once (Task 2) and used as declared in Tasks 2 and 4. `EmployeeAppAccessRowProps` is declared in Task 3 and extended by behaviour only — `onSendInvite`/`sendingInvite` are in the original declaration, used in Task 5. `inviteRole` is `RoleWithGrants | null` throughout. `INTERNAL_TEAM_ROLES`/`isInternalTeamRole` (Task 1) are consumed in Task 3.

**Ordering.** Task 2 is independent of Task 1 and could run in parallel. Tasks 3-5 are strictly sequential on the same two files. Task 6 needs 3-5.
