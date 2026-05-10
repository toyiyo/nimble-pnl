/**
 * Resolves email recipients for a time-off notification.
 *
 * Uses two sequential queries instead of a PostgREST embed because
 * `public.profiles` has no foreign key to `auth.users` (or to anything),
 * so an embed like `select('user_id, profiles:user_id(email)')` silently
 * returns null and managers stop receiving emails. See spec
 * 2026-05-10-timeoff-manager-ux-design.md.
 *
 * Type-agnostic: accepts any object with a `.from()` method that returns
 * the expected chain shape, so the real Deno Supabase client and Vitest
 * stubs both satisfy the same interface.
 */

export interface BuildEmailsInput {
  supabase: TwoStepQueryClient;
  restaurantId: string;
  employeeEmail?: string | null;
  notifyEmployee: boolean;
  notifyManagers: boolean;
}

export interface BuildEmailsResult {
  emails: string[];
  employeeIncluded: boolean;
  /** Count of manager profile rows with a non-null email. May differ from `emails.length` after dedup if a manager email also matches the employee email. */
  managersFound: number;
  managerLookupError?: string;
}

interface UserRestaurantsChain {
  select(columns: string): {
    eq(column: string, value: string): {
      in(column: string, values: string[]): Promise<{
        data: { user_id: string }[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

interface ProfilesChain {
  select(columns: string): {
    in(column: string, values: string[]): Promise<{
      data: { user_id: string; email: string | null }[] | null;
      error: { message: string } | null;
    }>;
  };
}

interface TwoStepQueryClient {
  from(table: 'user_restaurants'): UserRestaurantsChain;
  from(table: 'profiles'): ProfilesChain;
  from(table: string): UserRestaurantsChain | ProfilesChain;
}

export async function buildEmails(
  input: BuildEmailsInput
): Promise<BuildEmailsResult> {
  const {
    supabase,
    restaurantId,
    employeeEmail,
    notifyEmployee,
    notifyManagers,
  } = input;

  const emails: string[] = [];
  let employeeIncluded = false;
  let managersFound = 0;
  let managerLookupError: string | undefined;

  if (notifyEmployee && employeeEmail) {
    emails.push(employeeEmail);
    employeeIncluded = true;
  }

  if (notifyManagers) {
    const { data: roleRows, error: rolesErr } = await (supabase.from(
      'user_restaurants',
    ) as UserRestaurantsChain)
      .select('user_id')
      .eq('restaurant_id', restaurantId)
      .in('role', ['owner', 'manager']);

    if (rolesErr) {
      managerLookupError = rolesErr.message;
    } else if (roleRows && roleRows.length > 0) {
      const userIds = roleRows.map((r) => r.user_id);
      const { data: profileRows, error: profErr } = await (supabase.from(
        'profiles',
      ) as ProfilesChain)
        .select('user_id, email')
        .in('user_id', userIds);

      if (profErr) {
        managerLookupError = profErr.message;
      } else if (profileRows) {
        for (const p of profileRows) {
          if (p.email) {
            emails.push(p.email);
            managersFound++;
          }
        }
      }
    }
  }

  return {
    emails: [...new Set(emails)],
    employeeIncluded,
    managersFound,
    managerLookupError,
  };
}
