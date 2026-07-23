# Design: Accountless-employee detection in team/collaborator invites

**Date:** 2026-07-23
**Branch:** `claude/heuristic-leakey-2802d4`
**Follow-up to:** #641 (invite-access-clarity)

## Problem

Two independent records can share one auth account (`user_id`):

- `user_restaurants` — platform membership (owner/manager/operations_manager/staff/collaborator_*).
- `employees` — schedulable/clock-in record, **nullable** `user_id`.

`useCurrentEmployee` ([src/hooks/useCurrentEmployee.tsx:20](../../../src/hooks/useCurrentEmployee.tsx)) resolves "am I an employee here" via `.single()` on `employees(user_id, restaurant_id, status='active')`. An account only gets employee self-service when an `employees` row carries its `user_id`.

#641 added existing-**member** detection to EmployeeDialog / TeamInvitations / CollaboratorInvitations via `useRestaurantMembers` + `findMemberByEmail`. That hook reads `user_restaurants ⋈ profiles` — it only sees people who **already have a platform account**.

**The gap:** invite someone as manager/collaborator from TeamInvitations/CollaboratorInvitations, and their email matches an existing **employee record with no account yet** (`employees.user_id IS NULL`) — the invite screens do not recognize them. The invite mints a brand-new account + membership never linked back to the `employees` row: a manager login beside an orphaned, unlinked employee record. The exact double-provisioning this feature set out to prevent, on the other entry point.

The reverse (member → employee) is already handled: EmployeeDialog detects the member and links via `link_employee_to_user`.

### Two additional defects found during exploration

1. **Employee-id is dropped for non-staff roles even if passed.** Both edge functions gate linking on `role === 'staff'`:
   - `send-team-invitation/index.ts` (~line 163): `if (employeeId && role === 'staff') { invitationData.employee_id = employeeId; }` — discards `employee_id` for manager/collaborator.
   - `accept-invitation/index.ts:135`: `if (invitation.role === 'staff' && invitation.employee_id)` — linking only runs for staff.
2. **Collaborator resend loses `employee_id`.** `useResendCollaboratorInvitation` ([src/hooks/useCollaborators.ts:247](../../../src/hooks/useCollaborators.ts)) resends with only `{restaurantId, email, role}`. A resend cancels the old row and inserts a fresh one, so any stored `employee_id` is lost. → Motivates **server-side derivation** of `employee_id` from the email as the source of truth, rather than relying on every caller to thread it through.

## Goals

- Team/collaborator invite path recognizes accountless employees and stays **one account**.
- `employee_id` is honored for **all invitable roles**, not just `staff`.
- No account-enumeration oracle: all lookups `restaurant_id`-scoped, RLS-safe.
- No schema change (per decision below). The accept-time link is race-safe and enforces one employee row per user per restaurant.

## Non-goals (deferred siblings from #641)

Unified role-first invite flow, consequence preview, Team-page access+payroll columns, SCIM/SSO `default_role` fix. Not this task.

## Decisions

