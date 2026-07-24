import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

export interface AccountlessEmployee {
  id: string;
  name: string;
  email: string | null;
}

/**
 * Active employees in this restaurant with NO linked account yet
 * (`employees.user_id IS NULL`).
 *
 * Deliberately restaurant-scoped: a global "does this email have an employee
 * record" lookup would be an account-enumeration oracle. RLS (view:employees)
 * enforces the same boundary server-side — owner/manager/operations_manager,
 * the roles that render the invite screens, all hold view:employees.
 */
export function useAccountlessEmployees(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['accountless-employees', restaurantId],
    enabled: !!restaurantId,
    staleTime: 30000,
    queryFn: async (): Promise<AccountlessEmployee[]> => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, email')
        .eq('restaurant_id', restaurantId)
        .is('user_id', null)
        .eq('status', 'active');

      if (error) throw error;

      return (data ?? []) as AccountlessEmployee[];
    },
  });
}

/**
 * Case-insensitive, trimmed lookup of an email against the accountless roster.
 *
 * `employees.email` is plain TEXT (not CITEXT), so a mixed-case address would
 * false-negative on a strict comparison.
 *
 * Returns null when `employees` is undefined — the roster is still loading or
 * the query failed. Callers treat null as "proceed normally", mirroring
 * `findMemberByEmail`'s fail-open posture.
 */
export function findAccountlessEmployeeByEmail(
  employees: AccountlessEmployee[] | undefined,
  email: string
): AccountlessEmployee | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !employees) return null;
  return employees.find((e) => e.email?.trim().toLowerCase() === normalized) ?? null;
}

/**
 * Gates the accountless-employee match behind existing-member detection:
 * member detection wins and MUST have settled first, so the inform hint
 * never flashes before a block that lands once membership data arrives.
 *
 * Also suppressed on `membersIsError`: an errored member lookup means we
 * don't actually know whether this email already belongs to a member (unlike
 * a genuine "no match" result), so it would be misleading to surface the
 * hint — or attach `employeeId` to the invite body — against that unknown.
 * This mirrors `existingMember`'s own fail-open contract in the other
 * direction: the *block* fails open (error ≈ "not a member", so Send isn't
 * disabled), while the *hint* fails closed (error ≈ "don't know", so nothing
 * is asserted about this email being a free-standing accountless employee
 * either).
 */
export function resolveAccountlessEmployeeHint(
  existingMember: unknown,
  membersLoading: boolean,
  membersIsError: boolean,
  employees: AccountlessEmployee[] | undefined,
  email: string
): AccountlessEmployee | null {
  return existingMember || membersLoading || membersIsError
    ? null
    : findAccountlessEmployeeByEmail(employees, email);
}

/**
 * The email field's `aria-describedby` target: whichever panel — the
 * existing-member block or the accountless-employee hint — is currently
 * rendered, or `undefined` when neither is. Same precedence as
 * `resolveAccountlessEmployeeHint` (block wins). Written as an if/else
 * chain rather than a nested ternary per the project's lint rule
 * disallowing nested ternaries.
 */
export function resolveDescribedById(
  existingMember: unknown,
  accountlessEmployee: AccountlessEmployee | null,
  blockedPanelId: string,
  hintPanelId: string
): string | undefined {
  if (existingMember) return blockedPanelId;
  if (accountlessEmployee) return hintPanelId;
  return undefined;
}

/**
 * Joins the ids of every currently-rendered describing panel into a single
 * `aria-describedby` value (space-separated, per the ARIA spec), or
 * `undefined` when none are rendered. Unlike `resolveDescribedById`'s
 * either/or precedence (block vs. hint), panels passed here are independent
 * and can legitimately stack — e.g. TeamInvitations' `pendingConflict`
 * warning, which the design doc notes "can stack with" the hint panel.
 */
export function combineDescribedByIds(...ids: Array<string | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}
