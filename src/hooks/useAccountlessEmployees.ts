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