- **Partial unique index `employees(user_id, restaurant_id) WHERE user_id IS NOT NULL`: DEFERRED** (consistent with #641). A `UNIQUE` index migration would fail at deploy if prod already holds duplicate rows. Instead the durable guard lives **in code**: the accept-time link runs through a service-role-only RPC that refuses to link a user who already owns an employee row in that restaurant, serializes concurrent links per `(user, restaurant)` with `pg_advisory_xact_lock`, and guards the `user_id IS NULL` transition against races. This closes the hole this PR opens without touching prod data. It does not retroactively fix any pre-existing duplicate rows — that remains the (deferred) unique index's job. *(User decision, 2026-07-23.)*
- **Detection lives in a new dedicated hook**, not an extension of `useRestaurantMembers`. That hook's doc comment deliberately scopes it to `user_restaurants`; conflating employees into it would muddy a clean abstraction.
- **`employee_id` is resolved server-side** in `send-team-invitation` (single source of truth, robust to resends and to callers that don't pass it). The client hook is still used to (a) show the informational UI message and (b) pass `employeeId` as explicit intent.

## Design

### 1. `src/hooks/useAccountlessEmployees.ts` (new)

Mirrors `useRestaurantMembers` in shape and safety posture.

```ts
export interface AccountlessEmployee {
  id: string;
  name: string;
  email: string | null;
}

// Active employees in this restaurant with NO linked account yet.
// Restaurant-scoped by design — a global "does this email have an employee
// record" lookup would be an enumeration oracle. RLS (view:employees) enforces
// the same boundary server-side. owner/manager/operations_manager — the roles
// that render the invite screens — all hold view:employees.
export function useAccountlessEmployees(restaurantId: string | undefined) { … }

// Case-insensitive, trimmed. employees.email is TEXT (not CITEXT). Fail-open on
// undefined (loading/errored) and skip null emails — mirrors findMemberByEmail.
export function findAccountlessEmployeeByEmail(
  employees: AccountlessEmployee[] | undefined,
  email: string,
): AccountlessEmployee | null { … }
```

Query: `employees.select('id, name, email').eq('restaurant_id', id).is('user_id', null).eq('status', 'active')`. `staleTime: 30000`.

### 2. UI wiring — TeamInvitations.tsx + CollaboratorInvitations.tsx

Precedence: **existing member (block) → accountless employee (inform + link) → normal**.

```ts
const { data: accountlessEmployees } = useAccountlessEmployees(restaurantId);
// Member detection wins; only surface the employee hint when NOT already a member.
const accountlessEmployee = existingMember
  ? null
  : findAccountlessEmployeeByEmail(accountlessEmployees, email);
```

**Suppress the inform panel until the members query has settled** — otherwise the accountless query can resolve first and flash a green "will link" hint that the amber member-block then replaces once membership data lands (both hooks fail open to `null` while loading). Expose the members query's `isLoading`:

```ts
const { data: members, isLoading: membersLoading } = useRestaurantMembers(restaurantId);
const existingMember = findMemberByEmail(members, email);
const { data: accountlessEmployees } = useAccountlessEmployees(restaurantId);
// Member detection wins and MUST have settled first, so the hint never
// flashes before a block. While members load, show nothing.
const accountlessEmployee = existingMember || membersLoading
  ? null
  : findAccountlessEmployeeByEmail(accountlessEmployees, email);
```

When `accountlessEmployee` is set, render a **non-blocking, informational** panel — visually and semantically distinct from the amber member **block**:

- **Semantic token, not a hardcoded color:** `bg-info/10 border-info/20` with `text-foreground` body (theme defines `--info` / `--info-foreground`; mapped to `info` in tailwind config). Do **not** copy the block's `bg-amber-500/*`.
- **Distinct icon** (WCAG 1.4.1 — not color-alone): `Link2` for the inform panel vs. the block's `AlertTriangle`.
- Panel id `invite-existing-employee-hint` (Team) / `collab-existing-employee-hint` (Collab) — distinct from the block's `*-existing-member-warning`.
- `role="status" aria-live="polite"`; the email `Input`'s `aria-describedby` points at whichever panel (block **or** hint) is currently rendered, so a screen-reader user tabbing back into the field re-hears the context.

Copy (names the granted role, avoids internal jargon):

> **{name}** is already set up for scheduling here. Accepting this invite will link their new **{roleLabel}** login to that same record — no duplicate profile.

The Send button stays enabled. The send body gains `employeeId: accountlessEmployee.id`.

- TeamInvitations: add to the `send-team-invitation` body in `sendInvitation`. Also add `max-h-[80vh] overflow-y-auto` to the `DialogContent` (currently `max-w-md p-0 gap-0` with no scroll) — the hint can stack with the `pendingConflict` panel (they are not mutually exclusive) and must not push the footer's Send button off-screen on a 375-wide viewport.
- CollaboratorInvitations: pass through `useSendCollaboratorInvitation`; extend `SendInvitationParams` with optional `employeeId` and forward it in the body. (Resend need not thread it — server derives.)

Three-state rendering is handled by the query's undefined → "proceed normally".

### 3. `send-team-invitation` edge function

- **Drop the `role === 'staff'` gate** on `employee_id`.
- **Resolve `employee_id` server-side**:
  - Fetch the restaurant's accountless active employees (`select id,name,email … .is('user_id', null).eq('status','active')`).
  - If the client passed `employeeId`, accept it only if it's in that accountless set; **if it fails that check, fall through to email-derivation** rather than dropping the link (a stale client id must not reopen the double-provisioning gap).
  - Else derive by matching `email` in JS (trim + lowercase — **not** `ILIKE`, whose `_`/`%` are wildcards and `_` is valid in email local-parts).
  - Attach the resolved id to `invitationData.employee_id` regardless of role.
- `canInviteRole` still gates which roles may be invited — unchanged.

### 4. `link_invited_employee` RPC (new migration) + `accept-invitation`

New `SECURITY DEFINER` function, **service-role-only** (`REVOKE EXECUTE FROM public, anon, authenticated; GRANT EXECUTE TO service_role`), pinned with `SET search_path = public, pg_temp`, and carrying a `COMMENT ON FUNCTION` documenting the access boundary (no `auth.uid()` check because it is only reachable by the edge function after invitation-token validation, and the REVOKE — verified against the migration history to have no blanket `GRANT EXECUTE ON ALL FUNCTIONS` re-opening it — keeps clients out). Mirrors the hardening style of `20260722120000_link_employee_to_user_hardening.sql`.

```
link_invited_employee(p_user_id uuid, p_restaurant_id uuid,
                      p_employee_id uuid DEFAULT NULL, p_email text DEFAULT NULL)
  RETURNS TABLE (linked boolean, reason text, employee_id uuid)
```

Logic:
1. **Serialize per (user, restaurant):** `PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_restaurant_id::text))` before resolution/guard, so two concurrent calls for the same user against different employee rows can't both pass the guard and create two rows sharing one `user_id`.
2. Resolve target — match a row in `p_restaurant_id` that is **either** `user_id IS NULL` **or** already `user_id = p_user_id` (the latter keeps a sequential retry idempotent instead of falling to `no_match`): by `p_employee_id` if given, else by `p_email` (trim/lower, equality — **not** `ILIKE`) among active employees.
3. No match → `(false, 'no_match', NULL)`.
4. Already `user_id = p_user_id` → `(true, 'already_linked', id)` (idempotent).
5. **Guard:** another employee (`id <> target`) in the restaurant already has `p_user_id` → `(false, 'user_already_linked', NULL)`. (Prevents a 2nd row that breaks `useCurrentEmployee`'s `.single()`.)
6. `UPDATE … SET user_id = p_user_id WHERE id = target AND user_id IS NULL`; on 0 rows (lost race) re-read and mirror idempotency (same user → `(true,'already_linked')`, different → `(false,'conflict')`).
7. Success → `(true, 'linked', target)`.

Also in the same migration, a **non-unique** partial index for the now-hot predicate (safe/additive — unlike the deferred *unique* index): `CREATE INDEX IF NOT EXISTS idx_employees_accountless ON public.employees(restaurant_id) WHERE user_id IS NULL AND status = 'active'`. Hit by `useAccountlessEmployees`, the edge function's resolution, and the RPC.

`accept-invitation` replaces both raw UPDATE blocks with a single `supabase.rpc('link_invited_employee', { p_user_id: user.id, p_restaurant_id: invitation.restaurant_id, p_employee_id: invitation.employee_id ?? null, p_email: invitation.email })`, for **all roles**. Failures are logged, never fatal (unchanged posture: the user still joins the team).

## Testing

- **Unit** `tests/unit/useAccountlessEmployees.test.ts` — mirror `useRestaurantMembers.test.ts`: query filters (`is user_id null`, `status active`), disabled without restaurant id, error propagation; `findAccountlessEmployeeByEmail` case-insensitive / trimmed / fail-open on undefined / skips null emails / non-match.
- **pgTAP** `supabase/tests/NN_link_invited_employee.sql` — resolve by id; resolve by email; `no_match`; `user_already_linked` guard (second employee, same user); **idempotent re-link** (same user, already linked → `linked=true, reason='already_linked'`); conflict for a target already linked to a *different* user; permission: `authenticated` cannot `EXECUTE` (service-role only).
- **Component** `tests/unit/TeamInvitations.*.test.tsx` (lightweight render) — precedence: an email matching **both** an existing member and an accountless employee shows the **block**, not the hint; and the hint is suppressed while the members query is still loading (guards the flash-then-block race).
- Existing invite tests remain green.

## Risk & rollback

- No schema change beyond a new function → migration is additive and reversible (`DROP FUNCTION`).
- Server-side `employee_id` derivation changes behavior: any invite whose email matches an accountless employee now links on accept. This is the feature's intent; member-detection still blocks re-inviting existing members. A genuinely-separate account would require a different email (accepted edge case).
