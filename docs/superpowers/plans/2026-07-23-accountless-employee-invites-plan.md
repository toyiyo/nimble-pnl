# Plan: Accountless-employee detection in team/collaborator invites

**Design:** docs/superpowers/specs/2026-07-23-accountless-employee-invites-design.md
**Branch:** `claude/heuristic-leakey-2802d4`

Each task is TDD where a test exists (test first, watch it fail, implement, green). Ordered by dependency.

## Task 1 — `useAccountlessEmployees` hook + finder (TDD)
- **Test:** `tests/unit/useAccountlessEmployees.test.ts` (mirror `useRestaurantMembers.test.ts`).
  - Query returns active, accountless employees; disabled without `restaurantId`; propagates query error; selects `id,name,email`, filters `is('user_id', null)` + `eq('status','active')`.
  - `findAccountlessEmployeeByEmail`: case-insensitive, trimmed, fail-open on `undefined`, skips `null` emails, returns null for non-match/blank.
- **Impl:** `src/hooks/useAccountlessEmployees.ts` — `AccountlessEmployee` interface, `useAccountlessEmployees(restaurantId)` (React Query, `staleTime: 30000`, `enabled: !!restaurantId`), `findAccountlessEmployeeByEmail(employees, email)`.
- **Depends on:** none.

## Task 2 — `link_invited_employee` RPC migration + pgTAP (TDD)
- **Test:** `supabase/tests/NN_link_invited_employee.sql` (pick next free NN).
  - resolve by id → linked; resolve by email → linked; `no_match`; `user_already_linked` guard (2nd employee same user); idempotent re-link (same user already linked → `linked=true, reason='already_linked'`); conflict (target linked to different user); `authenticated` role lacks EXECUTE.
- **Impl:** `supabase/migrations/20260723HHMMSS_link_invited_employee.sql`:
  - `CREATE OR REPLACE FUNCTION link_invited_employee(p_user_id, p_restaurant_id, p_employee_id DEFAULT NULL, p_email DEFAULT NULL) RETURNS TABLE(linked bool, reason text, employee_id uuid)`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
  - Body: advisory-xact-lock on `(hashtext(user), hashtext(restaurant))` → resolve target (user_id NULL **or** = p_user_id) by id then email (trim/lower equality) → branch per design §4 logic 3–7.
  - `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`
  - `COMMENT ON FUNCTION` documenting the boundary.
  - `CREATE INDEX IF NOT EXISTS idx_employees_accountless ON public.employees(restaurant_id) WHERE user_id IS NULL AND status = 'active';`
- **Depends on:** none (parallelizable with Task 1).

## Task 3 — `send-team-invitation`: role-agnostic + server-side `employee_id` derivation
- **Impl:** `supabase/functions/send-team-invitation/index.ts`:
  - Fetch restaurant's accountless active employees once (`id,name,email`, `is('user_id', null)`, `eq('status','active')`).
  - Resolve `employee_id`: client `employeeId` if in that set, else email match (JS trim/lower), else none.
  - Drop `role === 'staff'` gate — attach resolved `employee_id` regardless of role.
- **Test:** no Deno test harness in repo for this fn; behavior covered by the accept-side pgTAP (linking) + manual reasoning. Keep the change minimal and logged.
- **Depends on:** Task 2 conceptually (shared resolution semantics), but independent to implement.

## Task 4 — `accept-invitation`: link for all roles via RPC
- **Impl:** `supabase/functions/accept-invitation/index.ts`:
  - Replace both raw-UPDATE blocks (staff-only explicit + staff-only by-email fallback) with one `supabase.rpc('link_invited_employee', { p_user_id: user.id, p_restaurant_id: invitation.restaurant_id, p_employee_id: invitation.employee_id ?? null, p_email: invitation.email })` for **all** roles.
  - Log the `{linked, reason}` result; never fatal (user still joins team).
- **Depends on:** Task 2 (RPC must exist).

## Task 5 — TeamInvitations UI (TDD component)
- **Test:** `tests/unit/TeamInvitations.hint.test.tsx` (lightweight): member+employee match → block shown, hint absent; hint suppressed while members query loading; accountless-only match → hint shown + Send enabled + body carries `employeeId`.
- **Impl:** `src/components/TeamInvitations.tsx`:
  - `useAccountlessEmployees`; expose `membersLoading` from `useRestaurantMembers`; derive `accountlessEmployee = (existingMember || membersLoading) ? null : find(...)`.
  - `Link2` inform panel with `bg-info/10 border-info/20 text-foreground`, id `invite-existing-employee-hint`, `role="status" aria-live="polite"`; role label from `ROLE_METADATA[inviteForm.role]`.
  - Email `Input` `aria-describedby` → active panel (block or hint).
  - `sendInvitation` body gains `employeeId` when set.
  - `DialogContent` → add `max-h-[80vh] overflow-y-auto`.
- **Depends on:** Task 1.

## Task 6 — CollaboratorInvitations UI + hook plumbing
- **Impl:**
  - `src/hooks/useCollaborators.ts`: extend `SendInvitationParams` with `employeeId?: string`; forward in `useSendCollaboratorInvitation` body. (Resend unchanged — server derives.)
  - `src/components/CollaboratorInvitations.tsx`: `useAccountlessEmployees` + `membersLoading` gating; `Link2` inform panel (`bg-info/10 border-info/20`), id `collab-existing-employee-hint`; email `aria-describedby` → active panel; pass `employeeId` into the mutation.
- **Test:** covered by Task 1 hook tests + the TeamInvitations component test for shared precedence logic; keep parity in markup.
- **Depends on:** Task 1.

## Task 7 — Verify
- `npm run typecheck`, `npm run lint`, `npm run test` (unit), `npm run test:db` (pgTAP) if runnable locally.
- Confirm no `select('*')`, semantic tokens only, three states handled.

## Notes / guardrails
- Multi-tenancy: every lookup `restaurant_id`-scoped; `employees` read gated by `view:employees` RLS (owner/manager/operations_manager).
- No schema change beyond the additive RPC + non-unique partial index. Partial **unique** index deferred (per decision).
- Precedence everywhere: existing member (block) → accountless employee (inform+link) → normal.
